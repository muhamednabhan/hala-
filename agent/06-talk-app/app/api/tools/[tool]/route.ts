import { isPhoneTool } from '@hala/phone'
import { hala, json } from '@/lib/server'
import { phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/** POST /api/tools/:tool, called by ElevenLabs servers (webhook tools). Needs the x-hala-secret header. */
export async function POST(req: Request, ctx: { params: Promise<{ tool: string }> }) {
  const { tool } = await ctx.params
  const body = await req.json().catch(() => ({}))
  const res = isPhoneTool(tool) ? await (await phone()).tools.handle(tool, req.headers, body) : await (await hala()).api.handle(tool, req.headers, body)
  return json(res.body, res.status)
}
