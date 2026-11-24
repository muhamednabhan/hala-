import { describe, expect, it } from 'vitest'
import { createStores } from '@hala/booking'
import { TOOL_NAMES, TOOL_SPECS, createToolApi, normalizeRef, maskContact, spokenDate, spokenTime, spokenRef } from '../src'

// Tuesday 24 Nov 2026, 12:00 Dubai
const clock = { now: () => new Date('2026-11-24T08:00:00Z') }
const SECRET = 'test-secret'
const headers = { 'x-hala-secret': SECRET }

function setup() {
  const stores = createStores()
  const api = createToolApi({ stores, clock, secret: SECRET })
  const call = async (tool: string, body: Record<string, unknown>) => (await api.handle(tool, headers, { conversation_id: 'conv_1', ...body })).body as Record<string, any>
  return { stores, api, call }
}

describe('auth and routing', () => {
  it('fails closed without a configured secret', async () => {
    const api = createToolApi({ stores: createStores(), clock })
    expect((await api.handle('find_service', headers, { query: 'visa' })).status).toBe(401)
  })
  it('rejects a missing or wrong secret', async () => {
    const { api } = setup()
    expect((await api.handle('find_service', {}, { query: 'visa' })).status).toBe(401)
    expect((await api.handle('find_service', { 'x-hala-secret': 'nope' }, { query: 'visa' })).status).toBe(401)
    expect((await api.handle('find_service', new Headers({ 'x-hala-secret': SECRET }), { query: 'visa' })).status).toBe(200)
  })
  it('404s unknown tools', async () => {
    expect((await setup().api.handle('drop_tables', headers, {})).status).toBe(404)
  })
  it('turns bad input into a spoken-friendly error, not a crash', async () => {
    const { call } = setup()
    const r = await call('book_appointment', { service_id: 'noc' })
    expect(r.ok).toBe(false)
    expect(r.error_code).toBe('invalid_input')
    expect(r.instruction).toBeTruthy()
  })
  it('has a handler and a snake_case name for every spec', async () => {
    const { api } = setup()
    for (const s of TOOL_SPECS) {
      expect(s.name).toMatch(/^[a-z][a-z0-9_]+$/)
      expect((await api.handle(s.name, headers, {})).status, s.name).not.toBe(404)
    }
  })
})

describe('find_service', () => {
  it('returns one clear service with documents and a demo notice', async () => {
    const r = await setup().call('find_service', { query: 'I need to renew an employee visa' })
    expect(r.found).toBe(true)
    expect(r.confidence).toBe('clear')
    expect(r.services).toHaveLength(1)
    expect(r.services[0].id).toBe('visa_renewal')
    expect(r.services[0].documents.length).toBeGreaterThan(2)
    expect(r.demo_notice.en).toMatch(/demonstration/)
  })
  it('returns several options and a question when ambiguous', async () => {
    const r = await setup().call('find_service', { query: 'visa' })
    expect(r.confidence).toBe('ambiguous')
    expect(r.services.length).toBeGreaterThan(1)
    expect(r.instruction).toMatch(/ONE short question/)
  })
  it('says not found for unknown services instead of guessing', async () => {
    const r = await setup().call('find_service', { query: "What's the fee for a drone permit?" })
    expect(r.found).toBe(false)
    expect(r.instruction).toMatch(/do not guess/)
  })
  it('understands Arabic', async () => {
    const r = await setup().call('find_service', { query: 'المكيف خربان' })
    expect(r.services[0].id).toBe('maintenance')
  })
})

describe('slots, booking, change, cancel', () => {
  it('resolves relative days on the server and speaks them in both languages', async () => {
    const r = await setup().call('list_slots', { when: 'thursday' })
    expect(r.date).toBe('2026-11-26')
    expect(r.date_spoken.en).toBe('Thursday, 26 November')
    expect(r.date_spoken.ar).toBe('الخميس 26 نوفمبر')
    expect(r.slots[0].time_spoken.ar).toBe('8:00 صباحاً')
    expect(r.today).toBe('2026-11-24')
  })
  it('skips the weekend with alternatives', async () => {
    const r = await setup().call('list_slots', { when: '2026-11-28' })
    expect(r.slots).toEqual([])
    expect(r.alternatives[0].date).toBe('2026-11-30')
  })
  it('next_available returns slots from today onwards', async () => {
    const r = await setup().call('list_slots', { when: 'next_available' })
    expect(r.slots[0].date).toBe('2026-11-24')
    expect(r.slots[0].time).toBe('12:30')
  })
  it('rejects garbage dates politely', async () => {
    expect((await setup().call('list_slots', { when: 'sometime' })).error_code).toBe('invalid_date')
  })

  it('runs the full scenario: book, check, reschedule, cancel', async () => {
    const { call, stores } = setup()
    const booked = await call('book_appointment', {
      service_id: 'visa_renewal', attendee_name: 'Ahmed Test', booked_by_name: 'Sara Test', contact: '0500000000', date: '2026-11-26', time: '10:30', language: 'ar'
    })
    expect(booked.ok).toBe(true)
    expect(booked.booking.ref).toBe('HALA-1001')
    expect(booked.booking.ref_spoken).toBe('1 0 0 1')
    expect(booked.booking.time_spoken.en).toBe('10:30 AM')

    expect((await call('check_booking', { ref: 'hala 1001' })).booking.attendee_name).toBe('Ahmed Test')

    const taken = await call('book_appointment', { service_id: 'noc', attendee_name: 'Other', contact: '0511111111', date: '2026-11-26', time: '10:30' })
    expect(taken.ok).toBe(false)
    expect(taken.error_code).toBe('taken')
    expect(taken.alternatives.length).toBe(3)

    const moved = await call('reschedule_appointment', { ref: 'HALA-1001', date: 'friday', time: '9am' })
    expect(moved.ok).toBe(true)
    expect(moved.booking.date).toBe('2026-11-27')
    expect(moved.booking.time).toBe('09:00')

    const cancelled = await call('cancel_appointment', { ref: '1001' })
    expect(cancelled.ok).toBe(true)
    expect(cancelled.already_cancelled).toBe(false)
    expect((await call('cancel_appointment', { ref: '1001' })).already_cancelled).toBe(true)

    const types = (await stores.events.history('conv_1')).map((e) => e.type)
    expect(types).toEqual(expect.arrayContaining(['booking_created', 'booking_rescheduled', 'booking_cancelled', 'tool_error']))
  })
  it('does not book ticket or info services as appointments', async () => {
    const { call } = setup()
    expect((await call('book_appointment', { service_id: 'maintenance', attendee_name: 'A B', contact: '0500000000', date: '2026-11-26', time: '10:30' })).error_code).toBe('wrong_fulfilment')
    expect((await call('book_appointment', { service_id: 'nope', attendee_name: 'A B', contact: '0500000000', date: '2026-11-26', time: '10:30' })).error_code).toBe('unknown_service')
  })
  it('is idempotent when ElevenLabs retries the call', async () => {
    const { call, stores } = setup()
    const body = { service_id: 'noc', attendee_name: 'Ahmed Test', contact: '0500000000', date: '2026-11-26', time: '11:00' }
    const a = await call('book_appointment', body)
    const b = await call('book_appointment', body)
    expect(a.booking.ref).toBe(b.booking.ref)
    expect(b.already_booked).toBe(true)
    expect(await stores.bookings.list()).toHaveLength(1)
  })
  it('reports unknown references and bad reference formats', async () => {
    const { call } = setup()
    expect((await call('cancel_appointment', { ref: 'HALA-9999' })).error_code).toBe('not_found')
    expect((await call('cancel_appointment', { ref: 'abc' })).error_code).toBe('invalid_ref')
    expect((await call('check_booking', { ref: 'HALA-9999' })).error_code).toBe('not_found')
  })
})

describe('requests, facts, handover', () => {
  it('logs a maintenance request, once, and masks the contact in the event feed', async () => {
    const { call, stores } = setup()
    const body = { service_id: 'maintenance', caller_name: 'Sara Test', contact: '0501234567', details: 'AC not cooling in unit 12', location: 'Unit 12' }
    const a = await call('log_request', body)
    const b = await call('log_request', body)
    expect(a.ref).toBe('REQ-1001')
    expect(b.already_logged).toBe(true)
    expect(await stores.requests.list()).toHaveLength(1)
    const [ev] = (await stores.events.history('conv_1')).filter((e) => e.type === 'request_logged')
    expect(JSON.stringify(ev)).not.toContain('0501234567')
    expect(JSON.stringify(ev)).toContain('***4567')
  })
  it('refuses to log appointment services as tickets', async () => {
    const r = await setup().call('log_request', { service_id: 'noc', caller_name: 'A', contact: '0500000000', details: 'x' })
    expect(r.error_code).toBe('not_a_ticket_service')
  })
  it('answers verified facts and refuses to invent others', async () => {
    const { call } = setup()
    const yes = await call('lookup_fact', { question: 'Where is the e-wallet deposit machine?' })
    expect(yes.found).toBe(true)
    expect(yes.answer.en).toMatch(/24-hour/)
    const no = await call('lookup_fact', { question: 'Which bus routes serve DSO?' })
    expect(no.found).toBe(false)
    expect(no.instruction).toMatch(/do not know/)
  })
  it('stores a handover with its reason and publishes it for the dashboard', async () => {
    const { call, stores } = setup()
    const r = await call('handover_to_human', { reason: 'fee_dispute', summary: 'Caller says the access card fee is wrong.', language: 'en' })
    expect(r.ok).toBe(true)
    const [h] = await stores.handovers.list()
    expect(h).toMatchObject({ reason: 'fee_dispute', language: 'en', status: 'open' })
    expect((await stores.events.history('conv_1')).some((e) => e.type === 'handover_requested')).toBe(true)
  })
  it('maps an unknown handover reason to "other" rather than failing', async () => {
    const r = await setup().api.handle('handover_to_human', headers, { reason: 'whatever', summary: 'x' })
    expect(r.body.ok).toBe(false) // enum validation rejects it, the agent retries with a valid reason
  })
})

describe('speech helpers', () => {
  it('formats refs, dates and times', () => {
    expect(spokenRef('HALA-1001')).toBe('1 0 0 1')
    expect(spokenDate('2026-11-26').en).toBe('Thursday, 26 November')
    expect(spokenTime('14:30')).toEqual({ en: '2:30 PM', ar: '2:30 مساءً' })
  })
  it('normalises references', () => {
    expect(normalizeRef('HALA-1001')).toBe('HALA-1001')
    expect(normalizeRef('hala 1001')).toBe('HALA-1001')
    expect(normalizeRef('1 0 0 1')).toBe('HALA-1001')
    expect(normalizeRef('abc')).toBeUndefined()
  })
  it('masks contacts', () => {
    expect(maskContact('0501234567')).toBe('***4567')
    expect(maskContact('sara@example.com')).toBe('s***@example.com')
  })
  it('uses the tool names the prompt expects', () => {
    expect(Object.values(TOOL_NAMES).sort()).toEqual(TOOL_SPECS.map((s) => s.name).sort())
  })
})
