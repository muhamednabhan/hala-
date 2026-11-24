import { hala, isAdmin, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/bookings | handovers | requests | events   (header x-hala-admin-key)
 * Read-only feed for teammate B's dashboard until it talks to Supabase directly.
 */
export async function GET(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  const { kind } = await ctx.params
  const { stores } = await hala()
  switch (kind) {
    case 'bookings': return json([...(await stores.bookings.list())].reverse())
    case 'handovers': return json([...(await stores.handovers.list())].reverse())
    case 'requests': return json([...(await stores.requests.list())].reverse())
    case 'events': return json([...(await stores.events.history())].reverse().slice(0, 200))
    default: return json({ error: 'unknown kind' }, 404)
  }
}
