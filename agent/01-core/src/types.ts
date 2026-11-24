/**
 * Shared domain types for the HALA concierge agent.
 *
 * Everything the other features (catalogue, booking, tools-api, provisioning, evals) and the
 * hand-over targets (Supabase adapter by teammate A, admin dashboard by teammate B) agree on.
 */

export type Lang = 'en' | 'ar'
export const LANGS: readonly Lang[] = ['en', 'ar'] as const

export interface Bilingual {
  en: string
  ar: string
}

// ---------------------------------------------------------------- services

export type ServiceAudience = 'company' | 'resident' | 'both'
export type ServiceCategory = 'visa' | 'company' | 'access' | 'property' | 'support' | 'info'

/**
 * How a service is fulfilled by the concierge:
 *  - appointment: the agent books a slot in the calendar
 *  - ticket:      the agent logs a request and gives a reference (maintenance, complaint)
 *  - info:        the agent only explains (no booking, no ticket)
 */
export type Fulfilment = 'appointment' | 'ticket' | 'info'

export interface Service {
  id: string
  name: Bilingual
  /** One spoken sentence explaining the service. */
  summary: Bilingual
  audience: ServiceAudience
  category: ServiceCategory
  fulfilment: Fulfilment
  /** Documents the caller needs to bring or upload. */
  documents: Bilingual[]
  /** DEMO value. `null` means "no fee in the demo catalogue". Never real DSO pricing. */
  demoFeeAed: number | null
  /** DEMO processing time in working days. `null` means not applicable. */
  demoDays: number | null
  /** Phrases and words that identify this service, per language. Matched whole-word. */
  keywords: { en: string[]; ar: string[] }
  /** The one clarifying question to ask when the caller is vague about this service. */
  clarify?: Bilingual
  /** Extra guidance for the agent (never read aloud verbatim). */
  agentNote?: string
}

// ---------------------------------------------------------------- bookings

export interface Booking {
  ref: string
  serviceId: string
  /** Who the appointment is for. */
  attendeeName: string
  /** The person talking to the agent, if different from the attendee. */
  bookedByName?: string
  contact: string
  /** YYYY-MM-DD, Asia/Dubai. */
  date: string
  /** HH:MM 24h, Asia/Dubai. */
  time: string
  language: Lang
  conversationId?: string
  status: 'confirmed' | 'cancelled'
  createdAt: string
  updatedAt: string
}

export interface ServiceRequest {
  ref: string
  serviceId: string
  callerName: string
  contact: string
  /** Free text from the caller (an issue description or complaint). */
  details: string
  /** Unit or office reference, demo data only. */
  location?: string
  language: Lang
  conversationId?: string
  createdAt: string
}

export const HANDOVER_REASONS = [
  'fee_dispute',
  'legal_question',
  'upset_caller',
  'out_of_scope',
  'unknown_answer',
  'caller_requested',
  'emergency',
  'other'
] as const
export type HandoverReason = (typeof HANDOVER_REASONS)[number]

export interface Handover {
  id: string
  reason: HandoverReason
  language: Lang
  /** One or two sentences written by the agent for the human who takes over. */
  summary: string
  callerName?: string
  contact?: string
  conversationId?: string
  status: 'open' | 'taken' | 'closed'
  createdAt: string
}

// ---------------------------------------------------------------- events

export const EVENT_TYPES = [
  'service_matched',
  'slots_listed',
  'booking_created',
  'booking_rescheduled',
  'booking_cancelled',
  'request_logged',
  'handover_requested',
  'fact_lookup',
  'phone_linked',
  'phone_text_sent',
  'tool_error'
] as const
export type HalaEventType = (typeof EVENT_TYPES)[number]

/** One thing that happened during a conversation. Feeds the live screen and the admin dashboard. */
export interface HalaEvent {
  id: string
  ts: string
  conversationId?: string
  type: HalaEventType
  /** Short, display-safe payload. No secrets. */
  data: Record<string, unknown>
}

// ---------------------------------------------------------------- facts

export interface Fact {
  id: string
  /** Words and phrases that should trigger this fact. */
  keywords: { en: string[]; ar: string[] }
  answer: Bilingual
  /** Where the fact comes from. Only brief/handover facts are allowed; others need a human to verify. */
  source: 'brief' | 'handover' | 'dso-public'
}
