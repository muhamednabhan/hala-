import { normalizePhone } from '@hala/phone'
import { isAdmin, json } from '@/lib/server'
import { phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * POST /api/phone/nudge  (admin)  { phone? }
 * Looks at the bookings store for people with an appointment in the next 24 hours whose phone is linked,
 * has a small model word the call (Hack Club AI, checked against the facts), and queues the call.
 * Set HALA_NUDGE_AUTO=1 to run this every minute by itself.
 */
export async function POST(req: Request) {
  if (!(await isAdmin(req))) return json({ error: 'admin key required' }, 401)
  const b = (await req.json().catch(() => ({}))) as { phone?: unknown }
  const queued = await (await phone()).runNudges(b.phone ? normalizePhone(b.phone) : undefined)
  return json({ ok: true, queued })
}
