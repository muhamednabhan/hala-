import { agentId, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

/** GET /api/health: what is configured, never the values. Used by the live evals and by humans. */
export function GET() {
  return json({
    ok: true,
    keyConfigured: Boolean(process.env.ELEVENLABS_API_KEY),
    toolSecretConfigured: Boolean(process.env.HALA_TOOL_SECRET),
    webAgentConfigured: Boolean(agentId('web')),
    robotAgentConfigured: Boolean(agentId('robot')),
    publicBaseUrlConfigured: Boolean(process.env.PUBLIC_BASE_URL)
  })
}
