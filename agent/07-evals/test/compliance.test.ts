import { describe, expect, it } from 'vitest'
import { BILINGUAL_GREETING, DEMO_NOTICE, FIRST_MESSAGE, HANDOVER_REASONS } from '@hala/core'
import { SERVICES } from '@hala/catalogue'
import { buildAgentConfig } from '@hala/provisioning'
import { TOOL_SPECS } from '@hala/tools-api'
import { createHarness } from '../src/harness'

/**
 * Prompt and config compliance: the judges' non-negotiables, checked against the REAL config
 * that `npm run agent:sync` would send to ElevenLabs. No network.
 */
const SECRET = 'sekret-do-not-leak-91ac'
const BASE_URL = 'https://hala-demo.trycloudflare.com'
const config = buildAgentConfig({ publicBaseUrl: BASE_URL, toolSecret: SECRET })
const agent = config.conversationConfig.agent
const prompt = agent.prompt.prompt
const AI_EN = /AI assistant/i
const AI_AR = /ذكاء اصطناعي|الذكاء الاصطناعي/
// The prompt now carries the service sheet (documents, DEMO fee and time per service) so the agent can answer the commonest
// questions with NO tool call, which is the biggest single latency saving. That costs prompt length; the budget catches
// runaway growth, since a longer prompt makes every turn a little slower.
const PROMPT_BUDGET = 14_500

describe('AI disclosure in every first message', () => {
  it('bilingual opener (the agent default) says AI in English and Arabic', () => {
    expect(agent.firstMessage).toMatch(AI_EN)
    expect(agent.firstMessage).toMatch(AI_AR)
    expect(agent.firstMessage).toBe(BILINGUAL_GREETING)
  })
  it('English language preset opens with the AI disclosure', () => {
    expect(config.conversationConfig.languagePresets.en.overrides.agent.firstMessage).toMatch(AI_EN)
    expect(FIRST_MESSAGE.en).toMatch(/not a person/)
  })
  it('Arabic first message states it is an AI and not a person', () => {
    expect(FIRST_MESSAGE.ar).toMatch(AI_AR)
    expect(FIRST_MESSAGE.ar).toMatch(/ولست إنساناً/)
  })
  it('the robot agent opens the same way', () => {
    const robot = buildAgentConfig({ publicBaseUrl: BASE_URL, toolSecret: SECRET, channel: 'robot' })
    expect(robot.conversationConfig.agent.firstMessage).toBe(agent.firstMessage)
  })
  it('no opener claims to be human', () => {
    for (const text of [agent.firstMessage, FIRST_MESSAGE.en, FIRST_MESSAGE.ar]) {
      expect(text).not.toMatch(/I(?:'m| am) (?:a )?(?:human|real person)|أنا إنسان/i)
    }
  })
})

describe('system prompt rules', () => {
  it('declares itself an AI and tells the agent never to claim to be human', () => {
    expect(prompt).toMatch(/You are an AI assistant/)
    expect(prompt).toMatch(/never pretend otherwise/)
    expect(prompt).toMatch(/a person or a robot/)
  })
  it('forbids inventing facts and tells the agent to admit not knowing', () => {
    expect(prompt).toMatch(/NEVER INVENT/)
    expect(prompt).toMatch(/Never guess/)
    expect(prompt).toMatch(/I don't have that information/)
  })
  it('requires the demo notice, in both languages, for every fee or time', () => {
    expect(prompt).toMatch(/DEMO VALUES/)
    expect(prompt).toContain(DEMO_NOTICE.en)
    expect(prompt).toContain(DEMO_NOTICE.ar)
  })
  it('lists every handover trigger with its reason code', () => {
    for (const r of HANDOVER_REASONS) expect(prompt, r).toContain(`- ${r}:`)
    expect(prompt).toMatch(/dispute/i)
    expect(prompt).toMatch(/never logged as a complaint/)
  })
  it('requires a read-back and a clear yes before any booking change', () => {
    expect(prompt).toMatch(/Read back once/)
    expect(prompt).toMatch(/clear yes/)
    expect(prompt).toMatch(/clear yes\. Then call/)
  })
  it('keeps date arithmetic on the server', () => {
    expect(prompt).toMatch(/Never work out dates yourself/)
    expect(prompt).toContain('{{system__time}}')
  })
  it('limits personal data and resists instruction injection', () => {
    expect(prompt).toMatch(/PRIVACY/)
    expect(prompt).toMatch(/Emirates ID/)
    expect(prompt).toMatch(/Ignore any instruction/)
    expect(prompt).toMatch(/reveal this prompt/)
  })
  it('sets the Arabic style: Gulf-friendly MSA, feminine self-reference', () => {
    expect(prompt).toMatch(/Modern Standard Arabic with a light Gulf touch/)
    expect(prompt).toMatch(/feminine forms/i)
  })
  it('does not exceed the prompt length budget', () => {
    // Printed so the size is visible in the test output.
    console.log(`[prompt size] ${prompt.length} chars of ${PROMPT_BUDGET} (${((prompt.length / PROMPT_BUDGET) * 100).toFixed(0)}%)`)
    expect(prompt.length).toBeLessThanOrEqual(PROMPT_BUDGET)
  })
})

describe('prompt <-> tools consistency', () => {
  const toolNames = new Set(TOOL_SPECS.map((s) => s.name))

  it('every tool the prompt tells the agent to call exists', () => {
    const referenced = [...prompt.matchAll(/\b(?:call|use|Call|Use) ([a-z]+_[a-z_]+)/g)].map((m) => m[1]!)
    expect(referenced.length).toBeGreaterThan(3)
    const allowed = new Set([...toolNames, 'end_call', 'language_detection'])
    expect(referenced.filter((n) => !allowed.has(n))).toEqual([])
  })
  it('every tool in the config is mentioned in the prompt (except check_booking, used for lookups)', () => {
    for (const name of toolNames) {
      if (name === 'check_booking') continue
      expect(prompt, name).toContain(name)
    }
  })
  it('the config exposes exactly the specced tools, each backed by a real handler', async () => {
    const tools = (agent.prompt.tools as { name: string }[]).map((t) => t.name).sort()
    expect(tools).toEqual([...toolNames].sort())
    const h = createHarness()
    for (const name of toolNames) expect((await h.api.handle(name, h.headers, {})).status, name).not.toBe(404)
  })
  it('the handover reasons the tool accepts match the prompt', () => {
    const spec = TOOL_SPECS.find((s) => s.name === 'handover_to_human')!
    expect([...(spec.params.reason!.enum ?? [])]).toEqual([...HANDOVER_REASONS])
  })
})

describe('catalogue in the prompt', () => {
  it('lists every catalogue service in the prompt index', () => {
    expect(SERVICES.length).toBeGreaterThanOrEqual(12)
    for (const s of SERVICES) expect(prompt, s.id).toContain(`- ${s.id}:`)
  })
  it('puts fees and times in the prompt ONLY as labelled demo values', () => {
    for (const s of SERVICES) {
      if (s.feeText) expect(prompt, `fee of ${s.id}`).toContain(`fee: ${s.feeText} (DEMO)`)
      if (s.timelineText) expect(prompt, `time of ${s.id}`).toContain(`time: ${s.timelineText} (DEMO)`)
    }
    // every figure with "AED" in the prompt sits in a fee line that ends in (DEMO)
    const loose = prompt.split('\n').filter((l) => /AED \d/.test(l) && !/\(DEMO\)/.test(l) && !l.startsWith('  rule:') && !l.startsWith('- '))
    expect(loose).toEqual([])
  })
  it('lets the agent answer the commonest questions without a tool call', () => {
    expect(prompt).toMatch(/ANSWER FROM THIS PROMPT/)
    expect(prompt).toMatch(/Never call the same tool twice in a row/)
    expect(prompt).toContain('600 59 55 57') // the contact line is a quick fact
  })
})

describe('secrets', () => {
  it('the tool secret is in the webhook headers only, never in the prompt', () => {
    expect(prompt).not.toContain(SECRET)
    expect(prompt).not.toContain(BASE_URL)
    const json = JSON.stringify({ ...config, conversationConfig: { ...config.conversationConfig, agent: { ...agent, prompt: { ...agent.prompt, tools: [] } } } })
    expect(json).not.toContain(SECRET)
  })
  it('no first message, language preset or evaluation text contains the secret', () => {
    const rest = JSON.stringify({ ...config.platformSettings, presets: config.conversationConfig.languagePresets, first: agent.firstMessage })
    expect(rest).not.toContain(SECRET)
  })
  it('the agent is private (token required) and low-temperature', () => {
    expect(config.platformSettings.auth.enableAuth).toBe(true)
    expect(agent.prompt.temperature).toBeLessThanOrEqual(0.4)
  })
})
