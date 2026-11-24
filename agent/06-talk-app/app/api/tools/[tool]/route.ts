import { after } from 'next/server'
import { hala, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

/** POST /api/tools/:tool, called by ElevenLabs servers (webhook tools). Needs the x-hala-secret header. */
export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const { tool } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const res = await (await hala()).api.handle(tool, req.headers, body)
  // The caller is waiting on this answer. Saving the event is not part of it: do that after the response is sent.
  if (res.background) after(() => res.background)
  return json(res.body, res.status)
}
