import { phone, readAudio } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/** GET /api/phone/audio/:id  A voice message HALA sent. The id is an unguessable UUID. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const bytes = readAudio((await phone()).audioDir, id)
  if (!bytes) return new Response('not found', { status: 404 })
  return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'audio/mpeg', 'content-length': String(bytes.length), 'cache-control': 'private, max-age=3600' } })
}
