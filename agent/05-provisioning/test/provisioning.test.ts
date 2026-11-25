import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TOOL_SPECS } from '@hala/tools-api'
import { LINK_TOOL_SPECS } from '@hala/phone'
import { buildAgentConfig, ensureToolSecret, isPublicHttps, readHalaEnv, redact, setHalaVar, syncAgent } from '../src'

const opts = { publicBaseUrl: 'https://hala.example.com/', toolSecret: 'sekret-123' }

describe('agent config', () => {
  const config = buildAgentConfig(opts)
  const cc = config.conversationConfig

  it('uses Arabic as the base language and the multilingual TTS model (gotcha G1)', () => {
    expect(cc.agent.language).toBe('ar')
    // both are multilingual models; the English-only flash v2 would garble Arabic
    expect(['eleven_flash_v2_5', 'eleven_v3_conversational']).toContain(cc.tts.modelId)
    expect(buildAgentConfig({ ...opts, voiceModel: 'flash' }).conversationConfig.tts.modelId).toBe('eleven_flash_v2_5')
    expect(cc.languagePresets.en.overrides.agent.language).toBe('en')
  })
  it('opens by saying it is an AI, in both languages', () => {
    expect(cc.agent.firstMessage).toMatch(/AI assistant/)
    expect(cc.agent.firstMessage).toMatch(/ذكاء اصطناعي/)
    expect(cc.languagePresets.en.overrides.agent.firstMessage).toMatch(/AI assistant/)
  })
  it('exposes one webhook tool per spec, pointing at our API with the secret header', () => {
    const tools = cc.agent.prompt.tools as any[]
    // the shared tools, plus the two QR phone-link tools that web and robot get
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_SPECS, ...LINK_TOOL_SPECS].map((s) => s.name).sort())
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
      expect.arrayContaining(['ai_disclosure', 'no_invention', 'demo_labelled', 'language_followed', 'handover_correct', 'no_wasted_handover', 'dialect_mirrored'])
    )
  })
  it('is cool and grounded: low temperature, Dubai timezone', () => {
    expect(cc.agent.prompt.temperature).toBeLessThanOrEqual(0.4)
    expect(cc.agent.prompt.timezone).toBe('Asia/Dubai')
  })
  it('the phone agent is its own agent: extra tools, caller variables with defaults, same rules', () => {
    const phone = buildAgentConfig({ ...opts, channel: 'phone' })
    expect(phone.name).toBe('HALA Concierge (phone)')
    const names = (phone.conversationConfig.agent.prompt.tools as any[]).map((t) => t.name)
    expect(names).toEqual(expect.arrayContaining([...TOOL_SPECS.map((s) => s.name), 'lookup_contact_by_code', 'send_text_message']))
    expect(phone.conversationConfig.agent.prompt.prompt).toMatch(/\{\{caller_number\}\}/)
    expect(phone.conversationConfig.agent.prompt.prompt).toMatch(/AI assistant/) // the base rules are still there
    expect((phone.conversationConfig.agent as any).dynamicVariables.dynamicVariablePlaceholders.caller_number).toBe('unknown')
    expect(phone.conversationConfig.agent.firstMessage).toMatch(/ذكاء اصطناعي/)
  })
  it('leaves the web and robot agents untouched by the phone feature', () => {
    for (const channel of ['web', 'robot'] as const) {
      const c = buildAgentConfig({ ...opts, channel })
      expect((c.conversationConfig.agent.prompt.tools as any[]).map((t) => t.name).sort()).toEqual([...TOOL_SPECS, ...LINK_TOOL_SPECS].map((s) => s.name).sort())
      expect(c.conversationConfig.agent.prompt.prompt).not.toMatch(/caller_number/)
      expect((c.conversationConfig.agent as any).dynamicVariables).toBeUndefined()
    }
  })
  it('the phone agent runs the fast, human profile: small model, eager turns, backchannels, short greeting', () => {
    const c = buildAgentConfig({ ...opts, channel: 'phone' })
    const cc = c.conversationConfig as any
    expect(cc.agent.prompt.llm).toBe('gemini-3.1-flash-lite')
    expect(cc.agent.prompt.thinkingBudget).toBe(0)
    expect(cc.agent.prompt.maxTokens).toBeLessThanOrEqual(300)
    expect(cc.turn).toMatchObject({ turnEagerness: 'eager', speculativeTurn: true })
    expect(cc.turn.softTimeoutConfig).toMatchObject({ useLlmGeneratedMessage: true })
    expect(cc.turn.interruptionIgnoreTerms).toEqual(expect.arrayContaining(['mm-hmm', 'تمام']))
    expect(cc.tts.modelId).toBe('eleven_v3_conversational')
    expect(cc.agent.prompt.prompt).toMatch(/Sound like a person/)
    const tools = cc.agent.prompt.tools as any[]
    // no spoken filler before tools (it comes out in the base language); the caller-language soft timeout covers slow turns
    expect(tools.every((t) => t.preToolSpeech === 'off')).toBe(true)
    expect(cc.turn.silenceEndCallTimeout).toBe(45)
    // the greeting is short, and still says it is an AI in both languages
    expect(cc.agent.firstMessage.length).toBeLessThan(140)
    expect(cc.agent.firstMessage).toMatch(/AI assistant/)
    expect(cc.agent.firstMessage).toMatch(/ذكاء اصطناعي/)
  })
  it('a TTS model override wins, and --human can be applied to the robot agent without changing its audio format', () => {
    expect((buildAgentConfig({ ...opts, channel: 'phone', ttsModel: 'eleven_flash_v2_5' }).conversationConfig.tts as any).modelId).toBe('eleven_flash_v2_5')
    const robot = buildAgentConfig({ ...opts, channel: 'robot', humanVoice: true })
    expect((robot.conversationConfig.tts as any).agentOutputAudioFormat).toBe('pcm_16000')
    expect((robot.conversationConfig.agent.prompt as any).llm).toBe('gemini-3.1-flash-lite')
  })
  it('can opt a web/robot agent into the code lookup tool only', () => {
    const c = buildAgentConfig({ ...opts, channel: 'robot', contactTool: true })
    const names = (c.conversationConfig.agent.prompt.tools as any[]).map((t) => t.name)
    expect(names).toContain('lookup_contact_by_code')
    expect(names).not.toContain('send_text_message')
  })
  it('the robot agent only differs in audio format, name and the voice (model and tags)', () => {
    // The prompt, tools and everything else must match the web agent.
    const robot = buildAgentConfig({ ...opts, channel: 'robot' })
    expect(robot.name).toBe('HALA Concierge (robot)')
    expect((robot.conversationConfig.tts as any).agentOutputAudioFormat).toBe('pcm_16000')
    expect((robot.conversationConfig.asr as any).userInputAudioFormat).toBe('pcm_16000')
    expect((config.conversationConfig.tts as any).agentOutputAudioFormat).toBeUndefined()
    expect(robot.conversationConfig.agent.prompt.prompt).toBe(cc.agent.prompt.prompt)
  })
  it('the robot keeps the voice chosen in the dashboard (v4 turbo, expressive, its own tags) and can still opt out to flash', () => {
    const robot = buildAgentConfig({ ...opts, channel: 'robot' })
    expect(robot.conversationConfig.tts.modelId).toBe('eleven_v4_turbo')
    expect((robot.conversationConfig.tts as any).expressiveMode).toBe(true)
    expect((robot.conversationConfig.tts as any).suggestedAudioTags.map((t: any) => t.tag)).toEqual(
      ['[empathetically]', '[warmly]', '[laughing]', '[chuckles]', '[enthusiastically]', '[excitedly]', '[sighs]']
    )
    expect(robot.conversationConfig.agent.prompt.prompt).toContain('Expressive voice')
    const flash = buildAgentConfig({ ...opts, channel: 'robot', voiceModel: 'flash' })
    expect(flash.conversationConfig.tts.modelId).toBe('eleven_flash_v2_5')
    expect((flash.conversationConfig.tts as any).expressiveMode).toBeUndefined()
    expect(flash.conversationConfig.agent.prompt.prompt).not.toContain('Expressive voice') // a flash voice would read a tag out loud
    expect(cc.agent.prompt.prompt).toContain('Expressive voice')
  })
  it('web and robot get the QR link tools, the phone agent does not (it already knows the number)', () => {
    const names = (c: ReturnType<typeof buildAgentConfig>) => (c.conversationConfig.agent.prompt.tools as any[]).map((t) => t.name)
    for (const channel of ['web', 'robot'] as const) {
      expect(names(buildAgentConfig({ ...opts, channel }))).toEqual(expect.arrayContaining(['request_phone_link', 'get_linked_phone']))
      expect(buildAgentConfig({ ...opts, channel }).conversationConfig.agent.prompt.prompt).toContain('request_phone_link')
    }
    const phone = buildAgentConfig({ ...opts, channel: 'phone' })
    expect(names(phone)).not.toContain('request_phone_link')
    expect(phone.conversationConfig.agent.prompt.prompt).not.toContain('request_phone_link')
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
