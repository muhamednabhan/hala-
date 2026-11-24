import { ZodError } from 'zod'
import { hala, json } from '@/lib/server'
import { robotFromRequest } from '@/lib/robot-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/robot/sync (bridge -> website, every ~2 s). The bridge reports its state, log lines and command results;
 * the answer carries the robot's settings, whether it should be in a conversation (desired), and pending commands.
 */
export async function POST(req: Request) {
  const auth = await robotFromRequest(req)
  if ('error' in auth) return auth.error
  try {
    return json(await (await hala()).robots.sync(auth.robot, await req.json().catch(() => ({}))))
  } catch (e) {
    return e instanceof ZodError ? json({ error: 'bad sync message', detail: e.issues[0]?.message }, 400) : json({ error: (e as Error).message }, 500)
  }
}
