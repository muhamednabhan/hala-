import { agentId, hala, hasApiKey, hasPublicUrl, hasToolSecret, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

/** GET /api/health: what is configured, never the values. Used by the live evals and by humans. */
export async function GET() {
  const { storeKind, storeNote } = await hala()
  return json({
    store: storeKind,
    ...(storeNote ? { storeNote } : {}),
    ok: true,
    keyConfigured: hasApiKey(),
    toolSecretConfigured: hasToolSecret(),
    webAgentConfigured: Boolean(agentId('web')),
    robotAgentConfigured: Boolean(agentId('robot')),
    publicBaseUrlConfigured: hasPublicUrl()
  })
}
