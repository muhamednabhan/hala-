import { after } from 'next/server'
import { isPhoneTool } from '@hala/phone'
import { hala, json } from '@/lib/server'
import { phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/** POST /api/tools/:tool, called by ElevenLabs servers (webhook tools). Needs the x-hala-secret header. */
export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const { tool } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const res: { status: number; body: Record<string, unknown>; background?: Promise<unknown> } = isPhoneTool(tool) ? await (await phone()).tools.handle(tool, req.headers, body) : await (await hala()).api.handle(tool, req.headers, body)
  // The caller is waiting on this answer. Saving the event is not part of it: do that after the response is sent.
  if (res.background) after(() => res.background)
  return json(res.body, res.status)
}
