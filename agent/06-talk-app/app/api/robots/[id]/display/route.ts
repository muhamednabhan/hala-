import { ZodError } from 'zod'
import { COLORS, EMOJIS, FACE_PRIORITY, LED_MODES, LOOKS } from '@hala/robot'
import { hala, isAdmin, json } from '@/lib/server'
import { displayHistory, enqueueDisplay } from '@/lib/robot-display'

export const dynamic = 'force-dynamic'
type Ctx = { params: Promise<{ id: string }> }

/** GET /api/robots/:id/display: the catalogue for the test card (emoji, LED modes, looks) and the last commands with their results. */
export async function GET(req: Request, { params }: Ctx) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  const { id } = await params
  if (!(await (await hala()).robots.detail(id))) return json({ error: 'not found' }, 404)
  return json({ emojis: EMOJIS, ledModes: LED_MODES, colors: COLORS, looks: LOOKS, priority: FACE_PRIORITY, history: displayHistory(id) })
}

/** POST /api/robots/:id/display: queue a face / LED / QR / video test. The bridge runs it at its next sync (within about 2 s). */
export async function POST(req: Request, { params }: Ctx) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  const { id } = await params
  if (!(await (await hala()).robots.detail(id))) return json({ error: 'not found' }, 404)
  try {
    return json({ command: enqueueDisplay(id, await req.json().catch(() => ({}))) }, 201)
  } catch (e) {
    return e instanceof ZodError ? json({ error: e.issues[0]?.message ?? 'Invalid input', field: e.issues[0]?.path.join('.') }, 400) : json({ error: (e as Error).message }, 500)
  }
}
