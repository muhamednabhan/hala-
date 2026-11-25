import { describe, expect, it } from 'vitest'
import {
  AI_ANSWER, BILINGUAL_GREETING, DEMO_NOTICE, FIRST_MESSAGE, addDays, arabicRatio, buildSystemPrompt,
  detectLanguage, dubaiInstant, dubaiParts, normalizeTime, resolveWhen, to12h, tokens, withinOneEdit
} from '../src'

describe('dubai time', () => {
  it('converts UTC to Dubai wall clock', () => {
    // 2026-11-24 20:30 UTC is 00:30 on the 25th in Dubai
    expect(dubaiParts(new Date('2026-11-24T20:30:00Z'))).toEqual({ date: '2026-11-25', time: '00:30', weekday: 3 })
  })
  it('builds an instant from a Dubai date and time and rejects rollovers', () => {
    expect(dubaiInstant('2026-11-26', '10:30')?.toISOString()).toBe('2026-11-26T06:30:00.000Z')
    expect(dubaiInstant('2026-02-31', '10:00')).toBeUndefined()
    expect(dubaiInstant('2026-11-26', '25:00')).toBeUndefined()
    expect(dubaiInstant('26-11-2026', '10:00')).toBeUndefined()
  })
  it('adds days across month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01')
  })
  it('resolves relative words on the server', () => {
    const now = new Date('2026-11-24T12:00:00Z') // Tuesday 16:00 Dubai
    expect(resolveWhen('tomorrow', now)?.date).toBe('2026-11-25')
    expect(resolveWhen('today', now)?.date).toBe('2026-11-24')
    expect(resolveWhen('Thursday', now)?.date).toBe('2026-11-26')
    expect(resolveWhen('next tuesday', now)?.date).toBe('2026-12-01')
    expect(resolveWhen('2026-12-02', now)?.date).toBe('2026-12-02')
    expect(resolveWhen('whenever', now)).toBeUndefined()
  })
  it('normalises spoken times', () => {
    expect(normalizeTime('10am')).toBe('10:00')
    expect(normalizeTime('2:30 pm')).toBe('14:30')
    expect(normalizeTime('9.30')).toBe('09:30')
    expect(normalizeTime('12am')).toBe('00:00')
    expect(normalizeTime('banana')).toBeUndefined()
    expect(to12h('14:30')).toBe('2:30 PM')
  })
})

describe('text normalisation', () => {
  it('detects Arabic and English', () => {
    expect(detectLanguage('أحتاج تجديد تأشيرة')).toBe('ar')
    expect(detectLanguage('I need a visa renewal')).toBe('en')
    expect(arabicRatio('')).toBe(0)
  })
  it('makes Arabic spelling variants compare equal', () => {
    expect(tokens('تأشيرة')).toEqual(tokens('تاشيرة'))
    expect(tokens('التأشيرة')).toEqual(tokens('تأشيرة'))
    expect(tokens('بالتأشيرة')).toEqual(tokens('تأشيرة'))
    expect(tokens('الرخصة')).toEqual(tokens('رخصه'))
  })
  it('treats Arabic-Indic digits as ASCII', () => {
    expect(tokens('٢٠٢٦')).toEqual(['2026'])
  })
  it('stems simple English plurals and endings', () => {
    expect(tokens('visas renewed licences')).toEqual(['visa', 'renew', 'licence'])
  })
  it('tolerates one edit', () => {
    expect(withinOneEdit('renewal', 'renewel')).toBe(true)
    expect(withinOneEdit('renewal', 'removal')).toBe(false)
  })
})

describe('guardrail wording', () => {
  it('says AI in both languages in every opening', () => {
    expect(FIRST_MESSAGE.en).toMatch(/AI assistant/)
    expect(FIRST_MESSAGE.ar).toMatch(/الذكاء الاصطناعي/)
    expect(BILINGUAL_GREETING).toMatch(/AI assistant/)
    expect(BILINGUAL_GREETING).toMatch(/ذكاء اصطناعي/)
  })
})

describe('system prompt', () => {
  const tools = {
    findService: 'find_service', listSlots: 'list_slots', book: 'book_appointment', reschedule: 'reschedule_appointment',
    cancel: 'cancel_appointment', logRequest: 'log_request', lookupFact: 'lookup_fact', handover: 'handover_to_human',
    checkBooking: 'check_booking', checkRequest: 'check_request', serviceProcess: 'service_process'
  }
  const prompt = buildSystemPrompt({ services: [], tools })
  it('contains the non-negotiables', () => {
    expect(prompt).toMatch(/You are an AI assistant/)
    expect(prompt).toContain(AI_ANSWER.en)
    expect(prompt).toContain(DEMO_NOTICE.en)
    expect(prompt).toMatch(/NEVER INVENT/)
    expect(prompt).toMatch(/Never guess/)
  })
  it('references every tool by its real name', () => {
    for (const name of Object.values(tools)) expect(prompt).toContain(name)
  })
  it('lists every handover reason', () => {
    for (const r of ['fee_dispute', 'upset_caller', 'caller_requested', 'emergency']) expect(prompt).toContain(r)
  })
  it('tells the agent to read back before booking and never to do date maths', () => {
    expect(prompt).toMatch(/Read back once/)
    expect(prompt).toMatch(/Never work out dates yourself/)
  })
  it('talks first and books only when the caller asks for an appointment or accepts the offer, in every prompt mode', () => {
    for (const lean of [false, true]) {
      const p = buildSystemPrompt({ services: [], tools, lean })
      expect(p, `lean=${lean}`).toMatch(/# Talk first, book later/)
      expect(p).toMatch(/do NOT call list_slots/)
      expect(p).toMatch(/offer ONCE/)
      expect(p).toMatch(/pass what you learned as notes/)
    }
    // the full (phone) prompt no longer opens the booking questions unconditionally
    expect(prompt).toMatch(/ONLY once the caller asks for an appointment or says yes to your offer of one/)
    // the lean prompt says when the booking procedure loads
    expect(buildSystemPrompt({ services: [], tools, lean: true })).toMatch(/loads only when the caller asks for an appointment/)
  })
})
