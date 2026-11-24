import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_SPECS } from '@hala/tools-api'
import { buildAgentConfig, ensureToolSecret, isPublicHttps, readHalaEnv, redact, setHalaVar, syncAgent } from '../src'

const opts = { publicBaseUrl: 'https://hala.example.com/', toolSecret: 'sekret-123' }

describe('agent config', () => {
  const config = buildAgentConfig(opts)
  const cc = config.conversationConfig

  it('uses Arabic as the base language and the multilingual TTS model (gotcha G1)', () => {
    expect(cc.agent.language).toBe('ar')
    expect(cc.tts.modelId).toBe('eleven_flash_v2_5')
    expect(cc.languagePresets.en.overrides.agent.language).toBe('en')
  })
  it('opens by saying it is an AI, in both languages', () => {
    expect(cc.agent.firstMessage).toMatch(/AI assistant/)
    expect(cc.agent.firstMessage).toMatch(/ذكاء اصطناعي/)
    expect(cc.languagePresets.en.overrides.agent.firstMessage).toMatch(/AI assistant/)
  })
  it('exposes one webhook tool per spec, pointing at our API with the secret header', () => {
    const tools = cc.agent.prompt.tools as any[]
    expect(tools.map((t) => t.name).sort()).toEqual(TOOL_SPECS.map((s) => s.name).sort())
    for (const t of tools) {
      expect(t.type).toBe('webhook')
      expect(t.apiSchema.url).toBe(`https://hala.example.com/api/tools/${t.name}`)
      expect(t.apiSchema.requestHeaders['x-hala-secret']).toBe('sekret-123')
      expect(t.apiSchema.method).toBe('POST')
    }
  })
  it('injects the conversation id from ElevenLabs, never from the model', () => {
    for (const t of cc.agent.prompt.tools as any[]) {
      const prop = t.apiSchema.requestBodySchema.properties.conversation_id
      expect(prop).toEqual({ type: 'string', dynamicVariable: 'system__conversation_id' })
      expect(prop.description).toBeUndefined() // mutually exclusive with dynamicVariable
    }
  })
  it('marks only non-optional params as required', () => {
    const book = (cc.agent.prompt.tools as any[]).find((t) => t.name === 'book_appointment')
    expect(book.apiSchema.requestBodySchema.required).toContain('attendee_name')
    expect(book.apiSchema.requestBodySchema.required).not.toContain('booked_by_name')
  })
  it('keeps the agent private and judges every call on the rules that matter', () => {
    expect(config.platformSettings.auth.enableAuth).toBe(true)
    expect(config.platformSettings.evaluation.criteria.map((c) => c.id)).toEqual(
      expect.arrayContaining(['ai_disclosure', 'no_invention', 'demo_labelled', 'language_followed', 'handover_correct'])
    )
  })
  it('is cool and grounded: low temperature, Dubai timezone', () => {
    expect(cc.agent.prompt.temperature).toBeLessThanOrEqual(0.4)
    expect(cc.agent.prompt.timezone).toBe('Asia/Dubai')
  })
  it('the robot agent only differs in audio format and name', () => {
    const robot = buildAgentConfig({ ...opts, channel: 'robot' })
    expect(robot.name).toBe('HALA Concierge (robot)')
    expect((robot.conversationConfig.tts as any).agentOutputAudioFormat).toBe('pcm_16000')
    expect((robot.conversationConfig.asr as any).userInputAudioFormat).toBe('pcm_16000')
    expect((config.conversationConfig.tts as any).agentOutputAudioFormat).toBeUndefined()
    expect(robot.conversationConfig.agent.prompt.prompt).toBe(cc.agent.prompt.prompt)
  })
  it('never leaks the secret when redacted', () => {
    expect(JSON.stringify(redact(config, opts.toolSecret))).not.toContain('sekret-123')
  })
})

describe('syncAgent', () => {
  const config = buildAgentConfig(opts)
  const fake = (existing: { agentId: string; name: string }[]) => {
    const agents = {
      list: vi.fn(async () => ({ agents: existing })),
      update: vi.fn(async () => ({})),
      create: vi.fn(async () => ({ agentId: 'agent_new' }))
    }
    return { agents, client: { conversationalAi: { agents } } as any }
  }

  it('creates when nothing exists', async () => {
    const { agents, client } = fake([])
    expect(await syncAgent(client, config)).toEqual({ agentId: 'agent_new', created: true, duplicates: [] })
    expect(agents.create).toHaveBeenCalledOnce()
  })
  it('updates the agent with the same name instead of duplicating', async () => {
    const { agents, client } = fake([{ agentId: 'agent_1', name: 'HALA Concierge' }, { agentId: 'agent_2', name: 'HALA Concierge' }, { agentId: 'agent_x', name: 'HALA Concierge (robot)' }])
    const r = await syncAgent(client, config)
    expect(r).toEqual({ agentId: 'agent_1', created: false, duplicates: ['agent_2'] })
    expect(agents.create).not.toHaveBeenCalled()
    expect(agents.update).toHaveBeenCalledWith('agent_1', config)
  })
  it('a pinned id wins and skips the search', async () => {
    const { agents, client } = fake([])
    expect((await syncAgent(client, config, 'agent_pinned')).agentId).toBe('agent_pinned')
    expect(agents.list).not.toHaveBeenCalled()
  })
})

describe('.env.hala helpers', () => {
  let dir: string
  let file: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hala-env-')); file = join(dir, '.env.hala') })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('generates the tool secret once and reuses it', () => {
    const a = ensureToolSecret({}, file)
    const b = ensureToolSecret({}, file)
    expect(a).toMatch(/^[0-9a-f]{48}$/)
    expect(b).toBe(a)
  })
  it('prefers the environment over the file', () => {
    expect(ensureToolSecret({ HALA_TOOL_SECRET: 'from-env' }, file)).toBe('from-env')
  })
  it('sets and replaces variables without duplicating them', () => {
    setHalaVar('HALA_AGENT_ID', 'a1', file)
    setHalaVar('HALA_AGENT_ID', 'a2', file)
    setHalaVar('PUBLIC_BASE_URL', 'https://x.example', file)
    expect(readHalaEnv(file).get('HALA_AGENT_ID')).toBe('a2')
    expect(readFileSync(file, 'utf8').match(/HALA_AGENT_ID=/g)).toHaveLength(1)
  })
  it('accepts only public https URLs', () => {
    expect(isPublicHttps('https://abc.trycloudflare.com')).toBe(true)
    expect(isPublicHttps('http://abc.trycloudflare.com')).toBe(false)
    expect(isPublicHttps('https://localhost:3005')).toBe(false)
    expect(isPublicHttps('nope')).toBe(false)
  })
})
