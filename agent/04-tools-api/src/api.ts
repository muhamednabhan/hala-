import { randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import {
  DEMO_NOTICE, HANDOVER_REASONS, dubaiParts, normalizeTime, resolveWhen, systemClock,
  type Clock, type Fact, type HalaEvent, type HandoverReason, type Lang, type Service, type Stores
} from '@hala/core'
import { FACTS, SERVICES, findServices, getService, lookupFact } from '@hala/catalogue'
import { createCalendar, type Calendar, type CalendarResult, type Slot } from '@hala/booking'
import { TOOL_NAMES, specByName, type ParamSpec, type ToolSpec } from './specs'
import { clean, maskContact, normalizeRef, spokenDate, spokenRef, spokenTime } from './speech'
import { passFromBooking, passFromRequest, passUrl, type SmartPass } from './pass'
import { triageHandover } from './triage'

export interface ToolApiOptions {
  stores: Stores
  services?: Service[]
  facts?: Fact[]
  clock?: Clock
  /** Shared secret expected in the x-hala-secret header. Required: the endpoint fails closed without it. */
  secret?: string
  /** Tests only: skip the secret check. */
  insecureNoAuth?: boolean
  /**
   * Do not wait for the event to be saved before answering. The live feed is told at once either way; the database write
   * (a network trip) happens in the background, returned as `background` so a serverless host can keep it alive.
   */
  deferEvents?: boolean
  /**
   * Public https origin the Smart Pass QR points at (the tunnel). A function, because the tunnel URL changes while the app
   * runs. Without it the pass links to localhost, which a phone cannot open.
   */
  passBaseUrl?: () => string | undefined
  /**
   * Runs after a booking or request is saved, before the answer goes back to the agent. The app uses it to text the pass to
   * the caller's linked phone. It may report `pass_sent`, which the agent is told to mention. It must never throw.
   */
  onFulfilled?: (f: Fulfilled, conversationId: string | undefined) => Promise<{ pass_sent?: boolean } | void>
}

/** A saved booking or logged request, with its Smart Pass and the signed link to it. */
export interface Fulfilled {
  kind: 'booking' | 'request'
  ref: string
  pass: SmartPass
  url: string
  /** The same booking or request came back again (a retried tool call): do not announce or send it twice. */
  duplicate: boolean
}

export interface ToolResponse { status: number; body: Record<string, unknown>; background?: Promise<unknown> }

type Args = Record<string, unknown>
interface Outcome { body: Record<string, unknown>; event?: Pick<HalaEvent, 'type' | 'data'> }

const paramSchema = (key: string, p: ParamSpec) => {
  // Free text the agent composes itself: a wordy note must never make the booking fail, it is trimmed in the handler instead.
  if (key === 'notes') return z.string().max(4000).nullish()
  if (p.optional) return (p.enum ? z.enum(p.enum as [string, ...string[]]) : z.string().max(600)).nullish()
  // The agent is told to pass `language`, but a missing one must never block a booking: default to English.
  if (key === 'language') return z.enum(['en', 'ar']).optional()
  return p.enum ? z.enum(p.enum as [string, ...string[]]) : p.type === 'boolean' ? z.boolean() : z.string().trim().min(1).max(600)
}

/** zod schema generated from a tool spec, so validation can never drift from what the LLM was told. */
export const schemaFor = (spec: ToolSpec) =>
  z.object({
    conversation_id: z.string().max(200).optional(),
    ...Object.fromEntries(Object.entries(spec.params).map(([k, p]) => [k, paramSchema(k, p)]))
  })

const lang = (v: unknown): Lang => (v === 'ar' ? 'ar' : 'en')

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

const slotView = (s: Slot) => ({ date: s.date, time: s.time, date_spoken: spokenDate(s.date), time_spoken: spokenTime(s.time) })

const serviceView = (s: Service) => ({
  id: s.id,
  name: s.name,
  summary: s.summary,
  fulfilment: s.fulfilment,
  audience: s.audience,
  documents: s.documents,
  // Fee and time exactly as the knowledge base words them. DEMO values: always say so when stating them.
  demo_fee_aed: s.demoFeeAed,
  demo_fee_text: s.feeText,
  demo_processing_days: s.demoDays,
  demo_timeline_text: s.timelineText,
  ...(s.voiceSummary ? { voice_summary: s.voiceSummary } : {}),
  ...(s.eligibility ? { eligibility: s.eligibility } : {}),
  ...(s.steps ? { process_steps: s.steps } : {}),
  ...(s.policy ? { policy_for_agent: s.policy } : {}),
  ...(s.notes ? { extra_facts: s.notes } : {}),
  ...(s.clarify ? { clarifying_question: s.clarify } : {}),
  ...(s.agentNote ? { note_for_agent: s.agentNote } : {})
})

/** Where a person can be reached. From the DSO knowledge base. The agent may offer it after a hand-over. */
const HUMAN_CONTACT = { phone: '600 59 55 57', hours: 'Monday to Friday, 8 AM to 3 PM Dubai time', email: 'hello@dso.ae' }

// Only a real DSO matter earns a person. A joke, a test or an impossible request is declined by the agent itself.
const NOT_FOUND_HELP = 'If this is a real DSO matter, offer to connect them to the DSO team and call handover_to_human only if they accept. If it is a joke, a test, off-topic or impossible, decline lightly yourself, say what you can help with, and do NOT offer a person.'

export function createToolApi(opts: ToolApiOptions) {
  const { stores } = opts
  const services = opts.services ?? SERVICES
  const facts = opts.facts ?? FACTS
  const clock = opts.clock ?? systemClock
  const calendar: Calendar = createCalendar({ bookings: stores.bookings, clock })

  const base = () => opts.passBaseUrl?.() ?? 'http://localhost:3005'
  const link = (ref: string) => (opts.secret ? passUrl(base(), ref, opts.secret) : '')
  /** Tell the app (it texts the pass to a linked phone) and fold the result into what the agent is told. */
  async function fulfilled(f: Fulfilled, conversationId: string | undefined): Promise<{ pass_sent: boolean }> {
    try {
      const r = f.duplicate ? undefined : await opts.onFulfilled?.(f, conversationId)
      return { pass_sent: Boolean(r?.pass_sent) }
    } catch { return { pass_sent: false } }
  }
  const sentClause = (sent: boolean) => (sent
    ? " and has been texted to the caller's phone: say so in one short clause"
    : ': point to it, and do not say anything was sent to a phone')

  const calendarFailure = (r: Extract<CalendarResult<unknown>, { ok: false }>): Outcome => ({
    body: {
      ok: false, error_code: r.code, message: r.message,
      alternatives: r.alternatives.map(slotView),
      instruction: r.alternatives.length
        ? 'Tell the caller briefly why that does not work and offer these alternatives. Do not invent other times.'
        : 'Tell the caller briefly why that does not work and ask for another day.'
    },
    event: { type: 'tool_error', data: { code: r.code } }
  })

  const bookingView = (b: { ref: string; serviceId: string; attendeeName: string; date: string; time: string; status: string }) => ({
    ref: b.ref, ref_spoken: spokenRef(b.ref), status: b.status,
    service: getService(b.serviceId, services)?.name,
    attendee_name: b.attendeeName,
    date: b.date, date_spoken: spokenDate(b.date),
    time: b.time, time_spoken: spokenTime(b.time)
  })

  const handlers: Record<string, (a: Args, conversationId: string | undefined) => Promise<Outcome>> = {
    async [TOOL_NAMES.findService](a) {
      const query = clean(a.query, 300)
      const { matches, confidence } = findServices(query, services, 3)
      if (matches.length === 0) {
        return {
          body: {
            ok: true, found: false, confidence: 'none',
            instruction: `No catalogue service matches. Say you do not have that service and do not guess. ${NOT_FOUND_HELP}`
          },
          event: { type: 'service_matched', data: { query, found: false } }
        }
      }
      const picked = confidence === 'clear' ? matches.slice(0, 1) : matches
      return {
        body: {
          ok: true, found: true, confidence,
          services: picked.map((m) => serviceView(m.item)),
          demo_notice: DEMO_NOTICE,
          instruction: confidence === 'clear'
            ? 'This is the service. Explain it in one sentence and list at most three documents. State fee or time only if asked, always with the demo notice.'
            : 'Several services could fit. Ask ONE short question to choose, naming the options in the caller\'s language. Do not state any fee yet.'
        },
        event: { type: 'service_matched', data: { query, found: true, confidence, services: picked.map((m) => m.item.id) } }
      }
    },

    async [TOOL_NAMES.listSlots](a) {
      const now = clock.now()
      const today = dubaiParts(now)
      const when = clean(a.when, 40).toLowerCase()
      const common = { today: today.date, now_dubai: `${today.date} ${today.time}` }
      if (when === 'next_available') {
        const slots = await calendar.nextAvailable(today.date, 4)
        return {
          body: { ok: true, ...common, slots: slots.map(slotView), instruction: 'Offer at most three of these.' },
          event: { type: 'slots_listed', data: { when, count: slots.length } }
        }
      }
      const resolved = resolveWhen(when, now)
      if (!resolved) {
        return { body: { ok: false, error_code: 'invalid_date', message: `Could not understand "${when}"`, ...common, instruction: "Ask the caller for a day, or use 'tomorrow' or a weekday name." } }
      }
      const slots = await calendar.freeSlots(resolved.date)
      if (slots.length === 0) {
        const alt = await calendar.nextAvailable(resolved.date, 3)
        return {
          body: {
            ok: true, ...common, date: resolved.date, date_spoken: spokenDate(resolved.date), slots: [],
            reason: 'No free slots that day (weekend, past, or fully booked).',
            alternatives: alt.map(slotView),
            instruction: 'Say there is nothing that day and offer the alternatives. Do not invent times.'
          },
          event: { type: 'slots_listed', data: { when, date: resolved.date, count: 0 } }
        }
      }
      return {
        body: {
          ok: true, ...common, date: resolved.date, date_spoken: spokenDate(resolved.date),
          slots: slots.slice(0, 6).map(slotView), total_free: slots.length,
          instruction: 'Offer at most three times, spread across the day. Never mention slots that are not listed.'
        },
        event: { type: 'slots_listed', data: { when, date: resolved.date, count: slots.length } }
      }
    },

    async [TOOL_NAMES.book](a, conversationId) {
      const service = getService(clean(a.service_id, 60), services)
      if (!service) return { body: { ok: false, error_code: 'unknown_service', message: 'No such service id', instruction: 'Call find_service again to get a valid id.' }, event: { type: 'tool_error', data: { code: 'unknown_service' } } }
      if (service.fulfilment !== 'appointment') {
        return { body: { ok: false, error_code: 'wrong_fulfilment', message: `${service.id} is not booked as an appointment`, instruction: service.fulfilment === 'ticket' ? 'Use log_request instead.' : 'This service is information only; explain it and offer a hand-over if they need more.' } }
      }
      const time = normalizeTime(clean(a.time, 10)) ?? clean(a.time, 10)
      const dateIn = clean(a.date, 20)
      const date = resolveWhen(dateIn, clock.now())?.date ?? dateIn
      const result = await calendar.book({
        serviceId: service.id, attendeeName: clean(a.attendee_name, 80), bookedByName: clean(a.booked_by_name, 80) || undefined,
        contact: clean(a.contact, 80), date, time, language: lang(a.language), conversationId
      })
      if (!result.ok) return calendarFailure(result)
      const { booking, duplicate } = result.value
      const notes = clean(a.notes, 500)
      const pass = passFromBooking(booking, services)
      const url = link(booking.ref)
      const sent = pass ? await fulfilled({ kind: 'booking', ref: booking.ref, pass, url, duplicate }, conversationId) : { pass_sent: false }
      return {
        body: {
          ok: true, booking: bookingView(booking), already_booked: duplicate, pass_on_screen: true, pass_sent: sent.pass_sent,
          instruction: `Confirm out loud: the service, the day, the time and the reference number digit by digit. Say it is a demo booking if the caller asks. A Smart Pass with the details is now on the screen${sentClause(sent.pass_sent)}. Then ask if there is anything else.`
        },
        event: { type: 'booking_created', data: { ref: booking.ref, service: service.id, date: booking.date, time: booking.time, attendee: booking.attendeeName, contact: maskContact(booking.contact), duplicate, ...(notes ? { notes } : {}), ...(pass ? { pass, pass_url: url, pass_sent: sent.pass_sent } : {}) } }
      }
    },

    async [TOOL_NAMES.reschedule](a) {
      const ref = normalizeRef(clean(a.ref, 30))
      if (!ref) return { body: { ok: false, error_code: 'invalid_ref', message: 'That is not a booking reference', instruction: 'Ask the caller to repeat the reference number.' } }
      const time = normalizeTime(clean(a.time, 10)) ?? clean(a.time, 10)
      const dateIn = clean(a.date, 20)
      const date = resolveWhen(dateIn, clock.now())?.date ?? dateIn
      const result = await calendar.reschedule(ref, date, time)
      if (!result.ok) return calendarFailure(result)
      const { booking, previous } = result.value
      const pass = passFromBooking(booking, services)
      return {
        body: { ok: true, booking: bookingView(booking), previous: { date_spoken: spokenDate(previous.date), time_spoken: spokenTime(previous.time) }, instruction: 'Confirm the new day and time out loud (the Smart Pass on the screen has updated), then ask if there is anything else.' },
        event: { type: 'booking_rescheduled', data: { ref, date: booking.date, time: booking.time, from: previous, ...(pass ? { pass, pass_url: link(ref) } : {}) } }
      }
    },

    async [TOOL_NAMES.cancel](a) {
      const ref = normalizeRef(clean(a.ref, 30))
      if (!ref) return { body: { ok: false, error_code: 'invalid_ref', message: 'That is not a booking reference', instruction: 'Ask the caller to repeat the reference number.' } }
      const result = await calendar.cancel(ref)
      if (!result.ok) return calendarFailure(result)
      const { booking, alreadyCancelled } = result.value
      return {
        body: { ok: true, booking: bookingView(booking), already_cancelled: alreadyCancelled, instruction: 'Confirm the cancellation, then offer to book a new time or ask if there is anything else.' },
        event: { type: 'booking_cancelled', data: { ref, already: alreadyCancelled } }
      }
    },

    async [TOOL_NAMES.checkBooking](a) {
      const ref = normalizeRef(clean(a.ref, 30))
      const booking = ref ? await calendar.get(ref) : undefined
      if (!booking) return { body: { ok: false, error_code: 'not_found', message: 'No booking with that reference', instruction: 'Ask the caller to check the number once more, then offer a hand-over.' } }
      return { body: { ok: true, booking: bookingView(booking) } }
    },

    async [TOOL_NAMES.checkRequest](a) {
      const ref = normalizeRef(clean(a.ref, 30), 'REQ')
      const r = ref ? await stores.requests.get(ref) : undefined
      if (!r) return { body: { ok: false, error_code: 'not_found', message: 'No request with that reference', instruction: 'Ask the caller to check the number once more, then offer a hand-over.' } }
      return { body: { ok: true, request: { ref: r.ref, ref_spoken: spokenRef(r.ref), service: getService(r.serviceId, services)?.name, caller_name: r.callerName, details: r.details, location: r.location, logged: 'yes', logged_at_dubai: `${dubaiParts(new Date(r.createdAt)).date} ${dubaiParts(new Date(r.createdAt)).time}` }, instruction: 'Read back what was logged in one sentence. The status is not tracked here: say the DSO team will follow up, and offer a hand-over for updates.' } }
    },

    async [TOOL_NAMES.serviceProcess](a) {
      const service = getService(clean(a.service_id, 60), services)
      if (!service) return { body: { ok: false, error_code: 'unknown_service', message: 'No such service id', instruction: 'Use an id from the service sheet.' } }
      return { body: { ok: true, ...serviceView(service), instruction: 'Give the steps one or two at a time, in the caller language. Any fee or time is a demo value.' } }
    },

    async [TOOL_NAMES.logRequest](a, conversationId) {
      const service = getService(clean(a.service_id, 60), services)
      if (!service || service.fulfilment !== 'ticket') {
        return { body: { ok: false, error_code: 'not_a_ticket_service', message: 'log_request is only for maintenance and complaints', instruction: 'Call find_service to pick the right service.' }, event: { type: 'tool_error', data: { code: 'not_a_ticket_service' } } }
      }
      // Urgency travels inside the details so any adapter (file, Supabase) and the dashboard see it without a new column.
      const urgent = a.urgency === 'emergency' ? '[EMERGENCY] ' : ''
      const details = `${urgent}${clean(a.details, 500)}`.slice(0, 520)
      const callerName = clean(a.caller_name, 80)
      const contact = clean(a.contact, 80)
      if (!callerName || contact.length < 3 || !details) {
        return { body: { ok: false, error_code: 'invalid_input', message: 'Name, contact and details are required', instruction: 'Ask the caller for the missing item.' } }
      }
      const key = [conversationId ?? 'no-conv', service.id, details.toLowerCase()].join('|')
      const existing = await stores.requests.findByKey(key)
      const request = existing ?? {
        ref: `REQ-${(await stores.requests.maxSequence()) + 1}`, serviceId: service.id, callerName, contact, details,
        location: clean(a.location, 80) || undefined, language: lang(a.language), conversationId, createdAt: clock.now().toISOString()
      }
      if (!existing) { await stores.requests.create(request); await stores.requests.saveKey(key, request.ref) }
      const pass = passFromRequest(request, services)
      const url = link(request.ref)
      const sent = pass ? await fulfilled({ kind: 'request', ref: request.ref, pass, url, duplicate: Boolean(existing) }, conversationId) : { pass_sent: false }
      return {
        body: {
          ok: true, ref: request.ref, ref_spoken: spokenRef(request.ref), service: service.name, already_logged: Boolean(existing),
          demo_timeline_text: service.timelineText, demo_notice: DEMO_NOTICE, pass_on_screen: true, pass_sent: sent.pass_sent,
          instruction: `Confirm that the request is logged and give the reference digit by digit. A Smart Pass with the reference is now on the screen${sentClause(sent.pass_sent)}. You may say the timeline only if the caller asks, as a demo value. Do not promise a time or an outcome.`
        },
        event: { type: 'request_logged', data: { ref: request.ref, service: service.id, caller: callerName, contact: maskContact(contact), summary: details.slice(0, 140), duplicate: Boolean(existing), ...(pass ? { pass, pass_url: url, pass_sent: sent.pass_sent } : {}) } }
      }
    },

    async [TOOL_NAMES.lookupFact](a) {
      const question = clean(a.question, 300)
      const found = lookupFact(question, facts)
      if (!found.found || !found.fact) {
        return {
          body: { ok: true, found: false, instruction: `That is not in the verified fact base. Say you do not know and do not guess. ${NOT_FOUND_HELP}` },
          event: { type: 'fact_lookup', data: { question: question.slice(0, 140), found: false } }
        }
      }
      return {
        body: { ok: true, found: true, answer: found.fact.answer, instruction: 'Say this answer in the caller\'s language, shortened if you can. Do not add facts.' },
        event: { type: 'fact_lookup', data: { question: question.slice(0, 140), found: true, fact: found.fact.id } }
      }
    },

    async [TOOL_NAMES.handover](a, conversationId) {
      const reason = (HANDOVER_REASONS as readonly string[]).includes(String(a.reason)) ? (a.reason as HandoverReason) : 'other'
      const summary = clean(a.summary, 500)
      // A joke or a test does not belong in the staff queue. Emergencies, disputes, legal questions, upset callers and
      // requests for a person are never filtered (see triage.ts).
      const verdict = triageHandover({ reason, summary })
      if (verdict.route === 'decline') {
        return {
          body: {
            ok: true, handed_over: false, reason_not_passed: verdict.why,
            instruction: 'Nobody on the DSO team has been notified, on purpose: this is not something staff can act on. Do not say you passed it on. Reply in one short, light, friendly sentence, say what you can help with (visas, licences, access cards, maintenance, complaints), and carry on. Do not offer a person.'
          },
          event: { type: 'handover_declined', data: { reason, summary: summary.slice(0, 140), why: verdict.why } }
        }
      }
      // The same caller must not create the same hand-over twice (the agent is told once; this makes it so).
      if (conversationId) {
        const open = (await stores.handovers.list()).find((h) => h.conversationId === conversationId && h.reason === reason && h.status === 'open')
        if (open) {
          return {
            body: {
              ok: true, handover_id: open.id, handover_ref_spoken: spokenRef(open.id), already_open: true, human_contact: HUMAN_CONTACT,
              instruction: 'The DSO team already has this from earlier in the conversation. Do not repeat the hand-over message. Say once that it has been noted, then carry on.'
            }
          }
        }
      }
      const handover = {
        // Digits only, so the agent can read it aloud (a random hex id came out as "H O four a one three...").
        id: `HO-${Math.floor(10000 + Math.random() * 90000)}`, reason, language: lang(a.language), summary,
        callerName: clean(a.caller_name, 80) || undefined, contact: clean(a.contact, 80) || undefined,
        conversationId, status: 'open' as const, createdAt: clock.now().toISOString()
      }
      await stores.handovers.create(handover)
      return {
        body: {
          ok: true, handover_id: handover.id, handover_ref_spoken: spokenRef(handover.id), human_contact: HUMAN_CONTACT,
          instruction: 'Tell the caller once, calmly, that the DSO team has been notified and a person will take over. Say what happens next in one sentence. You may offer the phone number (read it in groups) or an in-person appointment at the HALA desk (service desk_resolution) if they prefer. Do not promise a callback time, a refund, a waiver or an outcome. You cannot cancel a hand-over: if the caller changes their mind, say you have noted it and leave it at that.'
        },
        event: { type: 'handover_requested', data: { id: handover.id, reason, language: handover.language, summary: handover.summary, caller: handover.callerName } }
      }
    }
  }

  const authorised = (headers: Headers | Record<string, string | undefined>): boolean => {
    if (opts.insecureNoAuth) return true
    if (!opts.secret) return false // fail closed: no secret configured means no access
    const get = (n: string) => (headers instanceof Headers ? headers.get(n) : headers[n]) ?? ''
    return safeEqual(get('x-hala-secret'), opts.secret)
  }

  /** Entry point for POST /api/tools/:name. Framework-agnostic: give it headers and parsed JSON. */
  async function handle(name: string, headers: Headers | Record<string, string | undefined>, json: unknown): Promise<ToolResponse> {
    if (!authorised(headers)) return { status: 401, body: { ok: false, error_code: 'unauthorized' } }
    const spec = specByName(name)
    const handler = handlers[name]
    if (!spec || !handler) return { status: 404, body: { ok: false, error_code: 'unknown_tool' } }
    const parsed = schemaFor(spec).safeParse(json)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return {
        status: 200,
        body: { ok: false, error_code: 'invalid_input', message: `${issue?.path.join('.') || 'input'}: ${issue?.message}`, instruction: 'Ask the caller for the missing or unclear item, then try again.' }
      }
    }
    const conversationId = parsed.data.conversation_id
    try {
      const outcome = await handler(parsed.data as Args, conversationId)
      if (outcome.event) {
        const saved = Promise.resolve(stores.events.publish({ id: randomUUID(), ts: clock.now().toISOString(), conversationId, ...outcome.event })).catch(() => undefined)
        if (opts.deferEvents) return { status: 200, body: outcome.body, background: saved }
        await saved
      }
      return { status: 200, body: outcome.body }
    } catch (error) {
      await stores.events.publish({ id: randomUUID(), ts: clock.now().toISOString(), conversationId, type: 'tool_error', data: { tool: name, message: (error as Error).message.slice(0, 200) } })
      return { status: 200, body: { ok: false, error_code: 'internal_error', message: 'Something went wrong on our side', instruction: 'Apologise briefly and offer to connect the caller to the DSO team.' } }
    }
  }

  return { handle, calendar, stores }
}

export type ToolApi = ReturnType<typeof createToolApi>
