// Row types mirror schema.sql (snake_case, same names) so mock and Supabase share one shape.

export type Channel = 'robot' | 'phone' | 'web';
export type Language = 'en' | 'ar' | 'mixed';
export type RequestStatus = 'solved' | 'open' | 'needs_followup' | 'unsolved';
export type Resolution =
  | 'booked'
  | 'rescheduled'
  | 'cancelled'
  | 'info_given'
  | 'task_created'
  | 'handed_over'
  | 'unanswered';
export type UnsolvedReason = 'out_of_scope' | 'fee_dispute' | 'unknown_answer' | 'caller_hung_up' | 'other';
export type EventType =
  | 'call_started'
  | 'intent_detected'
  | 'docs_listed'
  | 'booking_created'
  | 'booking_rescheduled'
  | 'booking_cancelled'
  | 'handover'
  | 'followup_sent'
  | 'callback_scheduled'
  | 'complaint_logged'
  | 'maintenance_logged'
  | 'kb_miss'
  | 'error'
  | 'feedback';

/** ElevenLabs transcript format (bridge + post-call webhook). `text` accepted for older rows. */
export interface TranscriptTurn {
  role: 'agent' | 'user';
  message?: string | null;
  text?: string;
  time_in_call_secs?: number;
}

export interface Call {
  id: string;
  agent_id: string | null;
  channel: Channel;
  started_at: string;
  ended_at: string | null;
  duration_secs: number | null;
  language: Language | null;
  caller_type: string | null;
  status: string;
  call_successful: string | null;
  sentiment: string | null;
  summary: string | null;
  transcript: TranscriptTurn[] | null;
  /** ElevenLabs post-call analysis (live mode): evaluation criteria + data collection. */
  analysis?: CallAnalysis | null;
  /** Caller's name, only if they gave it in this call. */
  caller_name?: string | null;
  /** The number this call came from or went to (phone line). */
  phone?: string | null;
  /** 'outbound' = HALA called the person (reminder / callback). */
  direction?: 'inbound' | 'outbound';
  /** Why HALA called, for outbound calls, e.g. "Appointment reminder". */
  outbound_reason?: string | null;
  /** How the caller felt, only from a real source (ElevenLabs sentiment, or HALA flagging an upset caller). */
  mood?: CallMood | null;
}

export interface CallMood {
  label: 'positive' | 'neutral' | 'negative';
  source: 'agent' | 'elevenlabs' | 'hala' | 'demo';
  detail: string;
  /** The raw score when the source gives one (e.g. hala_events.average_sentiment). */
  score?: number | null;
}

export interface CallAnalysis {
  evaluation: { id: string; name: string; result: 'success' | 'failure' | 'unknown'; rationale?: string }[];
  data: Record<string, string>;
  title?: string | null;
}

export interface CallEvent {
  id: number;
  call_id: string | null;
  created_at: string;
  type: EventType | string;
  service: string | null;
  payload: { request_id?: string; detail?: string; [k: string]: unknown };
}

export interface Booking {
  id: string;
  call_id: string | null;
  service: string;
  customer_name: string;
  contact: string;
  company: string | null;
  slot_at: string;
  status: 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';
  documents: string[];
  demo_fee_aed: number | null;
  created_at: string;
  updated_at: string;
  /** Latest reminder call HALA made for this booking (live mode, hala_phone_rings). */
  reminder?: { status: string; at: string } | null;
}

export interface Task {
  id: string;
  call_id: string | null;
  kind: string;
  service: string | null;
  priority: string;
  status: 'open' | 'in_progress' | 'done';
  title: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Handover {
  id: string;
  call_id: string | null;
  reason: string;
  service: string | null;
  status: 'waiting' | 'picked_up' | 'resolved';
  context: string | null;
  created_at: string;
  /** Collected by HALA during the call, when the caller gave them. */
  caller_name?: string | null;
  contact?: string | null;
  language?: string | null;
}

/** Everything known about one caller, for the handover alert. */
export interface CallerHistory {
  name: string | null;
  contact: string | null;
  calls: { id: string; at: string; channel: string; summary: string | null }[];
  items: {
    at: string;
    kind: 'request' | 'booking' | 'handover';
    title: string;
    detail: string | null;
    status: RequestStatus | null;
    call_id: string | null;
    complaint: boolean;
  }[];
}

/** A handover with what staff need to take over the call. */
export interface HandoverAlert {
  handover: Handover;
  call: Call | null;
  history: CallerHistory;
}

export interface ServiceRequest {
  id: string;
  call_id: string | null;
  contact: string | null;
  service: string;
  question: string | null;
  language: string | null;
  status: RequestStatus;
  resolution: Resolution | null;
  unsolved_reason: UnsolvedReason | null;
  assigned_to: string | null;
  note: string | null;
  created_at: string;
  updated_at: string;
  /** Set when the same case spans several calls (e.g. booked in one call, cancelled in a follow-up call). */
  thread?: RequestThread | null;
}

export interface RequestThread {
  /** What ties the calls together, e.g. the booking reference HALA-1004. */
  key: string;
  /** Every call that touched this case, oldest first. */
  calls: string[];
  steps: { at: string; label: string; call_id: string | null }[];
}

export interface KnowledgeGap {
  id: string;
  question: string;
  service: string | null;
  language: string | null;
  times_asked: number;
  first_asked_at: string;
  last_asked_at: string;
  status: 'waiting' | 'answered' | 'out_of_scope';
  answer_en: string | null;
  answer_ar: string | null;
  answered_by: string | null;
  answered_at: string | null;
  times_used: number;
}

export interface Feedback {
  id: string;
  call_id: string | null;
  rating: number;
  comment: string | null;
  created_at: string;
}

/** Everything the dashboard knows, one array per table. */
export interface Db {
  calls: Call[];
  requests: ServiceRequest[];
  events: CallEvent[];
  bookings: Booking[];
  tasks: Task[];
  handovers: Handover[];
  knowledge_gaps: KnowledgeGap[];
  feedback: Feedback[];
}

// ---- Global filter bar ----
export type DateRange = 'today' | '7d' | 'all';
export interface Filters {
  range: DateRange;
  channel: 'all' | Channel;
  language: 'all' | 'en' | 'ar';
  /** Leave out the team's smoke tests ("t", "smoke-*", "Smoke Test" bookings…). */
  hideTests: boolean;
}
export const DEFAULT_FILTERS: Filters = { range: 'all', channel: 'all', language: 'all', hideTests: true };

// ---- Derived shapes the widgets consume ----
export interface Kpis {
  totalCalls: number;
  callsToday: number;
  totalRequests: number;
  requestsPerCall: number;
  status: Record<RequestStatus, number>;
  resolutionRate: number; // 0..1
  callsWithAction: number;
  bookingsMade: number;
  bookingsRescheduled: number;
  bookingsCancelled: number;
  waitingHandovers: number;
  gapsWaiting: number;
  avgDurationSecs: number | null;
  avgRating: number | null;
  ratingCount: number;
  languageSplit: Record<Language, number>;
}

export interface FeedItem {
  id: number;
  created_at: string;
  type: string;
  service: string | null;
  call_id: string | null;
  language: string | null;
  status: RequestStatus;
  detail: string;
}

export interface CallDetail {
  call: Call;
  requests: ServiceRequest[];
  events: CallEvent[];
  bookings: Booking[];
  handovers: Handover[];
  feedback: Feedback[];
}

export type InsightTone = 'critical' | 'warning' | 'positive' | 'info';
export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  detail: string;
  metric?: string;
  quote?: string;
  /** Where to see the items behind this finding. */
  to?: { page: 'requests' | 'teach' | 'handovers' | 'conversations'; status?: RequestStatus | 'all'; service?: string; tab?: string };
}

export interface ConversationRow {
  id: string;
  started_at: string;
  channel: string;
  language: string | null;
  status: string;
  duration_secs: number | null;
  summary: string | null;
  turnCount: number;
  services: string[];
  statuses: RequestStatus[];
  rating: number | null;
  snippet: string;
  caller_name?: string | null;
  direction?: 'inbound' | 'outbound';
  outbound_reason?: string | null;
}

/** One line of the connection status shown in the header (live mode). */
export interface HealthItem {
  label: string;
  ok: boolean;
  detail: string;
}
