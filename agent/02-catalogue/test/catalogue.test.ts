import { describe, expect, it } from 'vitest'
import { FACTS, SERVICES, findServices, getService, lookupFact } from '../src'
import { PHRASES } from './phrases'

describe('catalogue integrity', () => {
  it('has unique ids and bilingual content for every service', () => {
    const ids = SERVICES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const s of SERVICES) {
      expect(s.name.en && s.name.ar && s.summary.en && s.summary.ar, s.id).toBeTruthy()
      for (const doc of s.documents) expect(doc.en && doc.ar, `${s.id} document`).toBeTruthy()
      expect(s.keywords.en.length, `${s.id} en keywords`).toBeGreaterThan(2)
      expect(s.keywords.ar.length, `${s.id} ar keywords`).toBeGreaterThan(2)
      expect(s.fulfilment === 'info' || s.documents.length > 0, `${s.id} documents`).toBe(true)
    }
  })
  it('covers more company/PRO services than resident ones, per the priority', () => {
    const company = SERVICES.filter((s) => s.audience === 'company').length
    const resident = SERVICES.filter((s) => s.audience === 'resident').length
    expect(company).toBeGreaterThan(resident)
    expect(SERVICES.length).toBeGreaterThanOrEqual(5)
  })
  it('looks services up by id', () => {
    expect(getService('noc')?.name.en).toMatch(/NOC/)
    expect(getService('nope')).toBeUndefined()
  })
})

describe('matcher: English and Arabic phrasings', () => {
  for (const [id, { en, ar }] of Object.entries(PHRASES)) {
    for (const [lang, list] of [['en', en], ['ar', ar]] as const) {
      it(`${id} (${lang}): every phrasing puts the right service first`, () => {
        const misses = list.filter((q) => findServices(q).matches[0]?.item.id !== id)
        expect(misses, `misses for ${id}/${lang}`).toEqual([])
      })
    }
  }
})

describe('matcher: ambiguity and misses', () => {
  it('a bare "visa" is ambiguous across the three visa services', () => {
    const r = findServices('I need a visa')
    expect(r.confidence).toBe('ambiguous')
    expect(r.matches.map((m) => m.item.id).sort()).toEqual(['visa_cancel', 'visa_new', 'visa_renewal'])
  })
  it('the Arabic bare "تأشيرة" is ambiguous too', () => {
    expect(findServices('أحتاج تأشيرة').confidence).toBe('ambiguous')
  })
  it('a "licence" question with no verb is ambiguous between renewal and amendment', () => {
    const r = findServices('I have a question about our licence amendment or renewal')
    expect(['ambiguous', 'clear']).toContain(r.confidence)
    expect(r.matches.length).toBeGreaterThan(0)
  })
  it('unknown requests match nothing', () => {
    for (const q of ["What's the fee for a drone permit?", 'ما هي رسوم تصريح الطائرات المسيرة', 'tell me a joke', 'hello', '']) {
      expect(findServices(q).confidence, q).toBe('none')
    }
  })
  it('survives one speech-to-text typo in a long word', () => {
    expect(findServices('I want to renew the establishmant card').matches[0]?.item.id).toBe('establishment_card')
  })
  it('does not turn cancelling an appointment into a visa cancellation', () => {
    expect(findServices('I want to cancel my appointment').matches[0]?.item.id).not.toBe('visa_cancel')
  })
})

describe('fact lookup', () => {
  it('answers brief and handover facts in both languages', () => {
    expect(lookupFact('Where is the e-wallet deposit machine?').fact?.id).toBe('ewallet_machine')
    expect(lookupFact('How many services does DSO have?').fact?.id).toBe('dso_online_services')
    expect(lookupFact('What is HADI?').fact?.id).toBe('hadi_chatbot')
    expect(lookupFact('ما هي ساعات العمل؟').fact?.id).toBe('demo_booking_hours')
  })
  it('refuses to answer what it was never given (no invented bus routes)', () => {
    for (const q of ['Which bus routes serve DSO?', 'What is the fee for a drone permit?', 'Where can I pray nearby?', 'ما أرقام الحافلات؟']) {
      expect(lookupFact(q).found, q).toBe(false)
    }
  })
  it('only holds facts with an allowed source', () => {
    for (const f of FACTS) expect(['brief', 'handover', 'kb']).toContain(f.source)
  })
})
