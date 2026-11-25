import { json } from '@/lib/server'
import { loadPass } from '@/lib/pass'
import { clientKey, createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const allow = createRateLimiter(90, 60_000)

/** GET /api/pass/HALA-1001?k=<signature>: the pass and its live queue. The mobile pass page polls this. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  if (!allow(clientKey(req))) return json({ error: 'Too many requests.' }, 429)
  const { ref } = await ctx.params
  const found = await loadPass(ref, new URL(req.url).searchParams.get('k'))
  return found ? json(found) : json({ error: 'not found' }, 404)
}
