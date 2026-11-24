import { dubaiParts } from '@hala/core'
import { SERVICES } from '@hala/catalogue'
import { composeOpening, normalizePhone, planNudges, samePhone } from '@hala/phone'
import { hala, json } from '@/lib/server'
import { manualOpening, phone } from '@/lib/phone'
import { clientKey, createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const allow = createRateLimiter(8, 60_000)

/**
 * POST /api/phone/demo  { phone, kind: 'reminder' | 'hello' }
 *
 * The one-tap demo for the "HALA calls me" flow. It only ever rings the phone that asked, and it is
 * rate limited, so it needs no admin key. A dummy-phone app on a demo number is all it can reach.
 *  - hello:    HALA rings with a plain "checking your line works" opening.
 *  - reminder: if that number has no upcoming appointment, one is booked in the next free slot (demo data),
 *              then HALA rings about it. The wording comes from the booking: a small model phrases it,
 *              the facts are checked, the AI disclosure is always in front.
 */
export async function POST(req: Request) {
  if (!allow(clientKey(req))) return json({ error: 'Slow down: a few demo calls a minute.' }, 429)
  const b = (await req.json().catch(() => ({}))) as { phone?: unknown; kind?: unknown }
  const number = normalizePhone(b.phone)
  if (!number) return json({ error: 'phone is required' }, 400)
  const { store, ai } = await phone()
  const contact = await store.touchContact(number)

  if (b.kind !== 'reminder') {
    const ring = await store.addRing({ phone: number, language: contact.language, kind: 'manual', reason: 'Demo call: line check', opening: manualOpening(contact.language) })
    return json({ ok: true, ring })
  }

  const h = await hala()
  const now = new Date()
  const twoWeeks = 24 * 14
  let plan = await planNudges({ bookings: h.stores.bookings, store, now, withinHours: twoWeeks, phone: number, ignoreNudged: true })
  let booked: string | undefined
  if (plan.length === 0) {
    const service = SERVICES.find((s) => s.id === 'access_card' && s.fulfilment === 'appointment') ?? SERVICES.find((s) => s.fulfilment === 'appointment')
    const [slot] = await h.api.calendar.nextAvailable(dubaiParts(now).date, 1)
    if (!service || !slot) return json({ error: 'No free appointment slot to demo with.' }, 409)
    const result = await h.api.calendar.book({
      serviceId: service.id, attendeeName: contact.name ?? 'Demo caller', contact: number,
      date: slot.date, time: slot.time, language: contact.language
    })
    if (!result.ok) return json({ error: 'Could not book a demo slot.' }, 409)
    booked = result.value.booking.ref
    plan = await planNudges({ bookings: h.stores.bookings, store, now, withinHours: twoWeeks, phone: number, ignoreNudged: true })
  }
  // The soonest appointment this phone has.
  const next = plan.filter((c) => samePhone(c.phone, number)).sort((a, c) => (a.facts.date + a.facts.time).localeCompare(c.facts.date + c.facts.time))[0]
  if (!next) return json({ error: 'No appointment found for this number.' }, 409)

  const { text, byModel } = await composeOpening(next, ai)
  const ring = await store.addRing({ phone: number, language: next.language, kind: 'appointment_reminder', reason: next.reason, opening: text })
  return json({ ok: true, ring, byModel, bookedNow: booked ?? null })
}
