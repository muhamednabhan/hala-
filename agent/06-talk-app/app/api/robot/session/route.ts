import { elevenlabs } from '@/lib/eleven'
import { agentId, hasApiKey, json } from '@/lib/server'
import { robotFromRequest } from '@/lib/robot-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/robot/session: a short-lived signed websocket link to the ROBOT agent (PCM 16 kHz in and out).
 * The robot never holds the ElevenLabs API key, and only a paired robot with desired=running can start a conversation.
 */
export async function POST(req: Request) {
  const auth = await robotFromRequest(req)
  if ('error' in auth) return auth.error
  if (auth.robot.desired !== 'running') return json({ error: 'The robot is stopped on the website. Press Start first.' }, 409)
  const id = agentId('robot')
  if (!id) return json({ error: 'The robot agent is not set up. Run `npm run agent:sync -- --channel robot`.' }, 503)
  if (!hasApiKey()) return json({ error: 'ELEVENLABS_API_KEY is missing on the server.' }, 503)
  try {
    const { signedUrl } = await elevenlabs().conversationalAi.conversations.getSignedUrl({ agentId: id })
    return json({ signedUrl, agentId: id })
  } catch (e) {
    console.error('robot session error', (e as Error).message)
    return json({ error: 'Could not open a conversation with ElevenLabs.' }, 502)
  }
}
