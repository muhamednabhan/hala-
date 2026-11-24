import { SmsError } from '@hala/phone'
import { json } from '@/lib/server'
import { phone } from '@/lib/phone'
import { clientKey, createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
const allow = createRateLimiter(40, 60_000)

/**
 * POST /api/phone/sms  { from, body, voice? }
 * A text from the HALA Phone app. The server links codes, asks the agent (same brain and tools as a call)
 * and returns the replies. `voice: true` asks for the answer as a spoken voice message.
 */
export async function POST(req: Request) {
  if (!allow(clientKey(req))) return json({ error: 'Too many texts, slow down.' }, 429)
  const b = (await req.json().catch(() => ({}))) as { from?: unknown; body?: unknown; voice?: unknown }
  if (typeof b.from !== 'string' || typeof b.body !== 'string') return json({ error: 'from and body are required' }, 400)
  try {
    const result = await (await phone()).sms.receive({ from: b.from, body: b.body, voice: b.voice === true })
    return json({ message: result.message, replies: result.replies, linked: Boolean(result.linked) })
  } catch (e) {
    if (e instanceof SmsError) return json({ error: e.code === 'empty' ? 'Empty message' : 'That is not a valid phone number' }, 400)
    console.error('sms error', (e as Error).message)
    return json({ error: 'Could not process the text' }, 500)
  }
}
