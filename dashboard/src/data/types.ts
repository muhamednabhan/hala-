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
}
export const DEFAULT_FILTERS: Filters = { range: 'all', channel: 'all', language: 'all' };

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
}
