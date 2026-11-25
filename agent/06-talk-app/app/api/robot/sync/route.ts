import { ZodError } from 'zod'
import { hala, json } from '@/lib/server'
import { robotFromRequest } from '@/lib/robot-auth'
import { applyDisplayResults, directiveFor, takePending } from '@/lib/robot-display'
import { publicOrigin } from '@/lib/pass'

export const dynamic = 'force-dynamic'

/**
 * POST /api/robot/sync (bridge -> website, every ~2 s). The bridge reports its state, log lines and command results;
 * the answer carries the robot's settings, whether it should be in a conversation (desired), and pending commands.
 * Since bridge 1.1.0 it also carries `display`: what the robot's screen and face should do for its current conversation,
 * and the dashboard's face/screen/LED test commands arrive as `display` commands.
 */
export async function POST(req: Request) {
  const auth = await robotFromRequest(req)
  if ('error' in auth) return auth.error
  try {
    const body = (await req.json().catch(() => ({}))) as { state?: { phase?: string; conversationId?: string }; results?: unknown }
    const res = await (await hala()).robots.sync(auth.robot, body)
    applyDisplayResults(auth.robot.id, body.results)
    const live = body.state?.phase === 'conversation' ? body.state.conversationId : undefined
    // never let the face break the sync: a database hiccup just means no new moment this round
    const display = await directiveFor(live, publicOrigin(req)).catch(() => ({ qr: null, look: null }))
    const tests = takePending(auth.robot.id).map((c) => ({ id: c.id, type: 'display', payload: c.command }))
    return json({ ...res, commands: [...res.commands, ...tests], display })
  } catch (e) {
    return e instanceof ZodError ? json({ error: 'bad sync message', detail: e.issues[0]?.message }, 400) : json({ error: (e as Error).message }, 500)
  }
}
