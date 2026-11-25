import { SERVICES } from '@hala/catalogue'
import { to12h, type HalaEvent } from '@hala/core'

const serviceName = (id: unknown) => SERVICES.find((s) => s.id === id)?.name

const REASONS: Record<string, string> = {
  fee_dispute: 'Fee dispute',
  legal_question: 'Legal question',
  upset_caller: 'Upset caller',
  out_of_scope: 'Out of scope',
  unknown_answer: "Agent didn't know",
  caller_requested: 'Caller asked for a person',
  emergency: 'Emergency',
  other: 'Other'
}

const day = (date: unknown) =>
  typeof date === 'string'
    ? new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    : ''
const when = (d: Record<string, unknown>) => (d.date && d.time ? `${day(d.date)} · ${to12h(String(d.time))}` : '')
const time = (ts: string) => new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Asia/Dubai' })

interface View { tone: 'ok' | 'info' | 'warn' | 'bad' | 'quiet'; title: string; detail?: string; ref?: string }

function view(e: HalaEvent): View {
  const d = e.data
  const svc = serviceName(d.service)
  switch (e.type) {
    case 'service_matched': {
      const first = Array.isArray(d.services) ? serviceName(d.services[0]) : undefined
      if (!d.found) return { tone: 'warn', title: 'No matching service', detail: `"${String(d.query ?? '')}"` }
      return d.confidence === 'ambiguous'
        ? { tone: 'info', title: 'Several services could fit', detail: 'Asking the caller to choose' }
        : { tone: 'info', title: 'Service identified', detail: first?.en }
    }
    case 'slots_listed': return { tone: 'quiet', title: 'Checked the calendar', detail: d.date ? `${day(d.date)} · ${String(d.count)} free` : `${String(d.count)} openings` }
    case 'booking_created': return { tone: 'ok', title: d.duplicate ? 'Booking confirmed (repeat)' : 'Booking confirmed', ref: String(d.ref), detail: [svc?.en, when(d), String(d.attendee ?? ''), d.notes ? `Notes: ${String(d.notes)}` : ''].filter(Boolean).join(' · ') }
    case 'booking_rescheduled': return { tone: 'ok', title: 'Booking moved', ref: String(d.ref), detail: when(d) }
    case 'booking_cancelled': return { tone: 'info', title: 'Booking cancelled', ref: String(d.ref) }
    case 'request_logged': return { tone: 'ok', title: `${svc?.en ?? 'Request'} logged`, ref: String(d.ref), detail: String(d.summary ?? '') }
    case 'fact_lookup': return d.found ? { tone: 'info', title: 'Answered from verified facts' } : { tone: 'warn', title: 'Not in the fact base', detail: 'Said "I don\'t know" and offered a person' }
    case 'handover_requested': return { tone: 'warn', title: `Handed over · ${REASONS[String(d.reason)] ?? 'Other'}`, detail: String(d.summary ?? '') }
    case 'phone_requested': return { tone: 'info', title: 'Asked for a phone number', detail: 'QR code shown on the screen' }
    case 'pass_sent': return { tone: 'ok', title: 'Smart Pass sent to the phone', ref: String(d.ref ?? ''), detail: `to ${String(d.phone ?? '')}` }
    case 'handover_declined': return { tone: 'quiet', title: 'Kept off the staff queue', detail: 'Not something staff can act on (joke, test or impossible request)' }
    case 'conversation_scored': {
      const s = Number(d.average_sentiment ?? 0)
      const f = Number(d.average_frustration ?? 0)
      return { tone: s <= -0.3 || f >= 0.5 ? 'warn' : 'quiet', title: `Conversation scored · ${String(d.label ?? 'neutral')}`, detail: `Sentiment ${s.toFixed(1)} (−1 to 1) · frustration ${f.toFixed(1)} (0 to 1)` }
    }
    case 'phone_linked': return { tone: 'ok', title: 'Phone linked', detail: `${String(d.phone ?? '')} can now text HALA${d.via === 'spoken_code' ? ' (code read out loud)' : ''}` }
    case 'phone_text_sent': return { tone: 'info', title: 'Sent a text message', detail: `to ${String(d.phone ?? '')}` }
    case 'tool_error': return { tone: 'bad', title: 'A step did not work', detail: `Reason: ${String(d.code ?? d.message ?? 'unknown')}` }
  }
}

export function EventCard({ event }: { event: HalaEvent }) {
  const v = view(event)
  return (
    <li className={`event event-${v.tone}`}>
      <div className="event-head">
        <span className="event-title">{v.title}</span>
        <time dateTime={event.ts}>{time(event.ts)}</time>
      </div>
      {v.ref && <div className="event-ref" dir="ltr">{v.ref}</div>}
      {v.detail && <div className="event-detail" dir="auto">{v.detail}</div>}
    </li>
  )
}
