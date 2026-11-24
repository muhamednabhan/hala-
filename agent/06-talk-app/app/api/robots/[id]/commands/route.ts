import { ZodError } from 'zod'
import { hala, isAdmin, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

/** POST /api/robots/:id/commands { type: speaker_test | say | set_volume | reconnect, ... }. The bridge picks it up within ~2 s. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  try {
    const cmd = await (await hala()).robots.enqueue((await params).id, await req.json().catch(() => ({})))
    return cmd ? json({ command: cmd }, 201) : json({ error: 'not found' }, 404)
  } catch (e) {
    return e instanceof ZodError ? json({ error: e.issues[0]?.message ?? 'Invalid command' }, 400) : json({ error: (e as Error).message }, 500)
  }
}
