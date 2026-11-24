import { hala, isAdmin } from '@/lib/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/events?conversation_id=...  Server-sent events for one conversation (the live screen).
 * GET /api/events?key=<admin key>      Every conversation (the admin dashboard).
 */
export async function GET(req: Request) {
  const conversationId = new URL(req.url).searchParams.get('conversation_id') ?? undefined
  if (!conversationId && !(await isAdmin(req))) return new Response('conversation_id or admin key required', { status: 401 })

  const { stores } = await hala()
  const enc = new TextEncoder()
  let off: (() => void) | undefined
  let beat: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: unknown, event = 'hala') => {
        try { controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) } catch { /* closed */ }
      }
      controller.enqueue(enc.encode('retry: 2000\n\n'))
      const history = await stores.events.history(conversationId)
      for (const e of history.slice(-100)) send(e)
      off = stores.events.subscribe((e) => send(e), conversationId)
      beat = setInterval(() => { try { controller.enqueue(enc.encode(': ping\n\n')) } catch { /* closed */ } }, 15_000)
      req.signal.addEventListener('abort', () => { off?.(); clearInterval(beat); try { controller.close() } catch { /* closed */ } })
    },
    cancel() { off?.(); clearInterval(beat) }
  })

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' }
  })
}
