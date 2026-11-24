import { describe, expect, it } from 'vitest'
import { createHarness } from '../src/harness'

/**
 * Scenario scripts. Each plays what a CORRECT agent would do for a caller, calling the real tools
 * API in order, and asserts results and the event feed. Clock: Tuesday 24 Nov 2026, 12:00 Dubai.
 */
const PHONE = '0501234567'

describe('company: visa renewal, end to end', () => {
  it('English: find the service, offer slots, book, read the confirmation back', async () => {
    const h = createHarness()
    const found = await h.call('find_service', { query: 'I need to renew the visa of one of our employees' })
    expect(found).toMatchObject({ found: true, confidence: 'clear' })
    expect(found.services[0].id).toBe('visa_renewal')
    expect(found.services[0].fulfilment).toBe('appointment')
    expect(found.services[0].documents.length).toBeGreaterThanOrEqual(3)
    expect(found.demo_notice.en).toMatch(/demonstration/)

    const slots = await h.call('list_slots', { when: 'thursday' })
    expect(slots.date).toBe('2026-11-26')
    expect(slots.slots.map((s: any) => s.time)).toContain('10:30')

    const booked = await h.call('book_appointment', { service_id: 'visa_renewal', attendee_name: 'Ahmed Khan', contact: PHONE, date: '2026-11-26', time: '10:30', language: 'en' })
    expect(booked.ok).toBe(true)
    expect(booked.booking).toMatchObject({ ref: 'HALA-1001', ref_spoken: '1 0 0 1', date: '2026-11-26', time: '10:30' })
    expect(booked.booking.date_spoken.en).toBe('Thursday, 26 November')
    expect(booked.instruction).toMatch(/reference number digit by digit/)

    expect(await h.eventTypes('conv_eval')).toEqual(['service_matched', 'slots_listed', 'booking_created'])
    const stored = await h.stores.bookings.list()
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({ attendeeName: 'Ahmed Khan', serviceId: 'visa_renewal', language: 'en', conversationId: 'conv_eval' })
  })

  it('Arabic: the same flow, with Arabic dates and times to speak', async () => {
    const h = createHarness()
    const found = await h.call('find_service', { query: 'أريد تجديد تأشيرة عمل لموظف' })
    expect(found.services[0].id).toBe('visa_renewal')
    expect(found.services[0].name.ar).toBe('تجديد تأشيرة العمل')

    const slots = await h.call('list_slots', { when: 'tomorrow' })
    expect(slots.date).toBe('2026-11-25')
    expect(slots.date_spoken.ar).toBe('الأربعاء 25 نوفمبر')
    expect(slots.slots[0].time_spoken.ar).toBe('8:00 صباحاً')

    const booked = await h.call('book_appointment', { service_id: 'visa_renewal', attendee_name: 'أحمد خان', contact: PHONE, date: '2026-11-25', time: '14:30', language: 'ar' })
    expect(booked.ok).toBe(true)
    expect(booked.booking.time_spoken.ar).toBe('2:30 مساءً')
    expect((await h.stores.bookings.list())[0]).toMatchObject({ language: 'ar', attendeeName: 'أحمد خان' })
  })

  it('booking for someone else records both names', async () => {
    const h = createHarness()
    await h.call('book_appointment', { service_id: 'noc', attendee_name: 'Omar Ali', booked_by_name: 'Sara Test', contact: PHONE, date: '2026-11-26', time: '09:00' })
    expect((await h.stores.bookings.list())[0]).toMatchObject({ attendeeName: 'Omar Ali', bookedByName: 'Sara Test' })
  })

  it('a vague "visa" is ambiguous: the agent gets the options and a question to ask', async () => {
    const r = await (createHarness()).call('find_service', { query: 'I need a visa' })
    expect(r.confidence).toBe('ambiguous')
    expect(r.services.map((s: any) => s.id).sort()).toEqual(['visa_cancel', 'visa_new', 'visa_renewal'])
    expect(r.services[0].clarifying_question.en).toMatch(/new visa, a renewal, or a cancellation/)
    expect(r.instruction).toMatch(/ONE short question/)
  })
})

describe('language switch mid-conversation', () => {
  it('English then Arabic in one conversation: one event feed, language recorded per action', async () => {
    const h = createHarness('conv_switch')
    const en = await h.call('find_service', { query: 'how do I get an access card?' }, 'conv_switch')
    const ar = await h.call('find_service', { query: 'كم رسوم بطاقة الدخول؟' }, 'conv_switch')
    expect(en.services[0].id).toBe('access_card')
    expect(ar.services[0].id).toBe('access_card')
    // both languages are present in every result so the agent can answer in whichever the caller uses
    expect(ar.services[0].name).toEqual({ en: 'Access / ID card', ar: 'بطاقة الدخول' })
    expect(ar.services[0].demo_fee_aed).toBeGreaterThan(0)

    const booked = await h.call('book_appointment', { service_id: 'access_card', attendee_name: 'Sara Test', contact: PHONE, date: '2026-11-26', time: '11:00', language: 'ar' }, 'conv_switch')
    expect(booked.ok).toBe(true)
    expect(await h.eventTypes('conv_switch')).toEqual(['service_matched', 'service_matched', 'booking_created'])
  })
})

describe('reschedule then cancel', () => {
  it('moves the appointment, frees the old slot, cancels, and is safe to repeat', async () => {
    const h = createHarness()
    const b = await h.call('book_appointment', { service_id: 'licence_renewal', attendee_name: 'Lina Test', contact: PHONE, date: '2026-11-26', time: '10:30' })
    const ref = b.booking.ref

    const moved = await h.call('reschedule_appointment', { ref, date: 'friday', time: '9:00' })
    expect(moved.ok).toBe(true)
    expect(moved.booking).toMatchObject({ date: '2026-11-27', time: '09:00' })
    expect(moved.previous.date_spoken.en).toBe('Thursday, 26 November')

    const oldDay = await h.call('list_slots', { when: '2026-11-26' })
    expect(oldDay.slots.map((s: any) => s.time)).toContain('10:30')

    expect((await h.call('check_booking', { ref: 'hala 1001' })).booking).toMatchObject({ date: '2026-11-27', status: 'confirmed' })

    const cancelled = await h.call('cancel_appointment', { ref })
    expect(cancelled).toMatchObject({ ok: true, already_cancelled: false })
    expect((await h.call('cancel_appointment', { ref })).already_cancelled).toBe(true)
    expect((await h.call('check_booking', { ref })).booking.status).toBe('cancelled')
    expect((await h.call('reschedule_appointment', { ref, date: '2026-11-30', time: '09:00' })).error_code).toBe('already_cancelled')

    expect(await h.eventTypes('conv_eval')).toEqual(expect.arrayContaining(['booking_created', 'booking_rescheduled', 'booking_cancelled']))
  })
})

describe('tickets: maintenance and complaints', () => {
  it('Arabic maintenance request becomes a ticket, not an appointment', async () => {
    const h = createHarness()
    const found = await h.call('find_service', { query: 'المكيف في المكتب خربان' })
    expect(found.services[0]).toMatchObject({ id: 'maintenance', fulfilment: 'ticket' })
    expect(found.services[0].note_for_agent).toMatch(/log_request/)

    const wrong = await h.call('book_appointment', { service_id: 'maintenance', attendee_name: 'Sara Test', contact: PHONE, date: '2026-11-26', time: '10:30' })
    expect(wrong.error_code).toBe('wrong_fulfilment')

    const logged = await h.call('log_request', { service_id: 'maintenance', caller_name: 'سارة أحمد', contact: '0509876543', details: 'المكيف في المكتب لا يبرد', location: 'مكتب 12', language: 'ar' })
    expect(logged).toMatchObject({ ok: true, ref: 'REQ-1001', ref_spoken: '1 0 0 1' })
    expect((await h.stores.requests.list())[0]).toMatchObject({ callerName: 'سارة أحمد', language: 'ar', location: 'مكتب 12' })
    expect(await h.eventTypes()).toContain('request_logged')
  })

  it('a complaint is logged as a service', async () => {
    const h = createHarness()
    const found = await h.call('find_service', { query: 'I want to file a complaint about the noise' })
    expect(found.services[0]).toMatchObject({ id: 'complaint', fulfilment: 'ticket' })
    const logged = await h.call('log_request', { service_id: 'complaint', caller_name: 'Omar Test', contact: PHONE, details: 'Loud construction noise after 6 pm', language: 'en' })
    expect(logged.ok).toBe(true)
    expect(logged.instruction).toMatch(/Do not promise a time/)
  })

  it('a fee-related complaint carries the warning that it is a dispute, to be handed over', async () => {
    const found = await createHarness().call('find_service', { query: 'I want to complain about a charge' })
    expect(found.services[0].id).toBe('complaint')
    expect(found.services[0].note_for_agent).toMatch(/fee_dispute/)
  })
})

describe('handover', () => {
  it('fee dispute: handed over with reason fee_dispute and NOT logged as a complaint', async () => {
    const h = createHarness()
    // "This fee is ridiculous, I want to talk to someone." matches no service, so the agent goes straight to handover.
    expect((await h.call('find_service', { query: 'This fee is ridiculous, I want to talk to someone.' })).found).toBe(false)
    const r = await h.call('handover_to_human', { reason: 'fee_dispute', summary: 'Caller says the access card fee is too high and wants a person.', language: 'en' })
    expect(r.ok).toBe(true)
    expect(r.instruction).toMatch(/Do not promise a callback time, a refund, a waiver or an outcome/)
    expect(await h.stores.handovers.list()).toHaveLength(1)
    expect((await h.stores.handovers.list())[0]).toMatchObject({ reason: 'fee_dispute', status: 'open', language: 'en' })
    expect(await h.stores.requests.list()).toHaveLength(0)
    expect(await h.eventTypes()).toContain('handover_requested')
  })

  it('unknown service (drone permit): find_service says not found, then handover unknown_answer', async () => {
    const h = createHarness()
    const found = await h.call('find_service', { query: "What's the fee for a drone permit?" })
    expect(found).toMatchObject({ ok: true, found: false, confidence: 'none' })
    expect(found.services).toBeUndefined()
    expect(found.instruction).toMatch(/do not guess/)
    expect(JSON.stringify(found)).not.toMatch(/\bAED\b|\d{3,}/) // no figure to be tempted by

    await h.call('handover_to_human', { reason: 'unknown_answer', summary: 'Caller asked about a drone permit fee; not in catalogue.', language: 'en' })
    expect((await h.stores.handovers.list())[0]!.reason).toBe('unknown_answer')
  })

  it('Arabic handover keeps the Arabic language for the human taking over', async () => {
    const h = createHarness()
    await h.call('handover_to_human', { reason: 'upset_caller', summary: 'Caller upset about repeated AC problem.', language: 'ar', caller_name: 'سارة' })
    expect((await h.stores.handovers.list())[0]).toMatchObject({ language: 'ar', callerName: 'سارة' })
  })
})

describe('calendar edge cases', () => {
  it('double booking: the second caller is refused and offered three other slots', async () => {
    const h = createHarness()
    await h.call('book_appointment', { service_id: 'noc', attendee_name: 'First Caller', contact: PHONE, date: '2026-11-26', time: '10:30' })
    const second = await h.call('book_appointment', { service_id: 'noc', attendee_name: 'Second Caller', contact: '0507654321', date: '2026-11-26', time: '10:30' }, 'conv_two')
    expect(second).toMatchObject({ ok: false, error_code: 'taken' })
    expect(second.alternatives).toHaveLength(3)
    expect(second.alternatives.some((a: any) => a.date === '2026-11-26' && a.time === '10:30')).toBe(false)
    expect(second.instruction).toMatch(/offer these alternatives/)

    const alt = second.alternatives[0]
    const retry = await h.call('book_appointment', { service_id: 'noc', attendee_name: 'Second Caller', contact: '0507654321', date: alt.date, time: alt.time }, 'conv_two')
    expect(retry.ok).toBe(true)
    expect(await h.stores.bookings.list()).toHaveLength(2)
  })

  it('weekend: Saturday has no slots and the alternatives start Monday morning', async () => {
    const h = createHarness()
    const sat = await h.call('list_slots', { when: 'saturday' })
    expect(sat.date).toBe('2026-11-28')
    expect(sat.slots).toEqual([])
    expect(sat.alternatives[0]).toMatchObject({ date: '2026-11-30', time: '08:00' })
    expect(sat.instruction).toMatch(/Do not invent times/)

    const direct = await h.call('book_appointment', { service_id: 'noc', attendee_name: 'Weekend Caller', contact: PHONE, date: '2026-11-28', time: '10:00' })
    expect(direct).toMatchObject({ ok: false, error_code: 'weekend' })
    expect(direct.alternatives[0].date).toBe('2026-11-30')
    expect(await h.stores.bookings.list()).toHaveLength(0)
  })

  it('past and out-of-hours requests are refused with a reason the agent can say', async () => {
    const h = createHarness()
    expect((await h.call('book_appointment', { service_id: 'noc', attendee_name: 'Late Caller', contact: PHONE, date: '2026-11-24', time: '09:00' })).error_code).toBe('past')
    expect((await h.call('book_appointment', { service_id: 'noc', attendee_name: 'Late Caller', contact: PHONE, date: '2026-11-26', time: '16:00' })).error_code).toBe('outside_hours')
  })

  it('next_available skips the rest of today that has passed', async () => {
    const r = await createHarness().call('list_slots', { when: 'next_available' })
    expect(r.slots[0]).toMatchObject({ date: '2026-11-24', time: '12:30' })
  })
})

describe('facts: grounded answers only', () => {
  it('e-wallet deposit machine: answered in both languages from the fact base', async () => {
    const h = createHarness()
    const en = await h.call('lookup_fact', { question: 'Where is the e-wallet deposit machine?' })
    expect(en).toMatchObject({ ok: true, found: true })
    expect(en.answer.en).toMatch(/24-hour e-wallet deposit machine in the lobby of the DSO HQ building/)
    const ar = await h.call('lookup_fact', { question: 'وين جهاز إيداع المحفظة' })
    expect(ar.found).toBe(true)
    expect(ar.answer.ar).toMatch(/مبنى مقر/)
    expect(await h.eventTypes()).toEqual(['fact_lookup', 'fact_lookup'])
  })

  it('bus routes: nothing in the fact base, so the agent is told not to guess', async () => {
    const h = createHarness()
    const r = await h.call('lookup_fact', { question: 'Which bus routes serve DSO?' })
    expect(r).toMatchObject({ ok: true, found: false })
    expect(r.answer).toBeUndefined()
    expect(r.instruction).toMatch(/do not know and do not guess/)
    const ev = (await h.stores.events.history()).find((e) => e.type === 'fact_lookup')!
    expect(ev.data.found).toBe(false)
  })

  it('also refuses other unseeded facts, in both languages', async () => {
    const h = createHarness()
    for (const q of ['Where can I pray near DSO?', 'What time does the mall close?', 'ما أرقام الحافلات؟', 'أين أقرب مستشفى؟']) {
      expect((await h.call('lookup_fact', { question: q })).found, q).toBe(false)
    }
  })
})
