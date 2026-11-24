import { hala, isAdmin, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

/** POST /api/robots/:id/token: issue a new pairing token (the old one stops working at once). Shown once. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  const res = await (await hala()).robots.regenerateToken((await params).id)
  return res ? json(res) : json({ error: 'not found' }, 404)
}
