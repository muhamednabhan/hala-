import { createHmac, timingSafeEqual } from 'node:crypto'
import { dubaiInstant, dubaiParts, type Bilingual, type Booking, type Lang, type Service, type ServiceRequest } from '@hala/core'
import { deskFor, deskLabel, getService, teamFor } from '@hala/catalogue'
import { spokenDate, spokenTime } from './speech'

/**
 * The DSO Smart Pass: what the visitor keeps after the conversation. It is shown on the screen next to the robot, texted
 * to a linked phone, and opened from the QR as a mobile page. One shape feeds all three, so they can never disagree.
 *
 * Everything on it is demonstration data (desk, wait time, fee). The pass says so.
 */
export interface SmartPass {
  kind: 'appointment' | 'request'
  ref: string
  serviceId: string
  service: Bilingual
  /** First name only. The pass is shown on a public screen, so it never carries a contact or a full name. */
  holder: string
  /** Appointments: YYYY-MM-DD and HH:MM in Asia/Dubai. */
  date?: string
  time?: string
  dateLabel?: Bilingual
  timeLabel?: Bilingual
  /** Appointments are looked after at a desk. */
  desk?: { code: string; label: Bilingual }
  /** Tickets are followed up by a team. */
  team?: Bilingual
  /** What to bring. Ticked off on the mobile pass. */
  documents: Bilingual[]
  /** Tickets: the logged issue, short. */
  detail?: string
  status: 'confirmed' | 'cancelled' | 'logged'
  language: Lang
  demo: true
}

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? ''

export function passFromBooking(booking: Booking, services: Service[]): SmartPass | undefined {
  const service = getService(booking.serviceId, services)
  if (!service) return undefined
  const desk = deskFor(service)
  return {
    kind: 'appointment',
    ref: booking.ref,
    serviceId: service.id,
    service: service.name,
    holder: firstName(booking.attendeeName),
    date: booking.date,
    time: booking.time,
    dateLabel: spokenDate(booking.date),
    timeLabel: spokenTime(booking.time),
    ...(desk ? { desk: { code: desk.code, label: deskLabel(desk) } } : {}),
    documents: service.documents,
    status: booking.status === 'cancelled' ? 'cancelled' : 'confirmed',
    language: booking.language,
    demo: true
  }
}

export function passFromRequest(request: ServiceRequest, services: Service[]): SmartPass | undefined {
  const service = getService(request.serviceId, services)
  if (!service) return undefined
  const team = teamFor(service)
  return {
    kind: 'request',
    ref: request.ref,
    serviceId: service.id,
    service: service.name,
    holder: firstName(request.callerName),
    ...(team ? { team } : {}),
    documents: [],
    detail: request.details.slice(0, 160),
    status: 'logged',
    language: request.language,
    demo: true
  }
}

// ---------------------------------------------------------------- the link in the QR

/**
 * Refs are sequential (HALA-1001, 1002 ...), so a bare /pass/HALA-1001 would let anyone browse other people's passes.
 * The QR carries a short signature of the ref made with the server's secret; the page and its API refuse without it.
 */
export const passToken = (ref: string, secret: string): string => createHmac('sha256', secret).update(`pass:${ref}`).digest('base64url').slice(0, 12)

export function verifyPassToken(ref: string, token: string | null | undefined, secret: string | undefined): boolean {
  if (!secret || !token) return false
  const want = Buffer.from(passToken(ref, secret))
  const got = Buffer.from(token)
  return want.length === got.length && timingSafeEqual(want, got)
}

export const passUrl = (base: string, ref: string, secret: string): string =>
  `${base.replace(/\/$/, '')}/pass/${encodeURIComponent(ref)}?k=${passToken(ref, secret)}`

// ---------------------------------------------------------------- queue (demo)

export interface QueueStatus {
  /** cancelled and past need no queue; upcoming is another day or hours away; today and now are on the day. */
  state: 'upcoming' | 'today' | 'now' | 'past' | 'cancelled'
  /** People ahead at this desk. A real count of the day's earlier bookings when the visit is today, a demo figure otherwise. */
  ahead: number
  /** Demo estimate: four minutes per person ahead, at least four. */
  waitMinutes: number
  /** Minutes until the slot starts, when it has not started. */
  startsInMinutes?: number
  label: Bilingual
  demo: true
}

const MINUTES_PER_PERSON = 4

/** Stable small hash so the demo figure is the same for a ref within a minute and drifts over time like a real queue. */
const drift = (ref: string, now: Date) => {
  let h = 0
  for (const c of ref) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return (h + Math.floor(now.getTime() / 90_000)) % 4
}

/**
 * Live queue for a booked visit. `sameDayTimes` are the confirmed slots on that date (from the calendar); only those
 * earlier than this one that have not already passed count as people ahead.
 */
export function queueStatus(input: { pass: SmartPass; now: Date; sameDayTimes?: string[] }): QueueStatus | undefined {
  const { pass, now } = input
  if (pass.kind !== 'appointment' || !pass.date || !pass.time) return undefined
  const wait = (ahead: number) => Math.max(1, ahead) * MINUTES_PER_PERSON
  if (pass.status === 'cancelled') return { state: 'cancelled', ahead: 0, waitMinutes: 0, label: { en: 'This appointment was cancelled', ar: 'تم إلغاء هذا الموعد' }, demo: true }

  const start = dubaiInstant(pass.date, pass.time)
  if (!start) return undefined
  const minutes = Math.round((start.getTime() - now.getTime()) / 60_000)
  if (minutes < -30) return { state: 'past', ahead: 0, waitMinutes: 0, label: { en: 'This appointment has passed', ar: 'انتهى وقت هذا الموعد' }, demo: true }

  const today = dubaiParts(now).date === pass.date
  if (today) {
    const cutoff = dubaiParts(new Date(now.getTime() - 30 * 60_000)).time
    const ahead = (input.sameDayTimes ?? []).filter((t) => t < pass.time! && t >= cutoff).length
    const w = wait(ahead)
    return {
      state: minutes <= 10 ? 'now' : 'today', ahead, waitMinutes: w, ...(minutes > 0 ? { startsInMinutes: minutes } : {}),
      label: ahead === 0
        ? { en: 'You are next. Estimated wait: about 4 minutes', ar: 'أنت التالي. الانتظار المتوقع: حوالي 4 دقائق' }
        : { en: `${ahead} ahead of you. Estimated wait: about ${w} minutes`, ar: `أمامك ${ahead}. الانتظار المتوقع: حوالي ${w} دقيقة` },
      demo: true
    }
  }
  // Another day: show what the desk looks like right now, so the page is never empty.
  const ahead = drift(pass.ref, now)
  const w = wait(ahead)
  return {
    state: 'upcoming', ahead, waitMinutes: w, startsInMinutes: Math.max(0, minutes),
    label: { en: `Desk queue right now: about ${w} minutes`, ar: `الانتظار عند المكتب الآن: حوالي ${w} دقيقة` },
    demo: true
  }
}

// ---------------------------------------------------------------- calendar file

const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const icsStamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')

/** RFC 5545 asks for lines of at most 75 octets, continued with a leading space. */
const fold = (line: string): string => {
  const enc = new TextEncoder()
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  for (const ch of line) {
    if (enc.encode(cur + ch).length > (out.length === 0 ? 75 : 74)) { out.push(cur); cur = ch } else cur += ch
  }
  out.push(cur)
  return out.join('\r\n ')
}

/** An .ics calendar entry for an appointment pass, or undefined for a ticket or an invalid slot. Times are UTC (Dubai is +04:00, no DST). */
export function buildIcs(pass: SmartPass, o: { now: Date; url?: string; slotMinutes?: number }): string | undefined {
  if (pass.kind !== 'appointment' || !pass.date || !pass.time) return undefined
  const start = dubaiInstant(pass.date, pass.time)
  if (!start) return undefined
  const end = new Date(start.getTime() + (o.slotMinutes ?? 30) * 60_000)
  const docs = pass.documents.map((d) => `- ${d.en}`).join('\n')
  const description = [
    `Reference ${pass.ref}`,
    pass.desk ? pass.desk.label.en : '',
    docs ? `Bring:\n${docs}` : '',
    o.url ? `Pass: ${o.url}` : '',
    'Demo booking: all details are demonstration data.'
  ].filter(Boolean).join('\n')
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//HALA//DSO Smart Pass//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${pass.ref}@hala.dso`,
    `DTSTAMP:${icsStamp(o.now)}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsEscape(`DSO HALA appointment: ${pass.service.en}`)}`,
    `LOCATION:${icsEscape('HALA Reception, Dubai Silicon Oasis headquarters')}`,
    `DESCRIPTION:${icsEscape(description)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Your DSO appointment is in one hour', 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}

// ---------------------------------------------------------------- the text sent to the phone app

/** The message HALA texts to a linked phone. The link is the mobile pass. Plain text: the app shows it as typed. */
export function passMessage(pass: SmartPass, url: string, lang: Lang = pass.language): string {
  const name = pass.service[lang]
  if (pass.kind === 'request') {
    return lang === 'ar'
      ? `تم تسجيل طلبك: ${name}. الرقم المرجعي ${pass.ref}. سيتابع الفريق معك. افتح التصريح: ${url} (بيانات تجريبية)`
      : `Your request is logged: ${name}. Reference ${pass.ref}. The DSO team will follow up. Open your pass: ${url} (demo data)`
  }
  const when = `${pass.dateLabel?.[lang] ?? pass.date}, ${pass.timeLabel?.[lang] ?? pass.time}`
  const desk = pass.desk ? `، ${pass.desk.label.ar}` : ''
  return lang === 'ar'
    ? `تصريح هلا الذكي من واحة دبي للسيليكون: ${name}، ${when}${desk}. الرقم المرجعي ${pass.ref}. افتح التصريح لحالة الطابور وقائمة الوثائق والتقويم: ${url} (بيانات تجريبية)`
    : `Your DSO Smart Pass: ${name}, ${when}${pass.desk ? `, ${pass.desk.label.en}` : ''}. Reference ${pass.ref}. Open it for the queue, your documents checklist and the calendar: ${url} (demo data)`
}
