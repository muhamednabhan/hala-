import { agentId, hala, hasApiKey, hasPublicUrl, hasToolSecret, json } from '@/lib/server'

export const dynamic = 'force-dynamic'

/** GET /api/health: what is configured, never the values. Used by the live evals and by humans. */
export async function GET() {
  const { storeKind, storeNote, robotsNote } = await hala()
  return json({
    store: storeKind,
    ...(storeNote ? { storeNote } : {}),
    ...(robotsNote ? { robotsNote } : {}),
    ok: true,
    keyConfigured: hasApiKey(),
    toolSecretConfigured: hasToolSecret(),
    webAgentConfigured: Boolean(agentId('web')),
    robotAgentConfigured: Boolean(agentId('robot')),
    publicBaseUrlConfigured: hasPublicUrl()
  })
}
