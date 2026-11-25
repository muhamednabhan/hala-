/**
 * Asia/Dubai time helpers. The UAE has no daylight saving, so the offset is a constant +04:00.
 * Keeping this tiny and dependency-free means the calendar can be unit-tested with a fake clock.
 */
const OFFSET_MS = 4 * 60 * 60 * 1000

export interface DubaiParts {
  date: string // YYYY-MM-DD
  time: string // HH:MM
  /** 0 = Sunday ... 6 = Saturday */
  weekday: number
}

const pad = (n: number) => String(n).padStart(2, '0')

export function dubaiParts(d: Date): DubaiParts {
  const shifted = new Date(d.getTime() + OFFSET_MS)
  return {
    date: `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
    weekday: shifted.getUTCDay()
  }
}

/** The instant a Dubai wall-clock date and time refers to. Returns undefined for invalid input. */
export function dubaiInstant(date: string, time: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return undefined
  const [y, m, d] = date.split('-').map(Number) as [number, number, number]
  const [hh, mm] = time.split(':').map(Number) as [number, number]
  if (m < 1 || m > 12 || d < 1 || d > 31 || hh > 23 || mm > 59) return undefined
  const utc = Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MS
  const instant = new Date(utc)
  // Reject rollovers such as 2026-02-31.
  return dubaiParts(instant).date === date ? instant : undefined
}

export function weekdayOf(date: string): number | undefined {
  const i = dubaiInstant(date, '12:00')
  return i ? dubaiParts(i).weekday : undefined
}

export function addDays(date: string, days: number): string {
  const i = dubaiInstant(date, '12:00')
  if (!i) throw new Error(`invalid date ${date}`)
  return dubaiParts(new Date(i.getTime() + days * 86_400_000)).date
}

export const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const

const WEEKDAY_ABBREVIATIONS: Record<string, string> = {
  mon: 'monday', tue: 'tuesday', tues: 'tuesday', wed: 'wednesday', thu: 'thursday', thur: 'thursday', thurs: 'thursday', fri: 'friday', sat: 'saturday', sun: 'sunday'
}

export interface ResolvedDate {
  date: string
  /** How the input was understood, for logging. */
  how: 'iso' | 'today' | 'tomorrow' | 'weekday'
}

/**
 * Turn what the agent passes ("2026-11-26", "tomorrow", "monday", "next tuesday") into a date.
 * The agent never does date arithmetic itself; the server owns the calendar.
 */
export function resolveWhen(input: string, now: Date): ResolvedDate | undefined {
  // A language model sends "Thursday." or "tomorrow morning" as readily as "thursday": none of that may end in "could not understand".
  const raw = input.trim().toLowerCase().replace(/[\s.,!?;:]+$/, '').replace(/\s+/g, ' ')
  const today = dubaiParts(now).date
  // A date, optionally followed by a time of day: "2026-11-26", "2026-11-26T10:00", "2026-11-26 10:00".
  const iso = /^(\d{4}-\d{2}-\d{2})(?:[t ]\d{1,2}:\d{2}.*)?$/.exec(raw)
  if (iso) return dubaiInstant(iso[1]!, '12:00') ? { date: iso[1]!, how: 'iso' } : undefined
  // The part of the day after the day word is not a different day: "tomorrow morning", "thursday afternoon", "monday at 10".
  // (A different DATE after a weekday, "thursday 3 december", is NOT guessed at: it stays unresolved and the agent asks.)
  const day = raw.replace(/\s+(?:in the |at |around )?(?:morning|afternoon|evening|noon)$/, '').replace(/\s+at \d.*$/, '')
  if (day === 'today') return { date: today, how: 'today' }
  if (day === 'tomorrow') return { date: addDays(today, 1), how: 'tomorrow' }
  const word = day.replace(/^(next|this|on)\s+/, '')
  const name = WEEKDAY_ABBREVIATIONS[word] ?? word
  const idx = WEEKDAY_NAMES.indexOf(name as (typeof WEEKDAY_NAMES)[number])
  if (idx < 0) return undefined
  const todayDow = dubaiParts(now).weekday
  let delta = (idx - todayDow + 7) % 7
  if (delta === 0 && day.startsWith('next')) delta = 7
  return { date: addDays(today, delta), how: 'weekday' }
}

/** "14:30" -> "2:30 PM" for display. */
export function to12h(time: string): string {
  const [h, m] = time.split(':').map(Number) as [number, number]
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${pad(m)} ${suffix}`
}

/** Accepts "10:00", "9:30", "10am", "2:30 pm", "14.30". Returns HH:MM or undefined. */
export function normalizeTime(input: string): string | undefined {
  // "10:30:00" (seconds), "10:30." (a full stop from the sentence) and "10 a.m." are all ordinary things for a model to send.
  const cleaned = input.replace(/\b([ap])\.\s?m\b\.?/gi, '$1m').replace(/[\s.,!?;]+$/, '')
  const m = /^\s*(\d{1,2})(?:[:.](\d{2})(?::\d{2})?)?\s*(am|pm)?\s*$/i.exec(cleaned)
  if (!m) return undefined
  let h = Number(m[1])
  const min = Number(m[2] ?? '0')
  const suffix = m[3]?.toLowerCase()
  if (suffix === 'pm' && h < 12) h += 12
  if (suffix === 'am' && h === 12) h = 0
  if (h > 23 || min > 59) return undefined
  return `${pad(h)}:${pad(min)}`
}
