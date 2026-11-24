import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { listKnowledgeAnswers, type SupabaseOptions } from '@hala/supabase'
import { DOC_PREFIX, buildAnswersDoc } from './format'

type Client = Pick<ElevenLabsClient, 'conversationalAi'>

export interface LiveSyncDeps {
  supabase: SupabaseOptions
  eleven: Client
  /** The agents that should know the answers (web and robot). */
  agentIds: string[]
}

export type LiveSyncResult =
  | { status: 'unchanged'; answers: number; doc: string }
  | { status: 'updated'; answers: number; doc: string; replaced: number }
  | { status: 'empty'; answers: 0; removed: number }

interface Locator { type: 'text'; name: string; id: string; usageMode: 'auto' }

/** Replace (or remove) the live-answers document in one agent's knowledge base. Other documents are left exactly as they are. */
export async function setAgentLiveDoc(eleven: Client, agentId: string, doc?: { id: string; name: string }): Promise<boolean> {
  const agents = eleven.conversationalAi.agents
  const agent = (await agents.get(agentId)) as unknown as { conversationConfig: { agent: { prompt: { knowledgeBase?: { type: string; name: string; id: string; usageMode?: string }[] } } } }
  const current = agent.conversationConfig.agent.prompt.knowledgeBase ?? []
  const kept = current.filter((k) => !k.name.startsWith(DOC_PREFIX))
  const next: typeof current = doc ? [...kept, { type: 'text', name: doc.name, id: doc.id, usageMode: 'auto' } as Locator] : kept
  const same = next.length === current.length && next.every((k, i) => k.id === current[i]!.id)
  if (same) return false
  // Only the knowledge-base list is sent: the platform merges it into the rest of the config, which stays untouched.
  await agents.update(agentId, { conversationConfig: { agent: { prompt: { knowledgeBase: next } } } } as never)
  return true
}

/**
 * Read the staff answer bank and make the agents' knowledge base match it.
 * Idempotent: the document name carries a content hash, so unchanged answers cost one Supabase read and one list call.
 */
export async function syncLiveAnswers({ supabase, eleven, agentIds }: LiveSyncDeps): Promise<LiveSyncResult> {
  const kb = eleven.conversationalAi.knowledgeBase
  const doc = buildAnswersDoc(await listKnowledgeAnswers(supabase))
  const existing = (await kb.list({ search: DOC_PREFIX, pageSize: 100 })).documents.filter((d) => d.name.startsWith(DOC_PREFIX))

  if (!doc) {
    // No usable answers (none yet, or all withdrawn): make sure the agents do not keep an old document.
    for (const id of agentIds) await setAgentLiveDoc(eleven, id, undefined)
    for (const d of existing) { try { await kb.documents.delete(d.id, { force: true }) } catch { /* still referenced: next run */ } }
    return { status: 'empty', answers: 0, removed: existing.length }
  }

  const same = existing.find((d) => d.name === doc.name)
  if (same) {
    // The document is current. Make sure every agent points at it (e.g. an agent was re-synced and lost the link).
    let touched = false
    for (const id of agentIds) touched = (await setAgentLiveDoc(eleven, id, { id: same.id, name: same.name })) || touched
    return touched ? { status: 'updated', answers: doc.count, doc: same.name, replaced: 0 } : { status: 'unchanged', answers: doc.count, doc: same.name }
  }

  const made = await kb.documents.createFromText({ text: doc.text, name: doc.name })
  // multilingual embeddings so Arabic questions find English answers and the other way round
  await kb.getOrCreateRagIndexes({ items: [{ documentId: made.id, createIfMissing: true, model: 'multilingual_e5_large_instruct' }] } as never)
  for (const id of agentIds) await setAgentLiveDoc(eleven, id, { id: made.id, name: doc.name })
  for (const d of existing) { try { await kb.documents.delete(d.id, { force: true }) } catch { /* next run */ } }
  return { status: 'updated', answers: doc.count, doc: doc.name, replaced: existing.length }
}
