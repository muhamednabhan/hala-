import { agentId, hasApiKey, hasPublicUrl, json, setting } from '@/lib/server'
import { phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/**
 * GET /api/phone/status  What is ready for the phone demo. The app's "Test connection" shows this, so a
 * missing piece is named instead of surfacing as a silent failure in the middle of a call.
 * No secrets: only booleans and the storage mode.
 */
export async function GET() {
  const p = await phone()
  const checks = {
    server: true,
    elevenlabsKey: hasApiKey(),
    phoneAgent: Boolean(agentId('phone')),
    publicUrl: hasPublicUrl(),
    hackClubAi: Boolean(setting('HACKCLUB_AI_KEY'))
  }
  const missing = [
    !checks.elevenlabsKey && 'ELEVENLABS_API_KEY is missing',
    !checks.phoneAgent && 'the phone agent is not created: run npm run agent:sync -- --channel phone',
    !checks.publicUrl && 'PUBLIC_BASE_URL is not set (the agent cannot reach the tools)'
  ].filter(Boolean)
  return json({ ok: missing.length === 0, ...checks, store: p.storeKind, storeNote: p.storeNote ?? null, missing })
}
