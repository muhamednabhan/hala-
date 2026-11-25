import { describe, expect, it } from 'vitest'
import { HANDOVER_REASONS, buildProcedures } from '@hala/core'
import { findServices } from '@hala/catalogue'
import { buildAgentConfig } from '@hala/provisioning'
import { TOOL_NAMES } from '@hala/tools-api'

/**
 * The four behaviours added on 24-25 Nov, checked against the REAL prompt and procedures that `agent:sync` sends:
 * Emirati hospitality, who deserves a person, the QR phone link, and the Smart Pass wording. No network.
 */
const o = { publicBaseUrl: 'https://hala-demo.trycloudflare.com', toolSecret: 's' }
const promptOf = (c: ReturnType<typeof buildAgentConfig>) => c.conversationConfig.agent.prompt.prompt
const web = promptOf(buildAgentConfig(o))
const lean = promptOf(buildAgentConfig({ ...o, lean: true, sheet: false }))
const proc = buildProcedures({ ...TOOL_NAMES, requestPhoneLink: 'request_phone_link', getLinkedPhone: 'get_linked_phone' })
const procPlain = buildProcedures({ ...TOOL_NAMES })

describe('Emirati hospitality', () => {
  for (const [name, prompt] of [['full', web], ['lean', lean]] as const) {
    it(`(${name}) tells the agent to mirror Gulf dialect with one hospitable phrase, then the job`, () => {
      expect(prompt).toMatch(/Arabic: mirror the caller/)
      for (const word of ['شحالك', 'بغيت', 'الحين']) expect(prompt, word).toContain(word)
      for (const phrase of ['يا مرحباً الساع', 'حيّاك الله', 'أبشر']) expect(prompt, phrase).toContain(phrase)
    })
    it(`(${name}) keeps formal Arabic on Modern Standard Arabic and never lets warmth become a promise`, () => {
      expect(prompt).toMatch(/Modern Standard Arabic with a light Gulf touch/)
      expect(prompt).toMatch(/Warmth never promises what a tool has not done/)
    })
  }
  it('has the worked example, with the renewal APPOINTMENT arranged rather than the renewal itself promised', () => {
    expect(web).toContain('شحالك؟ عساك طيب، بغيت أجدد الإقامة')
    expect(web).toContain('يا مرحباً الساع! فديت خشمك')
    // the worked example now TALKS first (asks who the residence is for) instead of jumping to the appointment
    expect(web).toContain('تجديد الإقامة نساعدك فيه بكل سرور. الإقامة لك أو لأحد من موظفينك؟')
    expect(web).not.toContain('نرتّب لك موعد التجديد')
    expect(web).not.toContain('نسوي لك التجديد') // that would promise the renewal itself
  })
  it('the dialect sentence from the brief still finds the visa renewal service', () => {
    const { matches } = findServices('شحالك؟ عساك طيب، بغيت أجدد الإقامة')
    expect(matches[0]?.item.id).toBe('visa_renewal')
  })
  it('other Gulf phrasings of common needs still match', () => {
    expect(findServices('المكيف خربان وايد').matches[0]?.item.id).toBe('maintenance')
    expect(findServices('أبي أجدد رخصة الشركة').matches.map((m) => m.item.id)).toContain('licence_renewal')
  })
})

describe('who deserves a person', () => {
  for (const [name, prompt] of [['full', web], ['lean', lean]] as const) {
    it(`(${name}) has the three-way rule: hand over, offer, decline with no tool`, () => {
      expect(prompt).toMatch(/# Who deserves a person/)
      expect(prompt).toMatch(/Hand over now \(handover_to_human\): .*emergency.*fee dispute.*legal.*request for a person/)
      expect(prompt).toMatch(/Offer a person \(ask first, once\)/)
      expect(prompt).toMatch(/Decline yourself, no person, no tool: .*jokes.*tests.*nonsense.*impossible/)
      expect(prompt).toMatch(/Could DSO staff do something useful with it\?/)
    })
    it(`(${name}) no longer sends every unknown to a person`, () => {
      expect(prompt).not.toMatch(/If you do not know, say so and offer a person/)
      expect(prompt).not.toMatch(/Anything else: say so and offer to pass them to a person/)
    })
  }
  it('has an example of declining without a tool', () => {
    expect(web).toMatch(/flight to Mars\? You: .*\[no tool\]/)
  })
  it('the full prompt tells the agent never to hand over a joke, and keeps the reasons the database allows', () => {
    expect(web).toMatch(/NEVER call it for jokes, tests, nonsense, trivia or impossible requests/)
    for (const r of HANDOVER_REASONS) expect(web).toContain(`- ${r}:`)
    expect(HANDOVER_REASONS).toHaveLength(8) // hala_handovers has a CHECK constraint on exactly these
  })
  it('the lean hand-over procedure loads only for a real matter and says to decline the rest', () => {
    const h = proc.find((p) => p.id === 'handover')!
    expect(h.trigger).toMatch(/REAL DSO matter/)
    expect(h.trigger).toMatch(/Not for jokes, tests, nonsense, trivia or impossible requests/)
    expect(h.trigger).not.toMatch(/outside DSO services/)
    expect(h.content).toMatch(/Decline it yourself, no person, no tool/)
    expect(h.content).toMatch(/Never call it twice for the same caller/)
  })
  it('the tool description and the not-found instructions agree', () => {
    const tool = (buildAgentConfig(o).conversationConfig.agent.prompt.tools as any[]).find((t) => t.name === 'handover_to_human')
    expect(tool.description).toMatch(/NEVER call it for jokes/)
    expect(tool.description).toMatch(/IMMEDIATELY for an emergency, a fee dispute/)
  })
})

describe('the QR phone link', () => {
  it('web and robot are told to use it instead of asking for a number out loud', () => {
    for (const channel of ['web', 'robot'] as const) {
      const p = promptOf(buildAgentConfig({ ...o, channel }))
      expect(p).toMatch(/Never ask for a number out loud/)
      expect(p).toContain('request_phone_link')
      expect(p).toContain('get_linked_phone')
      expect(p).toMatch(/Not linked after one retry: offer to take the number aloud/)
    }
  })
  it('the phone agent keeps its own rule (it already has the number)', () => {
    const p = promptOf(buildAgentConfig({ ...o, channel: 'phone' }))
    expect(p).not.toContain('request_phone_link')
    expect(p).toMatch(/Never ask for a phone number/)
  })
  it('the booking and ticket procedures use it, and fall back to asking when the tools are absent', () => {
    expect(proc.find((p) => p.id === 'book_appointment')!.content).toMatch(/Call request_phone_link now.*get_linked_phone/s)
    expect(proc.find((p) => p.id === 'maintenance_or_complaint')!.content).toMatch(/Phone link: Call request_phone_link/)
    expect(procPlain.find((p) => p.id === 'book_appointment')!.content).toMatch(/a phone number or email/)
    expect(procPlain.find((p) => p.id === 'book_appointment')!.content).not.toMatch(/request_phone_link/)
  })
})

describe('conversation first, booking on request', () => {
  const book = proc.find((p) => p.id === 'book_appointment')!
  it('the booking procedure loads only for an explicit ask or a yes to the offer, not for naming a service', () => {
    expect(book.trigger).toMatch(/asks to book/)
    expect(book.trigger).toMatch(/says yes when you offered one/)
    expect(book.trigger).toMatch(/NOT when they only name a service/)
  })
  it('it reuses what the caller already said and passes the learned details as notes', () => {
    expect(book.content).toMatch(/never ask for it again/)
    expect(book.content).toMatch(/with notes/)
  })
  it('the step-by-step explanation offers a booking once and keeps helping after a no', () => {
    expect(proc.find((p) => p.id === 'service_deep_dive')!.content).toMatch(/offer ONCE to book an appointment; if they say no or not yet, keep helping/)
  })
  it('every agent prompt carries the talk-first rules, and the lean ones say when the booking procedure loads', () => {
    for (const p of [web, promptOf(buildAgentConfig({ ...o, channel: 'phone' }))]) expect(p).toMatch(/# Talk first, book later/)
  })
})

describe('the Smart Pass wording', () => {
  it('only claims the pass was sent when the tool says so, and no longer says "you cannot send anything"', () => {
    expect(web).toMatch(/say it was sent to their phone ONLY if the tool says pass_sent is true/)
    expect(web).not.toMatch(/You cannot send SMS, emails or confirmations/)
    expect(web).toMatch(/cannot send emails/)
  })
  it('the booking procedure points to the pass on the screen', () => {
    expect(proc.find((p) => p.id === 'book_appointment')!.content).toMatch(/Smart Pass .* is now on the screen; if the tool says pass_sent is true/)
  })
})

describe('expressive voice', () => {
  it('web and phone use the expressive model with suggested tags, and the prompt allows at most one tag, never in texts', () => {
    for (const channel of ['web', 'phone'] as const) {
      const c = buildAgentConfig({ ...o, channel })
      expect(c.conversationConfig.tts.modelId).toBe('eleven_v3_conversational')
      expect((c.conversationConfig.tts as any).expressiveMode).toBe(true)
      const tags = (c.conversationConfig.tts as any).suggestedAudioTags as { tag: string; description: string }[]
      expect(tags.map((t) => t.tag)).toEqual(expect.arrayContaining(['[warmly]', '[cheerfully]', '[chuckles]']))
      for (const t of tags) { expect(t.tag).toMatch(/^\[[a-z ]+\]$/); expect(t.description.length).toBeGreaterThan(5) }
      expect(promptOf(c)).toMatch(/open a reply with ONE audio tag/)
    }
    expect(promptOf(buildAgentConfig({ ...o, channel: 'phone' }))).toMatch(/no audio tags in square brackets/)
  })
  it('the robot keeps the dashboard voice (v4 turbo, expressive, 7 tags) on pcm 16 kHz', () => {
    const robot = buildAgentConfig({ ...o, channel: 'robot' })
    expect(robot.conversationConfig.tts.modelId).toBe('eleven_v4_turbo')
    expect((robot.conversationConfig.tts as any).expressiveMode).toBe(true)
    expect((robot.conversationConfig.tts as any).suggestedAudioTags).toHaveLength(7)
    expect((robot.conversationConfig.tts as any).agentOutputAudioFormat).toBe('pcm_16000')
  })
})
