import { describe, expect, it } from 'vitest'
import type { HalaEvent } from '@hala/core'
import { COLORS, EMOJIS, FACE_PRIORITY, LED_MODES, LOOKS, LOOK_FRESH_SECS, LOOK_NAMES, PASS_QR_SECS, deriveScreen, displayCommandInput } from '../src'

const NOW = new Date('2026-11-25T10:00:00Z')
let n = 0
const ev = (type: HalaEvent['type'], data: Record<string, unknown> = {}, agoSecs = 1): HalaEvent => ({
  id: `e${++n}`, ts: new Date(NOW.getTime() - agoSecs * 1000).toISOString(), conversationId: 'c', type, data
})

describe('the tables match the AgiBot documentation', () => {
  it('has every documented emoji id once', () => {
    const ids = EMOJIS.map((e) => e.id)
    for (const id of [1, 10, 11, 20, 30, 31, 32, 33, 40, 50, 60, 70, 80, 90, 100, 101, 110, 120, 130, 140, 150, 160, 170, 180, 190, 200, 210, 220]) expect(ids, String(id)).toContain(id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('has the four LED modes', () => expect(LED_MODES.map((m) => m.id)).toEqual([0, 1, 2, 3]))
  it('uses a priority above what system modules use (10)', () => expect(FACE_PRIORITY).toBeGreaterThan(10))
  it('every look uses a real emoji and a valid LED (0-255, mode 0-3)', () => {
    for (const name of LOOK_NAMES) {
      const l = LOOKS[name]
      expect(EMOJIS.some((e) => e.id === l.emoji), name).toBe(true)
      expect([0, 1, 2, 3]).toContain(l.led.mode)
      for (const c of [l.led.r, l.led.g, l.led.b]) { expect(c).toBeGreaterThanOrEqual(0); expect(c).toBeLessThanOrEqual(255) }
    }
  })
  it("the conversation states loop; idle and every moment play once (so the robot's own faces can come back)", () => {
    for (const s of ['listening', 'speaking', 'thinking'] as const) expect(LOOKS[s].loop, s).toBe(true)
    for (const m of LOOK_NAMES.filter((x) => !['listening', 'speaking', 'thinking'].includes(x))) expect(LOOKS[m as keyof typeof LOOKS].loop, m).toBe(false)
  })
})

describe('test commands', () => {
  it('accepts a documented emoji and refuses an unknown id', () => {
    expect(displayCommandInput.parse({ type: 'emoji', id: '90' })).toEqual({ type: 'emoji', id: 90, loop: false })
    expect(() => displayCommandInput.parse({ type: 'emoji', id: 91 })).toThrow()
  })
  it('validates LED values', () => {
    expect(displayCommandInput.parse({ type: 'led', mode: 3, r: '255', g: 0, b: 10 })).toMatchObject({ mode: 3, r: 255 })
    expect(() => displayCommandInput.parse({ type: 'led', mode: 4, r: 0, g: 0, b: 0 })).toThrow()
    expect(() => displayCommandInput.parse({ type: 'led', mode: 1, r: 256, g: 0, b: 0 })).toThrow()
  })
  it('knows every named look', () => {
    for (const name of LOOK_NAMES) expect(displayCommandInput.parse({ type: 'look', name }).type).toBe('look')
    expect(() => displayCommandInput.parse({ type: 'look', name: 'nope' })).toThrow()
  })
  it('a QR carries text and shows for a bounded time; a video needs an absolute path', () => {
    expect(displayCommandInput.parse({ type: 'qr', text: 'https://x.example/pass/HALA-1001?k=abc' })).toMatchObject({ seconds: 20 })
    expect(() => displayCommandInput.parse({ type: 'qr', text: '' })).toThrow()
    expect(() => displayCommandInput.parse({ type: 'qr', text: 'x', seconds: 9999 })).toThrow()
    expect(displayCommandInput.parse({ type: 'video', path: '/var/tmp/hala/test.mp4' }).type).toBe('video')
    expect(() => displayCommandInput.parse({ type: 'video', path: 'relative.mp4' })).toThrow()
    expect(() => displayCommandInput.parse({ type: 'video', path: '/var/tmp/../../etc/passwd; rm -rf /' })).toThrow()
  })
})

describe('what the screen shows for the robot conversation', () => {
  it('nothing at the start of a conversation', () => {
    expect(deriveScreen([], NOW)).toEqual({ qr: null, look: null })
    expect(deriveScreen([ev('slots_listed')], NOW)).toEqual({ qr: null, look: null })
  })
  it('the phone QR while the agent waits for a number, gone once the text arrives', () => {
    const asked = ev('phone_requested', { code: 'K7M2QX' }, 5)
    expect(deriveScreen([asked], NOW).qr).toMatchObject({ key: 'link:K7M2QX', kind: 'link', code: 'K7M2QX' })
    const linked = deriveScreen([asked, ev('phone_linked', { phone: '***4567' }, 1)], NOW)
    expect(linked.qr).toBeNull()
    expect(linked.look?.name).toBe('happy')
  })
  it('a booking is a delighted moment and shows the pass QR for a while', () => {
    const booked = ev('booking_created', { ref: 'HALA-1001', pass: { ref: 'HALA-1001' }, pass_url: 'https://x/pass/HALA-1001?k=abc' }, 2)
    const s = deriveScreen([booked], NOW)
    expect(s.look).toEqual({ id: booked.id, name: 'delighted' })
    expect(s.qr).toMatchObject({ kind: 'pass', url: 'https://x/pass/HALA-1001?k=abc' })
    // later: the QR is over, the face is back
    expect(deriveScreen([ev('booking_created', { ref: 'HALA-1001', pass_url: 'https://x/p?k=a' }, PASS_QR_SECS + 5)], NOW).qr).toBeNull()
  })
  it('the phone QR wins over a pass QR, and a cancel takes the pass QR away', () => {
    const booked = ev('booking_created', { ref: 'HALA-1001', pass: { ref: 'HALA-1001' }, pass_url: 'https://x/p?k=a' }, 4)
    const asked = ev('phone_requested', { code: 'AAAAAA' }, 2)
    expect(deriveScreen([booked, asked], NOW).qr?.kind).toBe('link')
    expect(deriveScreen([booked, ev('booking_cancelled', { ref: 'HALA-1001' }, 1)], NOW).qr).toBeNull()
  })
  it('a repeated (duplicate) booking does not play the moment or the QR again', () => {
    const s = deriveScreen([ev('booking_created', { ref: 'HALA-1001', duplicate: true, pass_url: 'https://x/p?k=a' }, 1)], NOW)
    expect(s).toEqual({ qr: null, look: null })
  })
  it('reacts to what happened: hand-over, joke, trouble, no match', () => {
    const look = (e: HalaEvent) => deriveScreen([e], NOW).look?.name
    expect(look(ev('handover_requested', { reason: 'fee_dispute' }))).toBe('sympathy')
    expect(look(ev('handover_requested', { reason: 'emergency' }))).toBe('serious')
    expect(look(ev('handover_declined'))).toBe('cute')
    expect(look(ev('tool_error', { code: 'x' }))).toBe('confused')
    expect(look(ev('service_matched', { found: false }))).toBe('confused')
    expect(look(ev('service_matched', { found: true }))).toBeUndefined()
    expect(look(ev('request_logged', { ref: 'REQ-1001' }))).toBe('happy')
  })
  it('only the latest fresh moment counts, and an old one is not replayed', () => {
    const a = ev('tool_error', {}, 3)
    const b = ev('request_logged', {}, 1)
    expect(deriveScreen([a, b], NOW).look).toEqual({ id: b.id, name: 'happy' })
    expect(deriveScreen([ev('request_logged', {}, LOOK_FRESH_SECS + 2)], NOW).look).toBeNull()
  })
  it('colours are a real RGB triple', () => {
    for (const c of Object.values(COLORS)) for (const v of [c.r, c.g, c.b]) expect(v).toBeLessThanOrEqual(255)
  })
})
