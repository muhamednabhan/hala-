import { dubaiInstant, dubaiParts, to12h, type Bilingual } from '@hala/core'

const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
const EN_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']
const EN_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "Thursday, 26 November" and "الخميس ٢٦ نوفمبر" ready to be spoken. */
export function spokenDate(date: string): Bilingual & { weekday: string } {
  const instant = dubaiInstant(date, '12:00')
  if (!instant) return { en: date, ar: date, weekday: '' }
  const { weekday } = dubaiParts(instant)
  const [, m, d] = date.split('-').map(Number) as [number, number, number]
  return {
    en: `${EN_WEEKDAYS[weekday]}, ${d} ${EN_MONTHS[m - 1]}`,
    ar: `${AR_WEEKDAYS[weekday]} ${d} ${AR_MONTHS[m - 1]}`,
    weekday: EN_WEEKDAYS[weekday]!
  }
}

/** "10:30 AM" and "10:30 صباحاً". */
export function spokenTime(time: string): Bilingual {
  const en = to12h(time)
  const hour = Number(time.slice(0, 2))
  const part = hour < 12 ? 'صباحاً' : 'مساءً'
  return { en, ar: `${en.replace(/ (AM|PM)$/, '')} ${part}` }
}

/** "HALA-1001" -> "1 0 0 1" so it is read digit by digit. */
export const spokenRef = (ref: string): string => (/(\d+)$/.exec(ref)?.[1] ?? ref).split('').join(' ')

/** Accept "HALA-1001", "hala 1001", "1001", "wan zero zero one" is out of scope. Returns canonical ref. */
export function normalizeRef(input: string, prefix: 'HALA' | 'REQ' = 'HALA'): string | undefined {
  const m = /(\d{3,6})\s*$/.exec(input.replace(/[\s-]+/g, ''))
  return m ? `${prefix}-${m[1]}` : undefined
}

/** Last 4 digits only, for event feeds that anybody on the team can see. */
export function maskContact(contact: string): string {
  const digits = contact.replace(/\D/g, '')
  if (contact.includes('@')) return `${contact.slice(0, 1)}***@${contact.split('@')[1] ?? ''}`
  return digits.length >= 4 ? `***${digits.slice(-4)}` : '***'
}

/** Trim, collapse whitespace, cap length. Defence against pasted walls of text. */
export const clean = (value: unknown, max = 200): string =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : ''
