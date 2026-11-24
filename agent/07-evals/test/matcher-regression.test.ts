import { describe, expect, it } from 'vitest'
import { SERVICES, findServices } from '@hala/catalogue'
import { PHRASES } from '../../02-catalogue/test/phrases'

/**
 * Catalogue matcher regression. The phrase bank is shared with 02-catalogue; here we also report
 * accuracy per service and language, and check that out-of-scope requests match nothing.
 */
const rows = Object.entries(PHRASES).flatMap(([id, { en, ar }]) => [
  ...en.map((q) => ({ id, lang: 'en' as const, q })),
  ...ar.map((q) => ({ id, lang: 'ar' as const, q }))
])
const outcome = (r: (typeof rows)[number]) => {
  const res = findServices(r.q)
  return { top: res.matches[0]?.item.id, confidence: res.confidence, ids: res.matches.map((m) => m.item.id) }
}

describe('phrase bank accuracy', () => {
  it('covers every catalogue service with at least 8 English and 8 Arabic phrasings', () => {
    for (const s of SERVICES) {
      expect(PHRASES[s.id]?.en.length ?? 0, `${s.id} en`).toBeGreaterThanOrEqual(8)
      expect(PHRASES[s.id]?.ar.length ?? 0, `${s.id} ar`).toBeGreaterThanOrEqual(8)
    }
  })

  it('reports and enforces accuracy: top-1 per language and overall', () => {
    const results = rows.map((r) => ({ ...r, ...outcome(r) }))
    const stat = (f: (r: (typeof results)[number]) => boolean) => {
      const subset = results.filter(f)
      return { n: subset.length, ok: subset.filter((r) => r.top === r.id).length }
    }
    const overall = stat(() => true)
    const en = stat((r) => r.lang === 'en')
    const ar = stat((r) => r.lang === 'ar')
    const pct = (s: { n: number; ok: number }) => `${((s.ok / s.n) * 100).toFixed(1)}% (${s.ok}/${s.n})`

    const perService = Object.keys(PHRASES).map((id) => `${id.padEnd(20)} ${pct(stat((r) => r.id === id))}`)
    console.log(`[matcher accuracy] overall ${pct(overall)} | English ${pct(en)} | Arabic ${pct(ar)}\n${perService.join('\n')}`)

    expect(overall.ok / overall.n).toBeGreaterThanOrEqual(0.97)
    expect(en.ok / en.n).toBeGreaterThanOrEqual(0.95)
    expect(ar.ok / ar.n).toBeGreaterThanOrEqual(0.95)
    for (const id of Object.keys(PHRASES)) {
      const s = stat((r) => r.id === id)
      expect(s.ok / s.n, id).toBeGreaterThanOrEqual(0.9)
    }
  })

  it('a clear match is never wrong: when confidence is clear the top service is the right one', () => {
    const wrongClear = rows.map((r) => ({ ...r, ...outcome(r) })).filter((r) => r.confidence === 'clear' && r.top !== r.id)
    expect(wrongClear.map((r) => `${r.id}: ${r.q} -> ${r.top}`)).toEqual([])
  })

  it('every phrasing reaches the agent with the right service among the options', () => {
    const missing = rows.map((r) => ({ ...r, ...outcome(r) })).filter((r) => !r.ids.includes(r.id))
    expect(missing.map((r) => `${r.id}: ${r.q}`)).toEqual([])
  })
})

describe('out-of-scope requests match nothing (the agent must admit it does not know)', () => {
  const OUT_OF_SCOPE = [
    "What's the fee for a drone permit?", 'How do I get a drone permit?', 'I want to buy a car', 'What is the weather today?',
    'Tell me a joke', 'Where is the nearest hospital?', 'Can you book me a flight to London?', 'How do I pay my electricity bill?',
    'What is the meaning of life?', 'hello', 'thank you very much',
    'كم رسوم تصريح الطائرات المسيرة', 'كيف أحجز تذكرة طيران', 'ما حالة الطقس اليوم', 'أخبرني نكتة', 'شكراً جزيلاً', 'مرحبا'
  ]
  it.each(OUT_OF_SCOPE)('%s', (q) => {
    expect(findServices(q).confidence).toBe('none')
  })
})

describe('Arabic spelling and speech-to-text variants', () => {
  it.each([
    ['تأشيرة', 'تاشيرة'], ['إلغاء', 'الغاء'], ['رخصة', 'رخصه'], ['إيجار', 'ايجار'], ['صيانة', 'صيانه']
  ])('"%s" and "%s" are the same to the matcher', (a, b) => {
    expect(findServices(`أحتاج تجديد ${a}`).matches.map((m) => m.item.id)).toEqual(findServices(`أحتاج تجديد ${b}`).matches.map((m) => m.item.id))
  })
  it('Arabic-Indic digits do not break matching', () => {
    expect(findServices('أحتاج ٢ بطاقة دخول').matches[0]?.item.id).toBe('access_card')
  })
  it('mixed Arabic and English still finds the service', () => {
    expect(findServices('I need NOC شهادة عدم ممانعة').matches[0]?.item.id).toBe('noc')
    expect(findServices('أبغى renew visa لموظف').matches[0]?.item.id).toBe('visa_renewal')
  })
})
