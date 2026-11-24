import { normalizePhone, type RingStatus } from '@hala/phone'
import { json } from '@/lib/server'
import { phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'
const ALLOWED: RingStatus[] = ['delivered', 'answered', 'declined', 'missed']

/** POST /api/phone/ring/:id  { phone, status }  The app reports what the person did with the call. */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const b = (await req.json().catch(() => ({}))) as { phone?: unknown; status?: unknown }
  const { store } = await phone()
  const ring = await store.getRing(id)
  if (!ring || ring.phone !== normalizePhone(b.phone)) return json({ error: 'unknown call' }, 404)
  if (!ALLOWED.includes(b.status as RingStatus)) return json({ error: 'bad status' }, 400)
  return json({ ok: true, ring: await store.setRingStatus(id, b.status as RingStatus) })
}
