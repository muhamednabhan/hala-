import { z } from 'zod'
import { DEFAULT_VOICE_ID } from '@hala/provisioning'
import { elevenlabs } from '@/lib/eleven'
import { hasApiKey, json, setting_ } from '@/lib/server'
import { robotFromRequest } from '@/lib/robot-auth'
import { createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const allow = createRateLimiter(12, 60_000)
const body = z.object({ text: z.string().trim().min(1).max(300) })

/**
 * POST /api/robot/tts { text } -> raw PCM, 16 kHz mono S16LE. Used by the "Say a sentence" test: the clip is played
 * through exactly the speaker path the agent uses, with the agent's voice. Costs a few ElevenLabs credits per sentence.
 */
export async function POST(req: Request) {
  const auth = await robotFromRequest(req)
  if ('error' in auth) return auth.error
  if (!allow(auth.robot.id)) return json({ error: 'Too many test sentences, wait a minute.' }, 429)
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return json({ error: 'text must be 1-300 characters' }, 400)
  if (!hasApiKey()) return json({ error: 'ELEVENLABS_API_KEY is missing on the server.' }, 503)
  try {
    const stream = await elevenlabs().textToSpeech.convert(setting_('HALA_VOICE_ID') ?? DEFAULT_VOICE_ID, {
      text: parsed.data.text, modelId: 'eleven_flash_v2_5', outputFormat: 'pcm_16000'
    })
    const pcm = await new Response(stream as unknown as BodyInit).arrayBuffer()
    return new Response(pcm, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' } })
  } catch (e) {
    console.error('robot tts error', (e as Error).message)
    return json({ error: 'Text to speech failed.' }, 502)
  }
}
