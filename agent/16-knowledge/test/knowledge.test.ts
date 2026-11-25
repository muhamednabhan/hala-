import { describe, expect, it } from 'vitest'
import { buildProcedures, buildSystemPrompt } from '@hala/core'
import { SERVICES, FACTS } from '@hala/catalogue'
import { TOOL_NAMES, TOOL_SPECS } from '@hala/tools-api'
import { buildAgentConfig } from '@hala/provisioning'
import { RULES, loadDocs, rulesHash, toApiRules } from '../src'

const TOOLS = {
  findService: TOOL_NAMES.findService, serviceProcess: TOOL_NAMES.serviceProcess, listSlots: TOOL_NAMES.listSlots, book: TOOL_NAMES.book,
  reschedule: TOOL_NAMES.reschedule, cancel: TOOL_NAMES.cancel, checkBooking: TOOL_NAMES.checkBooking, checkRequest: TOOL_NAMES.checkRequest,
  logRequest: TOOL_NAMES.logRequest, handover: TOOL_NAMES.handover
}

describe('procedures', () => {
  const procs = buildProcedures(TOOLS)
  it('the FIRST procedure is the one preloaded in every conversation (start procedure): it must be the talk-first one, never the booking flow', () => {
    // sync.ts pins procs[0] as the start procedure. When that was the booking flow, every conversation began with
    // "one appointment in as few turns as possible" in context and the agent asked for a day before it had listened.
    expect(procs[0]!.id).toBe('understand_need')
    expect(procs[0]!.content).toMatch(/do not call list_slots/)
    expect(procs[0]!.content).toMatch(/offer ONCE/)
  })
  it('has the flows, each with a precise trigger and short content', () => {
    expect(procs.map((p) => p.id)).toEqual(['understand_need', 'book_appointment', 'change_or_check', 'maintenance_or_complaint', 'handover', 'service_deep_dive'])
    for (const p of procs) {
      expect(p.trigger.length, p.id).toBeGreaterThan(40)
      expect(p.content.length, p.id).toBeLessThan(2500) // short: the point is a small prompt
      expect(p.name, p.id).toBeTruthy()
    }
  })
  it('only refer to tools that exist', () => {
    const names = new Set(TOOL_SPECS.map((s) => s.name))
    for (const p of procs) {
      const used = [...p.content.matchAll(/\b([a-z]+_[a-z_]+)\b/g)].map((m) => m[1]!).filter((n) => /^(find|service|list|book|reschedule|cancel|check|log|lookup|handover)_/.test(n))
      for (const n of used) expect(names.has(n), `${p.id} mentions ${n}`).toBe(true)
    }
  })
  it('keep the non-negotiables: read back before booking, one hand-over call, no promises, 999 for emergencies', () => {
    const all = procs.map((p) => p.content).join('\n')
    expect(all).toMatch(/read back once/i)
    expect(all).toMatch(/clear yes/)
    expect(all).toMatch(/ONCE/)
    expect(all).toMatch(/999/)
    expect(all).toMatch(/Never argue|promise no/i)
    expect(all).toMatch(/cannot send emails/)
  })
  it('lean mode drops the flows from the base prompt and points to the procedures', () => {
    const tools = { ...TOOLS, lookupFact: TOOL_NAMES.lookupFact }
    const full = buildSystemPrompt({ services: SERVICES, facts: FACTS, tools })
    const lean = buildSystemPrompt({ services: SERVICES, facts: FACTS, tools, lean: true })
    const index = buildSystemPrompt({ services: SERVICES, facts: FACTS, tools, lean: true, sheet: false, knowledgeBase: true })
    expect(lean.length).toBeLessThan(full.length)
    expect(index.length).toBeLessThan(lean.length * 0.8) // the sheet moves to the knowledge base
    expect(lean).toMatch(/own procedure/)
    expect(lean).not.toMatch(/# Booking and tickets/)
    expect(index).toMatch(/knowledge base/i)
    expect(index).toMatch(/\[PUBLISHED\]/)
    for (const s of SERVICES) expect(index, s.id).toContain(`- ${s.id}:`)
    expect(index).not.toMatch(/documents: /) // no sheet lines
  })
})

describe('knowledge base documents', () => {
  const docs = loadDocs()
  it('has the handbook and the researched documents with content-hash names', () => {
    expect(docs.length).toBeGreaterThanOrEqual(6)
    for (const d of docs) expect(d.name).toMatch(/^HALA [\w-]+ #[0-9a-f]{8}$/)
    expect(new Set(docs.map((d) => d.name)).size).toBe(docs.length)
  })
  it('tags every researched document and labels demo data', () => {
    const researched = docs.filter((d) => /^0[2-5]-/.test(d.key))
    for (const d of researched) expect(d.text, d.key).toMatch(/\[PUBLISHED\]/)
    const demo = docs.find((d) => d.key.startsWith('06-'))!
    expect(demo.text).toMatch(/DEMO DATA/)
    expect(demo.text).toMatch(/NOT DSO information/)
  })
  it('never carries a secret', () => {
    for (const d of docs) expect(d.text, d.key).not.toMatch(/sk_[a-z0-9]|hbr_|sb_secret/i)
  })
  it('does not teach the agent to quote unpublished fees', () => {
    const setup = docs.find((d) => d.key.startsWith('02-'))!
    expect(setup.text).toMatch(/\[NOT PUBLISHED\] Official fee amounts/)
  })
})

describe('pronunciation rules', () => {
  const api = toApiRules()
  it('has a rich set covering acronyms, DSO, places, Gulf words and Arabic', () => {
    expect(api.length).toBeGreaterThan(180)
    for (const must of ['DSO', 'NOC', 'HALA', 'Ejari', 'Dtec', 'Sharjah', 'Mulkiya', 'goAML', 'هلا', 'تأشيرة']) expect(api.some((r) => r.stringToReplace === must), must).toBe(true)
  })
  it('has no duplicates and no empty replacements', () => {
    const keys = api.map((r) => (r.caseSensitive ? `${r.stringToReplace}|1` : r.stringToReplace.toLowerCase()))
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of api) { expect(r.alias.trim(), r.stringToReplace).toBeTruthy(); expect(r.alias).not.toBe(r.stringToReplace) }
  })
  it('spells acronyms out case-sensitively, so the words "pro" and "noc" are left alone', () => {
    const noc = api.find((r) => r.stringToReplace === 'NOC')!
    expect(noc).toMatchObject({ alias: 'N O C', caseSensitive: true, wordBoundaries: true })
    expect(api.find((r) => r.stringToReplace === 'PRO')!.caseSensitive).toBe(true)
  })
  it('has a stable version hash that changes with the rules', () => {
    expect(rulesHash()).toBe(rulesHash())
    expect(rulesHash(RULES.slice(1))).not.toBe(rulesHash())
  })
})

describe('agent config with the new features', () => {
  const o = { publicBaseUrl: 'https://x.io', toolSecret: 's' }
  it('attaches the knowledge base with retrieval, the pronunciation dictionary and expressive voice', () => {
    const c = buildAgentConfig({ ...o, knowledge: [{ id: 'kb1', name: 'HALA 02' }], pronunciation: { pronunciationDictionaryId: 'pd1', versionId: 'v1' }, lean: true, sheet: false })
    const p = c.conversationConfig.agent.prompt as any
    expect(p.knowledgeBase).toEqual([{ type: 'text', name: 'HALA 02', id: 'kb1', usageMode: 'auto' }])
    expect(p.rag).toMatchObject({ enabled: true, embeddingModel: 'multilingual_e5_large_instruct' })
    const tts = c.conversationConfig.tts as any
    expect(tts.modelId).toBe('eleven_v3_conversational')
    expect(tts.expressiveMode).toBe(true)
    expect(tts.suggestedAudioTags.length).toBeLessThanOrEqual(8)
    expect(tts.pronunciationDictionaryLocators).toEqual([{ pronunciationDictionaryId: 'pd1', versionId: 'v1' }])
    expect((c.platformSettings.overrides as any).enableProcedureIdsFromClient).toBe(true)
  })
  it('the fast voice is one flag away', () => {
    const tts = buildAgentConfig({ ...o, voiceModel: 'flash' }).conversationConfig.tts as any
    expect(tts.modelId).toBe('eleven_flash_v2_5')
    expect(tts.expressiveMode).toBeUndefined()
  })
})
