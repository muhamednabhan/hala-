import { normalizePhone } from '@hala/phone'
import { json } from '@/lib/server'
import { phone } from '@/lib/phone'
import { clientKey, createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const allow = createRateLimiter(120, 60_000)
/** A call nobody picked up inside this window becomes a missed call instead of ringing a stale phone. */
const RING_WINDOW_MS = 90_000

/**
 * GET /api/phone/inbox?phone=+9715..&since=<cursor>
 * Everything new for one number: texts HALA sent on its own (follow-ups, voice messages) and calls to ring.
 * The app polls this every couple of seconds while it is open.
 */
export async function GET(req: Request) {
  if (!allow(clientKey(req))) return json({ error: 'Too many requests.' }, 429)
  const url = new URL(req.url)
  const number = normalizePhone(url.searchParams.get('phone'))
  if (!number) return json({ error: 'phone is required' }, 400)
  const since = Math.max(0, Number(url.searchParams.get('since')) || 0)
  const { store } = await phone()

  const [messages, rings] = await Promise.all([store.messagesFor(number, since), store.ringsFor(number, since)])
  const now = Date.now()
  for (const r of rings) {
    if (r.status === 'pending' && now - Date.parse(r.createdAt) > RING_WINDOW_MS) {
      r.status = 'missed'
      await store.setRingStatus(r.id, 'missed')
    }
  }
  const cursor = Math.max(since, ...messages.map((m) => m.seq), ...rings.map((r) => r.seq))
  return json({ messages, rings, cursor })
}
