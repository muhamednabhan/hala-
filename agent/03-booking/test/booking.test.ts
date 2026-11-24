import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HalaEvent } from '@hala/core'
import { createCalendar, createStores, ALL_SLOT_TIMES } from '../src'

// Tuesday 24 Nov 2026, 12:00 Dubai (08:00 UTC)
const NOW = new Date('2026-11-24T08:00:00Z')
const clock = { now: () => NOW }

const base = { serviceId: 'visa_renewal', attendeeName: 'Ahmed Test', contact: '0500000000', language: 'en' as const }

function setup(capacity = 1) {
  const stores = createStores()
  return { stores, cal: createCalendar({ bookings: stores.bookings, clock, capacity }) }
}

describe('slot grid', () => {
  it('has 14 half-hour slots from 08:00 to 14:30', () => {
    expect(ALL_SLOT_TIMES).toHaveLength(14)
    expect(ALL_SLOT_TIMES[0]).toBe('08:00')
    expect(ALL_SLOT_TIMES.at(-1)).toBe('14:30')
  })
  it('only offers future slots today', async () => {
    const { cal } = setup()
    const slots = await cal.freeSlots('2026-11-24') // now is 12:00
    expect(slots.map((s) => s.time)[0]).toBe('12:30')
  })
  it('offers nothing on a weekend and skips to Monday', async () => {
    const { cal } = setup()
    expect(await cal.freeSlots('2026-11-28')).toEqual([])
    const next = await cal.nextAvailable('2026-11-28', 2)
    expect(next[0]).toMatchObject({ date: '2026-11-30', time: '08:00' })
  })
})

describe('booking', () => {
  it('books a slot and assigns a readable reference', async () => {
    const { cal } = setup()
    const r = await cal.book({ ...base, date: '2026-11-26', time: '10:30' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value.booking.ref).toBe('HALA-1001')
  })
  it('rejects double booking and offers alternatives', async () => {
    const { cal } = setup()
    await cal.book({ ...base, date: '2026-11-26', time: '10:30' })
    const r = await cal.book({ ...base, attendeeName: 'Someone Else', date: '2026-11-26', time: '10:30' })
    expect(r).toMatchObject({ ok: false, code: 'taken' })
    if (!r.ok) {
      expect(r.alternatives.length).toBe(3)
      expect(r.alternatives.some((s) => s.date === '2026-11-26' && s.time === '10:30')).toBe(false)
    }
  })
  it('allows parallel bookings when capacity is above one', async () => {
    const { cal } = setup(2)
    await cal.book({ ...base, date: '2026-11-26', time: '10:30' })
    expect((await cal.book({ ...base, attendeeName: 'Other', date: '2026-11-26', time: '10:30' })).ok).toBe(true)
  })
  it.each([
    ['2026-11-21', '10:00', 'weekend'],
    ['2026-11-22', '10:00', 'weekend'],
    ['2026-11-26', '07:30', 'outside_hours'],
    ['2026-11-26', '15:00', 'outside_hours'],
    ['2026-11-26', '10:15', 'not_on_slot_grid'],
    ['2026-11-23', '10:00', 'past'],
    ['2026-11-24', '09:00', 'past'],
    ['2026-02-31', '10:00', 'invalid_date'],
    ['2026-11-26', '10:xx', 'invalid_time']
  ])('rejects %s %s as %s', async (date, time, code) => {
    const { cal } = setup()
    expect(await cal.book({ ...base, date, time })).toMatchObject({ ok: false, code })
  })
  it('requires a name and a contact', async () => {
    const { cal } = setup()
    expect(await cal.book({ ...base, attendeeName: '  ', date: '2026-11-26', time: '10:30' })).toMatchObject({ ok: false, code: 'invalid_input' })
    expect(await cal.book({ ...base, contact: '', date: '2026-11-26', time: '10:30' })).toMatchObject({ ok: false, code: 'invalid_input' })
  })
  it('is idempotent: a retried tool call returns the same booking', async () => {
    const { cal, stores } = setup()
    const input = { ...base, conversationId: 'conv_1', date: '2026-11-26', time: '10:30' }
    const a = await cal.book(input)
    const b = await cal.book(input)
    expect(a.ok && b.ok && a.value.booking.ref === b.value.booking.ref && b.value.duplicate).toBe(true)
    expect(await stores.bookings.list()).toHaveLength(1)
  })
  it('two simultaneous calls cannot both take the last slot', async () => {
    const { cal, stores } = setup()
    const [a, b] = await Promise.all([
      cal.book({ ...base, attendeeName: 'A One', date: '2026-11-26', time: '09:00' }),
      cal.book({ ...base, attendeeName: 'B Two', date: '2026-11-26', time: '09:00' })
    ])
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1)
    expect(await stores.bookings.list()).toHaveLength(1)
  })
})

describe('reschedule and cancel', () => {
  it('moves a booking and frees the old slot', async () => {
    const { cal } = setup()
    const r = await cal.book({ ...base, date: '2026-11-26', time: '10:30' })
    if (!r.ok) throw new Error('setup')
    const moved = await cal.reschedule(r.value.booking.ref, '2026-11-27', '09:00')
    expect(moved.ok && moved.value.booking.date).toBe('2026-11-27')
    expect((await cal.freeSlots('2026-11-26')).some((s) => s.time === '10:30')).toBe(true)
  })
  it('can reschedule into its own slot neighbour but not onto a taken one', async () => {
    const { cal } = setup()
    const a = await cal.book({ ...base, date: '2026-11-26', time: '10:30' })
    await cal.book({ ...base, attendeeName: 'Other', date: '2026-11-26', time: '11:00' })
    if (!a.ok) throw new Error('setup')
    expect(await cal.reschedule(a.value.booking.ref, '2026-11-26', '11:00')).toMatchObject({ ok: false, code: 'taken' })
    expect((await cal.reschedule(a.value.booking.ref, '2026-11-26', '10:30')).ok).toBe(true)
  })
  it('reports unknown references', async () => {
    const { cal } = setup()
    expect(await cal.reschedule('HALA-9999', '2026-11-26', '10:30')).toMatchObject({ ok: false, code: 'not_found' })
    expect(await cal.cancel('HALA-9999')).toMatchObject({ ok: false, code: 'not_found' })
  })
  it('cancels, frees the slot, and cancelling twice is harmless', async () => {
    const { cal } = setup()
    const r = await cal.book({ ...base, date: '2026-11-26', time: '10:30' })
    if (!r.ok) throw new Error('setup')
    const c1 = await cal.cancel(r.value.booking.ref)
    const c2 = await cal.cancel(r.value.booking.ref)
    expect(c1.ok && !c1.value.alreadyCancelled).toBe(true)
    expect(c2.ok && c2.value.alreadyCancelled).toBe(true)
    expect((await cal.freeSlots('2026-11-26')).some((s) => s.time === '10:30')).toBe(true)
    expect(await cal.reschedule(r.value.booking.ref, '2026-11-27', '09:00')).toMatchObject({ ok: false, code: 'already_cancelled' })
  })
})

describe('stores', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'hala-')) })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('persists to a JSON file and keeps references unique after a restart', async () => {
    const file = join(dir, 'store.json')
    const s1 = createStores({ file })
    await createCalendar({ bookings: s1.bookings, clock }).book({ ...base, date: '2026-11-26', time: '10:30' })
    const s2 = createStores({ file })
    expect(await s2.bookings.list()).toHaveLength(1)
    const next = await createCalendar({ bookings: s2.bookings, clock }).book({ ...base, attendeeName: 'Next', date: '2026-11-26', time: '11:00' })
    expect(next.ok && next.value.booking.ref).toBe('HALA-1002')
  })
  it('survives a corrupt file', () => {
    const file = join(dir, 'store.json')
    writeFileSync(file, '{ not json')
    expect(() => createStores({ file })).not.toThrow()
  })
  it('keeps returned data isolated from internal state', async () => {
    const s = createStores()
    await createCalendar({ bookings: s.bookings, clock }).book({ ...base, date: '2026-11-26', time: '10:30' })
    const [b] = await s.bookings.list()
    b!.attendeeName = 'Hacked'
    expect((await s.bookings.list())[0]!.attendeeName).toBe('Ahmed Test')
  })
  it('streams events to subscribers, filtered by conversation, and unsubscribes', async () => {
    const s = createStores()
    const all: HalaEvent[] = []
    const one: HalaEvent[] = []
    const offAll = s.events.subscribe((e) => all.push(e))
    s.events.subscribe((e) => one.push(e), 'c1')
    const ev = (conversationId: string): HalaEvent => ({ id: conversationId, ts: 't', conversationId, type: 'fact_lookup', data: {} })
    s.events.publish(ev('c1')); s.events.publish(ev('c2'))
    offAll()
    s.events.publish(ev('c1'))
    expect(all).toHaveLength(2)
    expect(one).toHaveLength(2)
    expect(await s.events.history('c2')).toHaveLength(1)
    expect(await s.events.history()).toHaveLength(3)
  })
  it('a throwing listener cannot break publishing', () => {
    const s = createStores()
    s.events.subscribe(() => { throw new Error('boom') })
    expect(() => s.events.publish({ id: '1', ts: 't', type: 'fact_lookup', data: {} })).not.toThrow()
  })
})
