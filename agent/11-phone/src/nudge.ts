import { dubaiInstant, type BookingRepo, type Lang } from '@hala/core'
import { getService } from '@hala/catalogue'
import { spokenDate, spokenTime } from '@hala/tools-api'
import type { ChatPort } from './hackclub-ai'
import { samePhone } from './numbers'
import type { PhoneStore } from './store'

/**
 * Proactive calls: HALA rings a phone when something is coming up for that person.
 *
 * Division of labour (on purpose):
 *  - WHAT is worth a call, and the FACTS, come from the store (an appointment inside the window).
 *    Deterministic code decides; a model never invents a reason.
 *  - HOW it is said is phrased by a small cheap model (Hack Club AI), then checked against the facts.
 *    If the model is missing, slow or off-script, a fixed template is used instead.
 *  - The AI disclosure is added by code, so no model output can leave it out.
 * When Supabase arrives, only the `bookings` source changes.
 */

export interface NudgeCandidate {
  key: string
  phone: string
  language: Lang
  kind: 'appointment_reminder'
  name?: string
  facts: { ref: string; service: string; serviceAr: string; date: string; time: string; dateSpoken: { en: string; ar: string }; timeSpoken: { en: string; ar: string } }
  /** Plain-words reason shown on the admin screen. */
  reason: string
}

export const AI_INTRO = {
  en: 'Hi, this is HALA, an AI assistant from Dubai Silicon Oasis.',
  ar: 'مرحباً، معك هلا، مساعدة ذكاء اصطناعي من واحة دبي للسيليكون.'
}

export interface PlanOptions {
  bookings: BookingRepo
  store: PhoneStore
  now?: Date
  /** How far ahead an appointment counts as "coming up". */
  withinHours?: number
  /** Only this phone, for a targeted scan. */
  phone?: string
  /** Include appointments that already triggered a call (the demo button rings again on purpose). */
  ignoreNudged?: boolean
}

export async function planNudges(o: PlanOptions): Promise<NudgeCandidate[]> {
  const now = o.now ?? new Date()
  const horizon = (o.withinHours ?? 24) * 3_600_000
  const [bookings, contacts] = await Promise.all([o.bookings.list(), o.store.listContacts()])
  const out: NudgeCandidate[] = []
  for (const b of bookings) {
    if (b.status !== 'confirmed') continue
    const start = dubaiInstant(b.date, b.time)
    if (!start) continue
    const until = start.getTime() - now.getTime()
    if (until <= 0 || until > horizon) continue
    const contact = contacts.find((c) => samePhone(c.phone, b.contact) && (!o.phone || c.phone === o.phone))
    if (!contact) continue
    const key = `reminder:${b.ref}:${b.date}T${b.time}:${contact.phone}`
    if (!o.ignoreNudged && (await o.store.hasNudged(key))) continue
    const service = getService(b.serviceId)
    const dateSpoken = spokenDate(b.date)
    const timeSpoken = spokenTime(b.time)
    out.push({
      key, phone: contact.phone, language: contact.language, kind: 'appointment_reminder', name: contact.name,
      facts: {
        ref: b.ref, service: service?.name.en ?? b.serviceId, serviceAr: service?.name.ar ?? b.serviceId,
        date: b.date, time: b.time, dateSpoken: { en: dateSpoken.en, ar: dateSpoken.ar }, timeSpoken: { en: timeSpoken.en, ar: timeSpoken.ar }
      },
      reason: `Appointment ${b.ref} (${service?.name.en ?? b.serviceId}) on ${b.date} at ${b.time} Dubai time`
    })
  }
  return out
}

/** The fixed wording. Used when there is no model, or the model's text fails the checks. */
export function templateBody(c: NudgeCandidate): string {
  const f = c.facts
  return c.language === 'ar'
    ? `أتصل لأذكّرك بموعد ${f.serviceAr} يوم ${f.dateSpoken.ar} الساعة ${f.timeSpoken.ar}. تبغى تبقيه، أو تغيّره، أو تلغيه؟`
    : `I'm calling to remind you about your ${f.service} appointment on ${f.dateSpoken.en} at ${f.timeSpoken.en}. Would you like to keep it, move it, or cancel it?`
}

const SYSTEM = (lang: Lang) =>
  `You write what a phone assistant says right after saying hello, in ${lang === 'ar' ? 'Gulf-friendly Modern Standard Arabic (the assistant is female)' : 'English'}. ` +
  'Rules: use ONLY the facts you are given. State the service, the day and the time exactly as given. ' +
  'Then ask one short question: keep it, move it, or cancel it. Maximum 40 words. Plain speech: no emojis, no lists, no links, no greeting, no mention of being an AI (that is said separately).'

/** The model's text must carry the real time and stay short, or we do not use it. */
export function acceptable(text: string, c: NudgeCandidate): boolean {
  const hhmm = c.facts.timeSpoken.en.replace(/ (AM|PM)$/i, '')
  return text.length > 20 && text.length <= 400 && text.includes(hhmm) && !/https?:|www\./i.test(text) && !/[#*_`]/.test(text)
}

/** What HALA says first on the call. */
export async function composeOpening(c: NudgeCandidate, ai?: ChatPort): Promise<{ text: string; byModel: boolean }> {
  const intro = AI_INTRO[c.language]
  if (ai) {
    const f = c.facts
    const facts = c.language === 'ar'
      ? `الخدمة: ${f.serviceAr}\nاليوم: ${f.dateSpoken.ar}\nالوقت: ${f.timeSpoken.ar}`
      : `Service: ${f.service}\nDay: ${f.dateSpoken.en}\nTime: ${f.timeSpoken.en}`
    const out = await ai.complete(SYSTEM(c.language), facts, { maxTokens: 120 })
    if (out && acceptable(out, c)) return { text: `${intro} ${out}`, byModel: true }
  }
  return { text: `${intro} ${templateBody(c)}`, byModel: false }
}

/** Plan, phrase and queue the calls. Returns what was queued. */
export async function queueNudges(o: PlanOptions & { ai?: ChatPort }) {
  const queued: { ringId: string; phone: string; reason: string; byModel: boolean }[] = []
  for (const c of await planNudges(o)) {
    const { text, byModel } = await composeOpening(c, o.ai)
    const ring = await o.store.addRing({ phone: c.phone, reason: c.reason, opening: text, language: c.language, kind: c.kind, nudgeKey: c.key })
    queued.push({ ringId: ring.id, phone: c.phone, reason: c.reason, byModel })
  }
  return queued
}
