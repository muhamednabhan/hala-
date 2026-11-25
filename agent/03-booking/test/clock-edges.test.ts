import { describe, expect, it } from 'vitest'
import { createCalendar, createStores } from '../src'

/**
 * The robot is tested at 07:30 Dubai on a Wednesday: before opening, on a working day, and in UTC still the day before at
 * 03:30. These are the clock edges where a date bug would show up exactly during the take.
 */
const base = { serviceId: 'visa_renewal', attendeeName: 'Ahmed Test', contact: '0500000000', language: 'en' as const }
const at = (iso: string) => {
  const stores = createStores()
  return createCalendar({ bookings: stores.bookings, clock: { now: () => new Date(iso) } })
}

describe('Wednesday 25 Nov 2026, 07:30 Dubai (03:30 UTC): before opening on a working day', () => {
  const NOW = '2026-11-25T03:30:00Z'
  it('offers the whole of today, starting at 08:00', async () => {
    const slots = await at(NOW).freeSlots('2026-11-25')
    expect(slots).toHaveLength(14)
    expect(slots[0]!.time).toBe('08:00')
  })
  it('next available is today at 08:00, not tomorrow', async () => {
    expect((await at(NOW).nextAvailable('2026-11-25', 3))[0]).toMatchObject({ date: '2026-11-25', time: '08:00' })
  })
  it('books today 08:00, and refuses 07:30 (outside hours) and yesterday (past)', async () => {
    expect((await at(NOW).book({ ...base, date: '2026-11-25', time: '08:00' })).ok).toBe(true)
    expect(await at(NOW).book({ ...base, date: '2026-11-25', time: '07:30' })).toMatchObject({ ok: false, code: 'outside_hours' })
    expect(await at(NOW).book({ ...base, date: '2026-11-24', time: '10:00' })).toMatchObject({ ok: false, code: 'past' })
  })
})

describe('just after midnight in Dubai, still the previous day in UTC (Wed 25 Nov 02:30 Dubai = Tue 22:30 UTC)', () => {
  const NOW = '2026-11-24T22:30:00Z'
  it('"today" is Wednesday in Dubai: yesterday is past, today is fully open', async () => {
    expect(await at(NOW).book({ ...base, date: '2026-11-24', time: '14:30' })).toMatchObject({ ok: false, code: 'past' })
    expect((await at(NOW).freeSlots('2026-11-25'))[0]!.time).toBe('08:00')
    expect((await at(NOW).nextAvailable('2026-11-25', 1))[0]).toMatchObject({ date: '2026-11-25', time: '08:00' })
  })
})

describe('after closing and around the weekend', () => {
  it('Wed 15:20 Dubai: nothing left today, next available is Thursday 08:00', async () => {
    const cal = at('2026-11-25T11:20:00Z')
    expect(await cal.freeSlots('2026-11-25')).toEqual([])
    expect((await cal.nextAvailable('2026-11-25', 1))[0]).toMatchObject({ date: '2026-11-26', time: '08:00' })
  })
  it('Wed 14:20 Dubai: the 14:30 slot is still offered, and booking it works', async () => {
    const cal = at('2026-11-25T10:20:00Z')
    expect((await cal.freeSlots('2026-11-25')).map((s) => s.time)).toEqual(['14:30'])
    expect((await cal.book({ ...base, date: '2026-11-25', time: '14:30' })).ok).toBe(true)
  })
  it('Wed 14:30 on the dot: that slot has started, so it is gone', async () => {
    expect(await at('2026-11-25T10:30:00Z').freeSlots('2026-11-25')).toEqual([])
  })
  it('Friday after closing: the next slot is Monday 08:00 (Saturday and Sunday are closed)', async () => {
    const cal = at('2026-11-27T11:30:00Z') // Fri 15:30 Dubai
    expect((await cal.nextAvailable('2026-11-27', 1))[0]).toMatchObject({ date: '2026-11-30', time: '08:00' })
  })
})
