import { describe, expect, it } from 'vitest'
import type { HalaEvent } from '@hala/core'
import { deriveKiosk, passQrSrc } from '../lib/kiosk'

let n = 0
const ev = (type: HalaEvent['type'], data: Record<string, unknown>): HalaEvent => ({ id: `e${++n}`, ts: new Date(1_700_000_000_000 + n * 1000).toISOString(), conversationId: 'c', type, data })
const pass = (ref = 'HALA-1001', time = '10:30') => ({ kind: 'appointment', ref, service: { en: 'Visa renewal', ar: 'تجديد' }, time, documents: [], language: 'en', demo: true })

describe('phone link on the screen', () => {
  it('shows nothing until the agent asks for a number', () => {
    expect(deriveKiosk([ev('service_matched', {})])).toEqual({})
  })
  it('the QR appears on the request and becomes "linked" when the text arrives', () => {
    const asked = ev('phone_requested', { code: 'K7M2QX', qr: '/api/phone/qr?code=K7M2QX' })
    expect(deriveKiosk([asked]).linkRequest).toEqual({ code: 'K7M2QX', qr: '/api/phone/qr?code=K7M2QX' })
    const done = deriveKiosk([asked, ev('phone_linked', { phone: '***4567' })])
    expect(done.linked).toEqual({ phone: '***4567' })
    expect(done.linkRequest?.code).toBe('K7M2QX')
  })
  it('asking again with the same code changes nothing; a new code starts over', () => {
    const a = ev('phone_requested', { code: 'AAAAAA', qr: '/q?a' })
    const linked = ev('phone_linked', { phone: '***1' })
    expect(deriveKiosk([a, linked, ev('phone_requested', { code: 'AAAAAA', qr: '/q?a' })]).linked).toBeDefined()
    expect(deriveKiosk([a, linked, ev('phone_requested', { code: 'BBBBBB', qr: '/q?b' })]).linked).toBeUndefined()
  })
})

describe('the Smart Pass on the screen', () => {
  it('appears on a booking with its link, and the sent flag comes from the event', () => {
    const k = deriveKiosk([ev('booking_created', { ref: 'HALA-1001', pass: pass(), pass_url: 'https://x/pass/HALA-1001?k=abc', pass_sent: false })])
    expect(k.pass?.pass.ref).toBe('HALA-1001')
    expect(k.pass?.sent).toBe(false)
    expect(deriveKiosk([ev('booking_created', { pass: pass(), pass_sent: true })]).pass?.sent).toBe(true)
  })
  it('appears on a logged request too', () => {
    expect(deriveKiosk([ev('request_logged', { pass: { ...pass('REQ-1001'), kind: 'request' } })]).pass?.pass.ref).toBe('REQ-1001')
  })
  it('the "sent to your phone" event ticks the same pass, not another one', () => {
    const base = ev('booking_created', { pass: pass(), pass_sent: false })
    expect(deriveKiosk([base, ev('pass_sent', { ref: 'HALA-1001' })]).pass?.sent).toBe(true)
    expect(deriveKiosk([base, ev('pass_sent', { ref: 'HALA-9999' })]).pass?.sent).toBe(false)
  })
  it('a reschedule updates the pass in place and keeps the sent tick', () => {
    const k = deriveKiosk([ev('booking_created', { pass: pass(), pass_sent: true }), ev('booking_rescheduled', { pass: pass('HALA-1001', '12:00') })])
    expect(k.pass?.pass.time).toBe('12:00')
    expect(k.pass?.sent).toBe(true)
  })
  it('a cancel removes that pass only', () => {
    const made = ev('booking_created', { pass: pass(), pass_sent: false })
    expect(deriveKiosk([made, ev('booking_cancelled', { ref: 'HALA-1001' })]).pass).toBeUndefined()
    expect(deriveKiosk([made, ev('booking_cancelled', { ref: 'HALA-2222' })]).pass).toBeDefined()
  })
  it('a retried tool call (duplicate) does not replace the pass or reset the sent tick', () => {
    const k = deriveKiosk([ev('booking_created', { pass: pass(), pass_sent: true }), ev('booking_created', { pass: pass(), pass_sent: false, duplicate: true })])
    expect(k.pass?.sent).toBe(true)
  })
  it('a newer booking replaces the older pass', () => {
    expect(deriveKiosk([ev('booking_created', { pass: pass('HALA-1001') }), ev('booking_created', { pass: pass('HALA-1002') })]).pass?.pass.ref).toBe('HALA-1002')
  })
  it('ignores an event with no usable pass (an older server, or a service not in the catalogue)', () => {
    expect(deriveKiosk([ev('booking_created', { ref: 'HALA-1001' })]).pass).toBeUndefined()
  })
})

describe('the pass QR', () => {
  it('is built from the signature in the signed link', () => {
    expect(passQrSrc('HALA-1001', 'https://x.trycloudflare.com/pass/HALA-1001?k=abc123')).toBe('/api/pass/HALA-1001/qr?k=abc123')
  })
  it('has none without a signature or a valid link', () => {
    expect(passQrSrc('HALA-1001', 'https://x/pass/HALA-1001')).toBeUndefined()
    expect(passQrSrc('HALA-1001', '')).toBeUndefined()
  })
})
