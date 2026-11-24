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
  /** The sentence the agent can say to explain the service. From the DSO knowledge base. */
  voiceSummary?: Bilingual
  /** Who can apply / quota rules. English; the agent translates when speaking Arabic. */
  eligibility?: string
  /** Process steps in order. English; the agent translates when speaking Arabic. */
  steps?: string[]
  /** Fee as the knowledge base words it, e.g. "AED 3,500 standard / AED 4,800 urgent". DEMO value. */
  feeText?: string
  /** Processing time as the knowledge base words it, e.g. "5 to 7 working days". DEMO value. */
  timelineText?: string
  /** Dispute and edge-case policy the agent must follow for this service. */
  policy?: string
  /** Extra facts about the service (reference prices, options). */
  notes?: string[]
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
  /** Where the fact comes from. Brief, handover and the DSO knowledge base (v1.0) are accepted as verified. */
  source: 'brief' | 'handover' | 'kb' | 'dso-public'
}

// ---------------------------------------------------------------- robots

export type RobotDesired = 'running' | 'stopped'

/** What the robot-side bridge reports about itself on every sync. All optional: the bridge sends what it knows. */
export interface RobotState {
  phase?: 'starting' | 'idle' | 'connecting' | 'conversation' | 'stopping' | 'error'
  /** ROS 2 + aimdk_msgs loaded (false in simulation mode). */
  ros?: boolean
  simulation?: boolean
  speakerFocus?: boolean
  /** Which microphone stream is being used (1 built-in, 2 external, 0 none yet). */
  micStream?: number
  /** Microphone messages received since the bridge started, and seconds since the last one. */
  micMessages?: number
  micAgeSecs?: number | null
  conversationId?: string
  agentOutputFormat?: string
  agentInputFormat?: string
  lastError?: string
}

export interface Robot {
  id: string
  name: string
  notes?: string
  /** For reference only (the robot is never contacted directly by the website). */
  ip?: string
  /** ROS_DOMAIN_ID to export before starting the bridge, if the robot uses one. */
  domainId?: number
  /** Where the AimDK workspace is, so the setup command can source it. */
  aimdkPath?: string
  /** 0 = whichever stream speaks first, 1 = built-in microphone, 2 = external. */
  micStream: 0 | 1 | 2
  /** Mute the microphone while the robot speaks (use if it hears itself). */
  halfDuplex: boolean
  /** Speaker volume 0-100, applied when the bridge connects. */
  volume?: number
  /** SHA-256 of the pairing token. The token itself is shown once and never stored. */
  tokenHash: string
  desired: RobotDesired
  lastSeen?: string
  bridgeVersion?: string
  state?: RobotState
  createdAt: string
}

export type RobotCommandType = 'speaker_test' | 'say' | 'set_volume' | 'reconnect'

export interface RobotCommand {
  id: string
  robotId: string
  type: RobotCommandType
  payload: Record<string, unknown>
  status: 'pending' | 'done' | 'failed'
  result?: string
  createdAt: string
  doneAt?: string
}

export interface RobotLog {
  id: string
  robotId: string
  ts: string
  /** user and agent are transcript lines from the conversation; the rest are bridge messages. */
  level: 'info' | 'warn' | 'error' | 'user' | 'agent'
  message: string
}
