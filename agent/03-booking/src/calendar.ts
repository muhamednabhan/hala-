import {
  SlotConflictError, addDays, dubaiInstant, dubaiParts, systemClock, to12h, weekdayOf,
  type Booking, type BookingRepo, type Clock, type Lang
} from '@hala/core'

export const SLOT_MINUTES = 30
const OPEN_MINUTES = 8 * 60
const CLOSE_MINUTES = 15 * 60 // the day ends at 15:00; the last slot starts at 14:30

export type CalendarErrorCode =
  | 'invalid_input' | 'invalid_date' | 'invalid_time' | 'past' | 'weekend' | 'outside_hours'
  | 'not_on_slot_grid' | 'taken' | 'not_found' | 'already_cancelled'

export interface Slot { date: string; time: string; spoken: string }

export type CalendarResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: CalendarErrorCode; message: string; alternatives: Slot[] }

export interface BookInput {
  serviceId: string
  attendeeName: string
  bookedByName?: string
  contact: string
  date: string
  time: string
  language: Lang
  conversationId?: string
}

export interface CalendarOptions {
  bookings: BookingRepo
  clock?: Clock
  /** Parallel appointments allowed per slot. The demo has one desk, so 1. */
  capacity?: number
}

const slotTimes = (): string[] => {
  const out: string[] = []
  for (let m = OPEN_MINUTES; m < CLOSE_MINUTES; m += SLOT_MINUTES) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`)
  }
  return out
}
export const ALL_SLOT_TIMES = slotTimes()

const toSlot = (date: string, time: string): Slot => ({ date, time, spoken: to12h(time) })

/** Booking logic. The only place that decides what is a valid appointment. */
export function createCalendar({ bookings, clock = systemClock, capacity = 1 }: CalendarOptions) {
  // Serialise writes so two simultaneous tool calls cannot both take the last slot.
  let chain: Promise<unknown> = Promise.resolve()
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn)
    chain = run.catch(() => undefined)
    return run
  }

  const businessDay = (date: string) => { const w = weekdayOf(date); return w !== undefined && w >= 1 && w <= 5 }

  async function freeSlots(date: string, ignoreRef?: string): Promise<Slot[]> {
    if (!businessDay(date)) return []
    const taken = (await bookings.listByDate(date)).filter((b) => b.ref !== ignoreRef)
    const now = clock.now()
    return ALL_SLOT_TIMES.filter((t) => {
      const at = dubaiInstant(date, t)
      if (!at || at <= now) return false
      return taken.filter((b) => b.time === t).length < capacity
    }).map((t) => toSlot(date, t))
  }

  /** Next free slots on or after a date, across business days. */
  async function nextAvailable(fromDate: string, count = 3, ignoreRef?: string): Promise<Slot[]> {
    // Look at the next two weeks at once instead of one day per network trip.
    const days = Array.from({ length: 14 }, (_, i) => addDays(fromDate, i))
    const perDay = await Promise.all(days.map((d) => freeSlots(d, ignoreRef)))
    return perDay.flat().slice(0, count)
  }

  const fail = async (
    code: CalendarErrorCode, message: string, fromDate?: string, ignoreRef?: string
  ): Promise<{ ok: false; code: CalendarErrorCode; message: string; alternatives: Slot[] }> => ({
    ok: false, code, message,
    alternatives: fromDate ? await nextAvailable(fromDate, 3, ignoreRef) : []
  })

  /** Validate a requested slot. Returns an error result or undefined when it can be booked. */
  async function check(date: string, time: string, ignoreRef?: string, preloaded?: Booking[]) {
    const at = dubaiInstant(date, time)
    const today = dubaiParts(clock.now()).date
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || weekdayOf(date) === undefined) return fail('invalid_date', `"${date}" is not a valid date`, today)
    if (!/^\d{2}:\d{2}$/.test(time) || !at) return fail('invalid_time', `"${time}" is not a valid time`, date)
    if (!businessDay(date)) return fail('weekend', 'Appointments are only available Monday to Friday', date)
    const minutes = Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    if (minutes < OPEN_MINUTES || minutes >= CLOSE_MINUTES) return fail('outside_hours', 'Appointments run from 08:00 to 15:00, the last one starts at 14:30', date)
    if (minutes % SLOT_MINUTES !== 0) return fail('not_on_slot_grid', 'Appointments start on the hour or the half hour', date)
    if (at <= clock.now()) return fail('past', 'That time has already passed', today)
    const taken = (preloaded ?? (await bookings.listByDate(date))).filter((b) => b.ref !== ignoreRef && b.time === time)
    if (taken.length >= capacity) return fail('taken', 'That slot is already booked', date, ignoreRef)
    return undefined
  }

  return {
    freeSlots,
    nextAvailable,

    book: (input: BookInput) => exclusive(async (): Promise<CalendarResult<{ booking: Booking; duplicate: boolean }>> => {
      if (!input.attendeeName.trim() || input.contact.trim().length < 3 || !input.serviceId) {
        return fail('invalid_input', 'A name and a contact are required')
      }
      // A retried tool call (same conversation, service, slot, person) returns the original booking.
      const key = [input.conversationId ?? 'no-conv', input.serviceId, input.date, input.time, input.attendeeName.trim().toLowerCase()].join('|')
      // Three independent reads in ONE round trip (a far-away database makes each sequential read a full network trip).
      const [existing, onDate, last] = await Promise.all([
        bookings.findByKey(key), bookings.listByDate(input.date).catch(() => [] as Booking[]), bookings.maxSequence()
      ])
      if (existing && existing.status === 'confirmed') return { ok: true, value: { booking: existing, duplicate: true } }
      const problem = await check(input.date, input.time, undefined, onDate)
      if (problem) return problem
      const now = clock.now().toISOString()
      const booking: Booking = {
        ref: `HALA-${last + 1}`, serviceId: input.serviceId, attendeeName: input.attendeeName.trim(),
        bookedByName: input.bookedByName?.trim() || undefined, contact: input.contact.trim(),
        date: input.date, time: input.time, language: input.language, conversationId: input.conversationId,
        status: 'confirmed', createdAt: now, updatedAt: now
      }
      try { await Promise.all([bookings.create(booking), bookings.saveKey(key, booking.ref)]) } catch (e) {
        if (e instanceof SlotConflictError) return fail('taken', 'That slot is already booked', input.date)
        throw e
      }
      return { ok: true, value: { booking, duplicate: false } }
    }),

    reschedule: (ref: string, date: string, time: string) => exclusive(async (): Promise<CalendarResult<{ booking: Booking; previous: { date: string; time: string } }>> => {
      const existing = await bookings.get(ref)
      if (!existing) return fail('not_found', `No booking with reference ${ref}`)
      if (existing.status === 'cancelled') return fail('already_cancelled', `Booking ${ref} was cancelled`)
      const problem = await check(date, time, ref)
      if (problem) return problem
      const updated: Booking = { ...existing, date, time, updatedAt: clock.now().toISOString() }
      try { await bookings.update(updated) } catch (e) {
        if (e instanceof SlotConflictError) return fail('taken', 'That slot is already booked', date, ref)
        throw e
      }
      return { ok: true, value: { booking: updated, previous: { date: existing.date, time: existing.time } } }
    }),

    cancel: (ref: string) => exclusive(async (): Promise<CalendarResult<{ booking: Booking; alreadyCancelled: boolean }>> => {
      const existing = await bookings.get(ref)
      if (!existing) return fail('not_found', `No booking with reference ${ref}`)
      if (existing.status === 'cancelled') return { ok: true, value: { booking: existing, alreadyCancelled: true } }
      const updated: Booking = { ...existing, status: 'cancelled', updatedAt: clock.now().toISOString() }
      await bookings.update(updated)
      return { ok: true, value: { booking: updated, alreadyCancelled: false } }
    }),

    get: (ref: string) => bookings.get(ref)
  }
}

export type Calendar = ReturnType<typeof createCalendar>
