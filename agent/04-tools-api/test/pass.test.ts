import { describe, expect, it, vi } from 'vitest'
import { createStores } from '@hala/booking'
import type { Booking, ServiceRequest } from '@hala/core'
import { SERVICES } from '@hala/catalogue'
import {
  buildIcs, createToolApi, passFromBooking, passFromRequest, passMessage, passToken, passUrl, queueStatus, triageHandover, verifyPassToken,
  type Fulfilled
} from '../src'

// Tuesday 24 Nov 2026, 12:00 Dubai
const NOW = new Date('2026-11-24T08:00:00Z')
const clock = { now: () => NOW }
const SECRET = 'test-secret'
const headers = { 'x-hala-secret': SECRET }

const booking = (over: Partial<Booking> = {}): Booking => ({
  ref: 'HALA-1001', serviceId: 'visa_renewal', attendeeName: 'Sara Al Mansoori', contact: '+971501234567', date: '2026-11-26', time: '10:30',
  language: 'en', status: 'confirmed', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), ...over
})
const request = (): ServiceRequest => ({
  ref: 'REQ-1001', serviceId: 'maintenance', callerName: 'Omar Haddad', contact: '+971559876543', details: 'AC not cooling in office 12', language: 'en', createdAt: NOW.toISOString()
})

describe('the pass', () => {
  it('an appointment pass has bilingual service, date, time, desk and documents, and only a first name', () => {
    const p = passFromBooking(booking(), SERVICES)!
    expect(p.kind).toBe('appointment')
    expect(p.service.en).toMatch(/visa renewal/i)
    expect(p.service.ar).toMatch(/تجديد/)
    expect(p.dateLabel?.en).toBe('Thursday, 26 November')
    expect(p.timeLabel?.en).toBe('10:30 AM')
    expect(p.desk?.label.en).toBe('Desk 04 · Visa Services')
    expect(p.desk?.label.ar).toMatch(/مكتب 04/)
    expect(p.documents.length).toBeGreaterThan(2)
    expect(p.holder).toBe('Sara')
    expect(JSON.stringify(p)).not.toContain('971501234567') // never the contact
    expect(JSON.stringify(p)).not.toContain('Mansoori') // never the surname on a public screen
    expect(p.demo).toBe(true)
  })
  it('a ticket pass has a team and the issue, no desk, no time', () => {
    const p = passFromRequest(request(), SERVICES)!
    expect(p.kind).toBe('request')
    expect(p.desk).toBeUndefined()
    expect(p.time).toBeUndefined()
    expect(p.team?.en).toBe('Facilities team')
    expect(p.detail).toContain('AC not cooling')
    expect(JSON.stringify(p)).not.toContain('971559876543')
  })
  it('every appointment service has a desk, no ticket service does', () => {
    for (const s of SERVICES.filter((s) => s.fulfilment === 'appointment')) {
      const p = passFromBooking(booking({ serviceId: s.id }), SERVICES)!
      expect(p.desk, s.id).toBeTruthy()
    }
  })
  it('returns nothing for a service that is not in the catalogue', () => {
    expect(passFromBooking(booking({ serviceId: 'nope' }), SERVICES)).toBeUndefined()
  })
})

describe('the link in the QR', () => {
  it('is signed per reference, so one pass cannot be opened by guessing the next number', () => {
    const k = passToken('HALA-1001', SECRET)
    expect(k).toHaveLength(12)
    expect(verifyPassToken('HALA-1001', k, SECRET)).toBe(true)
    expect(verifyPassToken('HALA-1002', k, SECRET)).toBe(false)
    expect(verifyPassToken('HALA-1001', 'x'.repeat(12), SECRET)).toBe(false)
    expect(verifyPassToken('HALA-1001', k, 'other-secret')).toBe(false)
    expect(verifyPassToken('HALA-1001', undefined, SECRET)).toBe(false)
    expect(verifyPassToken('HALA-1001', k, undefined)).toBe(false)
  })
  it('points at the public host with the ref in the path', () => {
    expect(passUrl('https://x.trycloudflare.com/', 'HALA-1001', SECRET)).toBe(`https://x.trycloudflare.com/pass/HALA-1001?k=${passToken('HALA-1001', SECRET)}`)
  })
})

describe('queue (demo)', () => {
  const pass = passFromBooking(booking({ date: '2026-11-24', time: '14:00' }), SERVICES)!
  it('counts the real earlier bookings on the day', () => {
    const q = queueStatus({ pass, now: NOW, sameDayTimes: ['09:00', '13:00', '13:30', '14:00', '14:30'] })!
    expect(q.state).toBe('today')
    expect(q.ahead).toBe(2) // 13:00 and 13:30 are still ahead; 09:00 is long gone, 14:30 comes after
    expect(q.waitMinutes).toBe(8)
    expect(q.label.en).toMatch(/2 ahead of you.*8 minutes/)
  })
  it('first in line is "next", about four minutes', () => {
    const q = queueStatus({ pass, now: NOW, sameDayTimes: ['14:00'] })!
    expect(q.ahead).toBe(0)
    expect(q.waitMinutes).toBe(4)
    expect(q.label.en).toMatch(/You are next.*4 minutes/)
  })
  it('on another day shows the desk queue right now, a stable demo figure', () => {
    const later = passFromBooking(booking(), SERVICES)!
    const a = queueStatus({ pass: later, now: NOW })!
    expect(a.state).toBe('upcoming')
    expect(a.waitMinutes % 4).toBe(0)
    expect(queueStatus({ pass: later, now: NOW })).toEqual(a) // same minute, same answer
    expect(a.startsInMinutes).toBeGreaterThan(24 * 60)
  })
  it('knows cancelled and past, and has none for a ticket', () => {
    expect(queueStatus({ pass: passFromBooking(booking({ status: 'cancelled' }), SERVICES)!, now: NOW })!.state).toBe('cancelled')
    expect(queueStatus({ pass: passFromBooking(booking({ date: '2026-11-23' }), SERVICES)!, now: NOW })!.state).toBe('past')
    expect(queueStatus({ pass: passFromRequest(request(), SERVICES)!, now: NOW })).toBeUndefined()
  })
})

describe('calendar file', () => {
  const ics = buildIcs(passFromBooking(booking(), SERVICES)!, { now: NOW, url: 'https://x.example/pass/HALA-1001?k=abc' })!
  it('is a valid single event with CRLF lines', () => {
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(ics.trimEnd().endsWith('END:VCALENDAR')).toBe(true)
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1)
    expect(ics).not.toMatch(/[^\r]\n/)
  })
  it('puts 10:30 Dubai at 06:30 UTC and lasts one 30-minute slot', () => {
    expect(ics).toContain('DTSTART:20261126T063000Z')
    expect(ics).toContain('DTEND:20261126T070000Z')
  })
  it('carries the reference, desk and an hour-before alarm', () => {
    expect(ics).toContain('UID:HALA-1001@hala.dso')
    expect(ics).toMatch(/Desk 04/)
    expect(ics).toContain('TRIGGER:-PT1H')
  })
  it('folds long lines to 75 octets and none is longer', () => {
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
  })
  it('has none for a ticket', () => {
    expect(buildIcs(passFromRequest(request(), SERVICES)!, { now: NOW })).toBeUndefined()
  })
})

describe('the text sent to the phone app', () => {
  const url = 'https://x.example/pass/HALA-1001?k=abc'
  it('says what, when, where, the reference and carries the link, in English', () => {
    const t = passMessage(passFromBooking(booking(), SERVICES)!, url, 'en')
    expect(t).toMatch(/Smart Pass/)
    expect(t).toContain('Thursday, 26 November, 10:30 AM')
    expect(t).toContain('Desk 04 · Visa Services')
    expect(t).toContain('HALA-1001')
    expect(t).toContain(url)
    expect(t).toMatch(/demo/i)
  })
  it('in Arabic', () => {
    const t = passMessage(passFromBooking(booking({ language: 'ar' }), SERVICES)!, url)
    expect(t).toMatch(/تصريح/)
    expect(t).toMatch(/الخميس 26 نوفمبر/)
    expect(t).toContain(url)
  })
  it('for a ticket promises no time', () => {
    const t = passMessage(passFromRequest(request(), SERVICES)!, 'https://x.example/pass/REQ-1001?k=abc', 'en')
    expect(t).toMatch(/REQ-1001/)
    expect(t).toMatch(/follow up/)
    expect(t).not.toMatch(/within|hours|minutes/i)
  })
  it('stays inside the text-message length the phone store allows', () => {
    expect(passMessage(passFromBooking(booking(), SERVICES)!, url, 'en').length).toBeLessThan(600)
    expect(passMessage(passFromBooking(booking({ language: 'ar' }), SERVICES)!, url, 'ar').length).toBeLessThan(600)
  })
})

describe('booking and logging produce the pass', () => {
  function setup(onFulfilled?: (f: Fulfilled, c?: string) => Promise<{ pass_sent?: boolean } | void>) {
    const stores = createStores()
    const api = createToolApi({ stores, clock, secret: SECRET, passBaseUrl: () => 'https://demo.trycloudflare.com', onFulfilled })
    const call = async (tool: string, body: Record<string, unknown>) => (await api.handle(tool, headers, { conversation_id: 'conv_1', language: 'en', ...body })).body as Record<string, any>
    return { stores, call }
  }
  const book = { service_id: 'visa_renewal', attendee_name: 'Sara Al Mansoori', contact: '+971501234567', date: '2026-11-26', time: '10:30' }

  it('the event carries the whole pass and its signed public link, never the contact', async () => {
    const { stores, call } = setup()
    const r = await call('book_appointment', book)
    expect(r.ok).toBe(true)
    expect(r.pass_on_screen).toBe(true)
    expect(r.pass_sent).toBe(false)
    expect(r.instruction).toMatch(/Smart Pass.*on the screen/)
    expect(r.instruction).toMatch(/do not say anything was sent to a phone/)
    const ev = (await stores.events.history('conv_1')).find((e) => e.type === 'booking_created')!
    const data = ev.data as any
    expect(data.pass.desk.label.en).toBe('Desk 04 · Visa Services')
    expect(data.pass_url).toBe(`https://demo.trycloudflare.com/pass/${r.booking.ref}?k=${passToken(r.booking.ref, SECRET)}`)
    expect(JSON.stringify(ev)).not.toContain('971501234567')
  })

  it('texts the pass through the hook and tells the agent it was sent', async () => {
    const seen = vi.fn(async (_f: Fulfilled, _c?: string) => ({ pass_sent: true }))
    const { call } = setup(seen)
    const r = await call('book_appointment', book)
    expect(seen).toHaveBeenCalledTimes(1)
    expect(seen.mock.calls[0]![0]).toMatchObject({ kind: 'booking', ref: r.booking.ref, duplicate: false })
    expect(seen.mock.calls[0]![1]).toBe('conv_1')
    expect(r.pass_sent).toBe(true)
    expect(r.instruction).toMatch(/texted to the caller's phone/)
  })

  it('a retried booking does not text the pass a second time', async () => {
    const seen = vi.fn(async () => ({ pass_sent: true }))
    const { call } = setup(seen)
    await call('book_appointment', book)
    const again = await call('book_appointment', book)
    expect(again.already_booked).toBe(true)
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('a failing hook never breaks the booking', async () => {
    const { call } = setup(async () => { throw new Error('phone store down') })
    const r = await call('book_appointment', book)
    expect(r.ok).toBe(true)
    expect(r.pass_sent).toBe(false)
  })

  it('a logged request gets a pass too', async () => {
    const seen = vi.fn(async () => ({ pass_sent: true }))
    const { stores, call } = setup(seen)
    const r = await call('log_request', { service_id: 'maintenance', caller_name: 'Omar Haddad', contact: '+971559876543', details: 'AC not cooling', urgency: 'routine' })
    expect(r.ok).toBe(true)
    expect(r.pass_on_screen).toBe(true)
    const ev = (await stores.events.history('conv_1')).find((e) => e.type === 'request_logged')!
    expect((ev.data as any).pass.kind).toBe('request')
    expect((ev.data as any).pass_url).toContain('/pass/REQ-')
  })

  it('a reschedule carries the updated pass so the screen can update it', async () => {
    const { stores, call } = setup()
    const b = await call('book_appointment', book)
    await call('reschedule_appointment', { ref: b.booking.ref, date: '2026-11-27', time: '09:00' })
    const ev = (await stores.events.history('conv_1')).find((e) => e.type === 'booking_rescheduled')!
    expect((ev.data as any).pass.date).toBe('2026-11-27')
    expect((ev.data as any).pass.time).toBe('09:00')
  })
})

describe('only a real matter reaches the staff', () => {
  it('never filters the reasons that always need a person', () => {
    for (const reason of ['fee_dispute', 'legal_question', 'upset_caller', 'caller_requested', 'emergency'] as const) {
      expect(triageHandover({ reason, summary: 'The caller was joking and just kidding, for fun' }).route, reason).toBe('staff')
    }
  })
  it('keeps an obvious joke out of the queue for the soft reasons', () => {
    for (const summary of [
      'Caller asked HALA to book a flight to Mars as a joke',
      'Caller is just kidding around and wanted a free Ferrari',
      'Caller wanted HALA to marry him',
      'The caller is testing the robot',
      'Prank: asked for a dragon permit'
    ]) {
      expect(triageHandover({ reason: 'out_of_scope', summary }).route, summary).toBe('decline')
    }
  })
  it('lets real matters through, including ones with words that merely look odd', () => {
    for (const summary of [
      'Caller wants a business licence amendment that is not in the catalogue and asks about a mezzanine office',
      'Caller asked what the parking rules are for contractors; not in the knowledge base. Name Sara, contact linked.',
      'Caller wants to pay a fine by card, which HALA cannot take',
      'Caller says the test results for the medical were delayed and the visa renewal is stuck'
    ]) {
      expect(triageHandover({ reason: 'unknown_answer', summary }).route, summary).toBe('staff')
    }
  })

  function setup() {
    const stores = createStores()
    const api = createToolApi({ stores, clock, secret: SECRET })
    const call = async (body: Record<string, unknown>, conv = 'conv_h') => (await api.handle('handover_to_human', headers, { conversation_id: conv, language: 'en', ...body })).body as Record<string, any>
    return { stores, call }
  }
  it('a joke is declined: no hand-over row, a declined event, and the agent is told not to offer a person', async () => {
    const { stores, call } = setup()
    const r = await call({ reason: 'out_of_scope', summary: 'Caller asked for a flight to Mars, clearly a joke' })
    expect(r.ok).toBe(true)
    expect(r.handed_over).toBe(false)
    expect(r.instruction).toMatch(/Nobody on the DSO team has been notified/)
    expect(r.instruction).toMatch(/Do not offer a person/)
    expect(await stores.handovers.list()).toHaveLength(0)
    expect((await stores.events.history('conv_h')).map((e) => e.type)).toEqual(['handover_declined'])
  })
  it('a real one is passed on', async () => {
    const { stores, call } = setup()
    const r = await call({ reason: 'fee_dispute', summary: 'Disputes the AED 2,800 renewal fee' })
    expect(r.handover_id).toMatch(/^HO-\d{5}$/)
    expect(await stores.handovers.list()).toHaveLength(1)
  })
  it('the same caller cannot create the same hand-over twice', async () => {
    const { stores, call } = setup()
    const first = await call({ reason: 'fee_dispute', summary: 'Disputes the fee' })
    const second = await call({ reason: 'fee_dispute', summary: 'Still disputes the fee' })
    expect(second.already_open).toBe(true)
    expect(second.handover_id).toBe(first.handover_id)
    expect(await stores.handovers.list()).toHaveLength(1)
    // a different reason in the same conversation is a different matter (an emergency must always get through)
    const emergency = await call({ reason: 'emergency', summary: 'Smoke in the server room' })
    expect(emergency.already_open).toBeUndefined()
    expect(await stores.handovers.list()).toHaveLength(2)
    // another caller is unaffected
    await call({ reason: 'fee_dispute', summary: 'Different caller' }, 'conv_other')
    expect(await stores.handovers.list()).toHaveLength(3)
  })
})
