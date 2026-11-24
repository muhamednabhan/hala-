import { ZodError } from 'zod'
import { hala, isAdmin, json } from '@/lib/server'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

const problem = (e: unknown) =>
  e instanceof ZodError ? json({ error: e.issues[0]?.message ?? 'Invalid input', field: e.issues[0]?.path.join('.') }, 400) : json({ error: (e as Error).message }, 500)

/** GET /api/robots/:id: robot, recent log lines and commands. */
export async function GET(req: Request, { params }: Ctx) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  const found = await (await hala()).robots.detail((await params).id)
  return found ? json(found) : json({ error: 'not found' }, 404)
}

/** PATCH /api/robots/:id: change settings, or desired = running | stopped (the Start / Stop buttons). */
export async function PATCH(req: Request, { params }: Ctx) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  try {
    const robot = await (await hala()).robots.update((await params).id, await req.json().catch(() => ({})))
    return robot ? json({ robot }) : json({ error: 'not found' }, 404)
  } catch (e) { return problem(e) }
}

export async function DELETE(req: Request, { params }: Ctx) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  return (await (await hala()).robots.remove((await params).id)) ? json({ ok: true }) : json({ error: 'not found' }, 404)
}
