import { elevenlabs } from '@/lib/eleven'
import { agentId, hasApiKey, json, setting } from '@/lib/server'
import { clientKey, createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const allow = createRateLimiter(12, 60_000)

/**
 * GET /api/token?channel=web  ->  { token, agentId }
 * Exchanges the server-side API key for a short-lived WebRTC token. The key itself never leaves the server.
 */
export async function GET(req: Request) {
  if (!allow(clientKey(req))) return json({ error: 'Too many requests, try again in a minute.' }, 429)
  const channel = new URL(req.url).searchParams.get('channel') === 'robot' ? 'robot' : 'web'
  const id = agentId(channel)
  if (!id) return json({ error: 'The agent is not set up yet. Run `npm run agent:sync` first.' }, 503)
  if (!hasApiKey()) return json({ error: 'ELEVENLABS_API_KEY is missing on the server.' }, 503)
  try {
    const { token } = await elevenlabs().conversationalAi.conversations.getWebrtcToken({ agentId: id })
    // The booking procedure starts with the conversation, so the first booking request needs no extra model step.
    const start = (channel === 'robot' ? setting('HALA_PROC_START_ROBOT') : setting('HALA_PROC_START_WEB')) ?? ''
    return json({ token, agentId: id, startProcedureIds: start ? start.split(',') : [] })
  } catch (e) {
    console.error('token error', (e as Error).message)
    return json({ error: 'Could not start a conversation. Check the server log.' }, 502)
  }
}
