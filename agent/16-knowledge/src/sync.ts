import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { TOOL_NAMES } from '@hala/tools-api'
import { buildProcedures } from '@hala/core'
import { rulesHash, toApiRules } from './pronunciation'
import { loadDocs } from './docs'

type Client = Pick<ElevenLabsClient, 'conversationalAi' | 'pronunciationDictionaries'>

// ---------------------------------------------------------------- pronunciation

export interface DictionaryRef { pronunciationDictionaryId: string; versionId: string; created: boolean }

/** Create the pronunciation dictionary for the current rules, or reuse it when nothing changed. */
export async function syncPronunciation(client: Client): Promise<DictionaryRef> {
  const name = `HALA UAE ${rulesHash()}`
  const list = await client.pronunciationDictionaries.list({ pageSize: 100 })
  const found = list.pronunciationDictionaries.find((d) => d.name === name)
  if (found) return { pronunciationDictionaryId: found.id, versionId: found.latestVersionId, created: false }
  const made = await client.pronunciationDictionaries.createFromRules({
    name, description: 'HALA concierge: UAE places, DSO names, acronyms, Gulf Arabic words', rules: toApiRules()
  })
  return { pronunciationDictionaryId: made.id, versionId: made.versionId, created: true }
}

// ---------------------------------------------------------------- knowledge base

export interface KbRef { id: string; name: string; created: boolean }

/** Upload each document once per content version, drop superseded versions, and build the retrieval index. */
export async function syncKnowledgeBase(client: Client): Promise<KbRef[]> {
  const kb = client.conversationalAi.knowledgeBase
  const existing = (await kb.list({ search: 'HALA ', pageSize: 100 })).documents
  const out: KbRef[] = []
  for (const doc of loadDocs()) {
    const same = existing.find((e) => e.name === doc.name)
    if (same) { out.push({ id: same.id, name: doc.name, created: false }); continue }
    for (const old of existing.filter((e) => e.name.startsWith(`HALA ${doc.key} #`))) {
      try { await kb.documents.delete(old.id, { force: true }) } catch { /* in use by an agent: leave it, the agent config moves on */ }
    }
    const made = await kb.documents.createFromText({ text: doc.text, name: doc.name })
    out.push({ id: made.id, name: doc.name, created: true })
  }
  // multilingual embeddings so Arabic questions retrieve English documents
  await kb.getOrCreateRagIndexes({ items: out.map((d) => ({ documentId: d.id, createIfMissing: true, model: 'multilingual_e5_large_instruct' })) } as never)
  return out
}

// ---------------------------------------------------------------- procedures

const TOOLS = {
  findService: TOOL_NAMES.findService, serviceProcess: TOOL_NAMES.serviceProcess, listSlots: TOOL_NAMES.listSlots, book: TOOL_NAMES.book,
  reschedule: TOOL_NAMES.reschedule, cancel: TOOL_NAMES.cancel, checkBooking: TOOL_NAMES.checkBooking, checkRequest: TOOL_NAMES.checkRequest,
  logRequest: TOOL_NAMES.logRequest, handover: TOOL_NAMES.handover
}

/** Create or update each procedure draft on the agent's main branch, then publish them in one new agent version. */
export async function syncProcedures(client: Client, agentId: string, description = 'HALA procedures') {
  const agents = client.conversationalAi.agents
  const agent = await agents.get(agentId)
  const branchId = (agent as unknown as { mainBranchId: string }).mainBranchId
  const have = (await agents.procedures.list(agentId, branchId)).procedures ?? []
  const created: string[] = []
  const updated: string[] = []
  for (const def of buildProcedures(TOOLS)) {
    const body = { name: def.name, content: def.content, type: 'free_form' as const, trigger: def.trigger }
    const match = have.find((p) => p.name === def.name)
    if (match) { await agents.procedures.drafts.update(agentId, branchId, match.procedureId, body); updated.push(def.name) }
    else { await agents.procedures.create(agentId, branchId, body); created.push(def.name) }
  }
  // Publishing saves every procedure draft in a new immutable version of the branch.
  await agents.update(agentId, { branchId, versionDescription: description } as never)
  // The commonest flow starts with the conversation (no extra model step when the caller asks to book).
  const all = (await agents.procedures.list(agentId, branchId)).procedures ?? []
  const startIds = all.filter((p) => p.name === buildProcedures(TOOLS)[0]!.name).map((p) => p.procedureId)
  return { branchId, created, updated, startIds }
}
