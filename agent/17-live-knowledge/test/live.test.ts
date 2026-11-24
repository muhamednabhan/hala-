import { describe, expect, it, vi } from 'vitest'
import type { KnowledgeAnswer } from '@hala/supabase'
import { DOC_PREFIX, buildAnswersDoc, isUsable, setAgentLiveDoc, syncLiveAnswers } from '../src'

const row = (o: Partial<KnowledgeAnswer> = {}): KnowledgeAnswer => ({
  id: 'r1', question: 'Can I bring my dog to the headquarters?', serviceId: 'info', answerEn: 'Only guide dogs.', answerAr: 'كلاب الإرشاد فقط.',
  status: 'answered', answeredAt: '2026-11-24T10:00:00Z', updatedAt: '2026-11-24T10:00:00Z', timesUsed: 0, ...o
})

describe('answers document', () => {
  it('uses only answered rows that have an answer and a real question', () => {
    expect(isUsable(row())).toBe(true)
    expect(isUsable(row({ status: 'pending' }))).toBe(false)
    expect(isUsable(row({ status: 'rejected' }))).toBe(false)
    expect(isUsable(row({ answerEn: undefined, answerAr: undefined }))).toBe(false)
    expect(isUsable(row({ question: ' ' }))).toBe(false)
    expect(isUsable(row({ status: ' Approved ' }))).toBe(true)
  })
  it('is undefined when nothing is usable', () => {
    expect(buildAnswersDoc([])).toBeUndefined()
    expect(buildAnswersDoc([row({ status: 'pending' })])).toBeUndefined()
  })
  it('tags answers as staff-confirmed and keeps both languages', () => {
    const d = buildAnswersDoc([row()])!
    expect(d.count).toBe(1)
    expect(d.text).toContain('[STAFF ANSWER] English: Only guide dogs.')
    expect(d.text).toContain('[STAFF ANSWER] Arabic: كلاب الإرشاد فقط.')
    expect(d.text).toContain('Confirmed by DSO staff on 2026-11-24')
    expect(d.name).toMatch(new RegExp(`^${DOC_PREFIX} #[0-9a-f]{8}$`))
  })
  it('never exposes who answered, and ignores withdrawn rows', () => {
    const d = buildAnswersDoc([row(), row({ id: 'r2', question: 'Secret?', status: 'draft' })])!
    expect(d.text).not.toContain('Secret?')
    expect(d.text).not.toMatch(/answered_by|@/)
  })
  it('is stable: same rows in any order give the same name; a changed answer gives a new one', () => {
    const a = row({ id: 'a', question: 'A question one' })
    const b = row({ id: 'b', question: 'B question two' })
    expect(buildAnswersDoc([a, b])!.name).toBe(buildAnswersDoc([b, a])!.name)
    expect(buildAnswersDoc([a, b])!.name).not.toBe(buildAnswersDoc([a, { ...b, answerEn: 'Changed.' }])!.name)
  })
  it('collapses stray whitespace so a pasted multi-line answer stays one line', () => {
    expect(buildAnswersDoc([row({ answerEn: 'Line one.\n\n   Line two.' })])!.text).toContain('English: Line one. Line two.')
  })
})

// ---------------------------------------------------------------- fakes for the ElevenLabs side
function fakeEleven(agents: Record<string, { name: string; id: string }[]>, docs: { id: string; name: string }[] = []) {
  const store = { docs: [...docs], agents: structuredClone(agents), created: 0, deleted: [] as string[], updates: [] as unknown[] }
  const eleven = {
    conversationalAi: {
      knowledgeBase: {
        list: vi.fn(async () => ({ documents: store.docs })),
        documents: {
          createFromText: vi.fn(async ({ name }: { name: string }) => { store.created++; const d = { id: `kb_${store.created}`, name }; store.docs.push(d); return d }),
          delete: vi.fn(async (id: string) => { store.deleted.push(id); store.docs = store.docs.filter((d) => d.id !== id) })
        },
        getOrCreateRagIndexes: vi.fn(async () => ({}))
      },
      agents: {
        get: vi.fn(async (id: string) => ({ conversationConfig: { agent: { prompt: { knowledgeBase: store.agents[id]!.map((k) => ({ type: 'text', ...k })) } } } })),
        update: vi.fn(async (id: string, body: any) => { store.updates.push(body); store.agents[id] = body.conversationConfig.agent.prompt.knowledgeBase })
      }
    }
  } as any
  return { eleven, store }
}
const supabaseWith = (rows: any[]) => ({
  url: 'https://x.supabase.co', serviceKey: 'k',
  fetch: (async () => new Response(JSON.stringify(rows.map((r) => ({
    id: r.id, question: r.question, question_norm: r.question.toLowerCase(), service_id: r.serviceId, answer_en: r.answerEn, answer_ar: r.answerAr,
    status: r.status, answered_at: r.answeredAt, updated_at: r.updatedAt, times_used: r.timesUsed
  }))), { status: 200 })) as unknown as typeof fetch
})
const base = [{ name: 'HALA 02 about #abc', id: 'kb_base' }]

describe('syncLiveAnswers', () => {
  it('uploads a new document, indexes it, attaches it to every agent and leaves the other documents alone', async () => {
    const { eleven, store } = fakeEleven({ web: base, robot: base })
    const r = await syncLiveAnswers({ supabase: supabaseWith([row()]), eleven, agentIds: ['web', 'robot'] })
    expect(r).toMatchObject({ status: 'updated', answers: 1 })
    expect(store.created).toBe(1)
    expect(eleven.conversationalAi.knowledgeBase.getOrCreateRagIndexes).toHaveBeenCalledOnce()
    for (const id of ['web', 'robot']) {
      expect(store.agents[id]!.map((k) => k.id)).toEqual(['kb_base', 'kb_1'])
    }
  })
  it('sends only the knowledge-base list, never the prompt or tools', async () => {
    const { eleven, store } = fakeEleven({ web: base })
    await syncLiveAnswers({ supabase: supabaseWith([row()]), eleven, agentIds: ['web'] })
    for (const u of store.updates as any[]) {
      expect(Object.keys(u)).toEqual(['conversationConfig'])
      expect(Object.keys(u.conversationConfig.agent.prompt)).toEqual(['knowledgeBase'])
    }
  })
  it('does nothing the second time when the answers have not changed', async () => {
    const { eleven, store } = fakeEleven({ web: base })
    const deps = { supabase: supabaseWith([row()]), eleven, agentIds: ['web'] }
    await syncLiveAnswers(deps)
    const updates = store.updates.length
    const again = await syncLiveAnswers(deps)
    expect(again.status).toBe('unchanged')
    expect(store.created).toBe(1)
    expect(store.updates.length).toBe(updates)
  })
  it('replaces the document when an answer changes and deletes the old one', async () => {
    const { eleven, store } = fakeEleven({ web: base })
    await syncLiveAnswers({ supabase: supabaseWith([row()]), eleven, agentIds: ['web'] })
    const r = await syncLiveAnswers({ supabase: supabaseWith([row({ answerEn: 'Dogs are never allowed.' })]), eleven, agentIds: ['web'] })
    expect(r).toMatchObject({ status: 'updated', replaced: 1 })
    expect(store.deleted).toEqual(['kb_1'])
    expect(store.agents.web!.filter((k) => k.name.startsWith(DOC_PREFIX)).length).toBe(1)
    expect(store.agents.web!.map((k) => k.id)).toEqual(['kb_base', 'kb_2'])
  })
  it('repairs the link when an agent lost it (for example after an agent re-sync)', async () => {
    const { eleven, store } = fakeEleven({ web: base })
    await syncLiveAnswers({ supabase: supabaseWith([row()]), eleven, agentIds: ['web'] })
    store.agents.web = base // the agent was re-synced without the live document
    const r = await syncLiveAnswers({ supabase: supabaseWith([row()]), eleven, agentIds: ['web'] })
    expect(r.status).toBe('updated')
    expect(store.created).toBe(1) // not uploaded again
    expect(store.agents.web!.map((k) => k.id)).toEqual(['kb_base', 'kb_1'])
  })
  it('removes the document when no answered rows remain', async () => {
    const { eleven, store } = fakeEleven({ web: base })
    await syncLiveAnswers({ supabase: supabaseWith([row()]), eleven, agentIds: ['web'] })
    const r = await syncLiveAnswers({ supabase: supabaseWith([row({ status: 'pending' })]), eleven, agentIds: ['web'] })
    expect(r).toMatchObject({ status: 'empty', removed: 1 })
    expect(store.agents.web!.map((k) => k.id)).toEqual(['kb_base'])
    expect(store.docs.some((d) => d.name.startsWith(DOC_PREFIX))).toBe(false)
  })
  it('an empty table with no document is a quiet no-op', async () => {
    const { eleven, store } = fakeEleven({ web: base })
    expect(await syncLiveAnswers({ supabase: supabaseWith([]), eleven, agentIds: ['web'] })).toMatchObject({ status: 'empty', removed: 0 })
    expect(store.updates.length).toBe(0)
  })
  it('surfaces a Supabase failure instead of wiping the knowledge base', async () => {
    const { eleven, store } = fakeEleven({ web: [...base, { name: `${DOC_PREFIX} #old`, id: 'kb_old' }] })
    const broken = { url: 'https://x', serviceKey: 'k', fetch: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch }
    await expect(syncLiveAnswers({ supabase: broken, eleven, agentIds: ['web'] })).rejects.toThrow(/HTTP 500/)
    expect(store.agents.web!.map((k) => k.id)).toEqual(['kb_base', 'kb_old'])
  })
  it('setAgentLiveDoc reports whether anything changed', async () => {
    const { eleven } = fakeEleven({ web: base })
    expect(await setAgentLiveDoc(eleven, 'web', undefined)).toBe(false)
    expect(await setAgentLiveDoc(eleven, 'web', { id: 'kb_9', name: `${DOC_PREFIX} #x` })).toBe(true)
    expect(await setAgentLiveDoc(eleven, 'web', { id: 'kb_9', name: `${DOC_PREFIX} #x` })).toBe(false)
  })
})
