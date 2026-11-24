import { ZodError } from 'zod'
import { hala, isAdmin, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

const problem = (e: unknown) =>
  e instanceof ZodError ? json({ error: e.issues[0]?.message ?? 'Invalid input', field: e.issues[0]?.path.join('.') }, 400) : json({ error: (e as Error).message }, 500)

/** GET /api/robots: every robot with live status. Header x-hala-admin-key. */
export async function GET(req: Request) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  const { robots, robotsNote } = await hala()
  return json({ robots: await robots.list(), ...(robotsNote ? { note: robotsNote } : {}) })
}

/** POST /api/robots: add a robot. Returns the pairing token ONCE; only its hash is stored. */
export async function POST(req: Request) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  try {
    const { robots } = await hala()
    return json(await robots.create(await req.json().catch(() => ({}))), 201)
  } catch (e) { return problem(e) }
}
