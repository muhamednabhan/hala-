import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import type { AgentConfig } from './agent-config'

type Client = Pick<ElevenLabsClient, 'conversationalAi'>

export interface SyncResult {
  agentId: string
  created: boolean
  /** Other agents with the same name that were left untouched. Worth cleaning up by hand. */
  duplicates: string[]
}

/**
 * Create the agent, or update it in place. Idempotent:
 *  1. a pinned agent id (from env) is always updated, never duplicated;
 *  2. otherwise we look for an agent with exactly this name and update it;
 *  3. only if neither exists do we create one.
 * Re-run it whenever the tunnel URL, the prompt or the tools change.
 */
export async function syncAgent(client: Client, config: AgentConfig, pinnedId?: string): Promise<SyncResult> {
  const agents = client.conversationalAi.agents
  let duplicates: string[] = []
  let id = pinnedId

  if (!id) {
    const res = await agents.list({ search: config.name, pageSize: 100 })
    const same = res.agents.filter((a) => a.name === config.name)
    id = same[0]?.agentId
    duplicates = same.slice(1).map((a) => a.agentId)
  }

  if (id) {
    await agents.update(id, config as never)
    return { agentId: id, created: false, duplicates }
  }
  const created = await agents.create(config as never)
  return { agentId: created.agentId, created: true, duplicates }
}

/** Short-lived WebRTC token for a private agent. Never ship the API key to the browser. */
export async function conversationToken(client: Client, agentId: string): Promise<string> {
  return (await client.conversationalAi.conversations.getWebrtcToken({ agentId })).token
}

/** Redact the shared secret so a config can be printed or logged. */
export function redact(config: AgentConfig, secret: string): unknown {
  return JSON.parse(JSON.stringify(config).split(secret).join('***'))
}
