import { agentId, hasApiKey, hasPublicUrl, hasToolSecret, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

/** GET /api/health: what is configured, never the values. Used by the live evals and by humans. */
export function GET() {
  return json({
    ok: true,
    keyConfigured: hasApiKey(),
    toolSecretConfigured: hasToolSecret(),
    webAgentConfigured: Boolean(agentId('web')),
    robotAgentConfigured: Boolean(agentId('robot')),
    publicBaseUrlConfigured: hasPublicUrl()
  })
}
