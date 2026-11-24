import { describe, expect, it } from 'vitest'
import { createStores } from '@hala/booking'
import { SERVICES } from '@hala/catalogue'
import { createToolApi } from '../src'

const clock = { now: () => new Date('2026-11-24T08:00:00Z') }
const headers = { 'x-hala-secret': 's' }
const setup = () => {
  const stores = createStores()
  const api = createToolApi({ stores, clock, secret: 's' })
  const call = async (tool: string, body: Record<string, unknown>) => (await api.handle(tool, headers, { conversation_id: 'c1', ...body })).body as Record<string, any>
  return { stores, call }
}

describe('knowledge-base content reaches the agent through tool results', () => {
  it('gives fee and time exactly as the knowledge base words them, with steps and voice summary', async () => {
    const r = await setup().call('find_service', { query: 'I need a new visa for a new hire' })
    const s = r.services[0]
    expect(s.id).toBe('visa_new')
    expect(s.demo_fee_text).toBe('AED 3,500 standard, AED 4,800 urgent')
    expect(s.demo_timeline_text).toBe('5 to 7 working days')
    expect(s.voice_summary.en).toMatch(/entry permit/)
    expect(s.process_steps.length).toBe(4)
    expect(s.eligibility).toMatch(/Establishment Card/)
  })
  it('carries the fee-dispute policy on the access card', async () => {
    const s = (await setup().call('find_service', { query: 'how do I get an access card' })).services[0]
    expect(s.policy_for_agent).toMatch(/DISPUTES the AED 200/)
    expect(s.policy_for_agent).toMatch(/do not promise a refund|do not argue and do not promise a refund/i)
    expect(s.policy_for_agent).toMatch(/30 days/)
  })
  it('licence types is an info service whose facts are in extra_facts, not bookable', async () => {
    const { call } = setup()
    const s = (await call('find_service', { query: 'what types of licence does DSO offer' })).services[0]
    expect(s.id).toBe('licence_types')
    expect(s.extra_facts.some((f: string) => /Service Licence/.test(f))).toBe(true)
    const b = await call('book_appointment', { service_id: 'licence_types', attendee_name: 'A B', contact: '0500000000', date: '2026-11-26', time: '10:30' })
    expect(b.error_code).toBe('wrong_fulfilment')
  })
  it('the in-person desk appointment can be booked', async () => {
    const r = await setup().call('book_appointment', { service_id: 'desk_resolution', attendee_name: 'Sara Test', contact: '0501234567', date: '2026-11-26', time: '09:00', language: 'ar' })
    expect(r.ok).toBe(true)
  })
  it('hand-over offers the phone line and the desk, but forbids promises', async () => {
    const r = await setup().call('handover_to_human', { reason: 'fee_dispute', summary: 'Disputes the AED 200 replacement fee', language: 'en' })
    expect(r.human_contact).toEqual({ phone: '600 59 55 57', hours: 'Monday to Friday, 8 AM to 3 PM Dubai time', email: 'hello@dso.ae' })
    expect(r.instruction).toMatch(/desk_resolution/)
    expect(r.instruction).toMatch(/Do not promise .* a waiver/)
  })
  it('marks an emergency maintenance ticket in its details', async () => {
    const { call, stores } = setup()
    const r = await call('log_request', { service_id: 'maintenance', caller_name: 'Sara Test', contact: '0501234567', details: 'Water leak in the ceiling', location: 'Palace Towers, unit 1204', urgency: 'emergency' })
    expect(r.ok).toBe(true)
    expect((await stores.requests.list())[0]!.details).toMatch(/^\[EMERGENCY\] Water leak/)
  })
  it('every service has the knowledge-base fields it should', () => {
    for (const s of SERVICES.filter((x) => x.fulfilment !== 'info' && x.id !== 'desk_resolution')) {
      expect(s.voiceSummary, `${s.id} voice summary`).toBeTruthy()
      expect(s.feeText, `${s.id} fee`).toBeTruthy()
      expect(s.timelineText, `${s.id} timeline`).toBeTruthy()
    }
  })
})
