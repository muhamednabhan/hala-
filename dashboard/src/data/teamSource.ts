// LIVE mode: reads the team's real agent data and maps it onto the dashboard's tables (Db).
//
//  1. Agent server (agent/06-talk-app, Briyan's branch), through the dashboard server (/api/proxy?t=hala)
//     GET /api/admin/bookings | requests | handovers | events   (admin key added by the proxy)
//     GET /api/events                                            (live server-sent events)
//     POST /api/tools/cancel_appointment | reschedule_appointment (tool secret added by the proxy)
//     These read Supabase hala_* tables (or the JSON file) on the server.
//  2. ElevenLabs, through the dashboard server (/api/proxy?t=el, which adds xi-api-key)
//     GET /v1/convai/conversations           list + summary + evaluation + data collection
//     GET /v1/convai/conversations/{id}      transcript
//     ElevenLabs is where conversation transcripts are stored; nothing is copied.
//
// Keys never reach the browser: vite.config.ts injects them into the proxied requests.

import { buildCallDetail, buildConversations, buildDayStats, buildFeed, buildHandoverAlert, buildLatestCall, computeKpis, filterDb } from './compute';
import { apiUrl, getJson } from './api';
import { computeInsights } from './insights';
import { HANDOVER_REASON_LABEL, getService } from './services';
import type { DataSource } from './source';
import type {
  Booking,
  Call,
  CallAnalysis,
  Db,
  Handover,
  HealthItem,
  KnowledgeGap,
  RequestStatus,
  Resolution,
  ServiceRequest,
  Task,
  UnsolvedReason,
} from './types';


// ---------------------------------------------------------------- team shapes (agent/01-core types.ts)

interface TBooking {
  ref: string;
  serviceId: string;
  attendeeName: string;
  bookedByName?: string;
  contact: string;
  date: string; // YYYY-MM-DD Dubai
  time: string; // HH:MM Dubai
  language: 'en' | 'ar';
  conversationId?: string;
  status: 'confirmed' | 'cancelled';
  createdAt: string;
  updatedAt: string;
}
interface TRequest {
  ref: string;
  serviceId: string;
  callerName: string;
  contact: string;
  details: string;
  location?: string;
  language: 'en' | 'ar';
  conversationId?: string;
  createdAt: string;
  /** Added by migration 002. Missing before it is run. */
  status?: 'open' | 'in_progress' | 'done';
  resolution?: string | null;
}
/** hala_knowledge_answers (migration 002): admin answers for questions HALA could not answer. */
interface TAnswer {
  id: string;
  question: string;
  question_norm: string;
  service_id: string | null;
  answer_en: string | null;
  answer_ar: string | null;
  status: 'waiting' | 'answered' | 'out_of_scope';
  answered_by: string | null;
  answered_at: string | null;
  times_used: number;
  created_at: string;
  updated_at: string;
}
export const normQuestion = (q: string) => q.trim().toLowerCase().replace(/\s+/g, ' ');
export const TICKET_PREFIX = 'ticket:';
export const GAP_PREFIX = 'gap:';
interface THandover {
  id: string;
  reason: string;
  language: 'en' | 'ar';
  summary: string;
  callerName?: string;
  contact?: string;
  conversationId?: string;
  status: 'open' | 'taken' | 'closed';
  createdAt: string;
}
interface TEvent {
  id: string;
  ts: string;
  conversationId?: string;
  type: string;
  data: Record<string, unknown>;
  /** hala_events.average_sentiment (added by the agent team; numeric, may be empty). */
  averageSentiment?: number | null;
}

/**
 * Turns a sentiment number into positive / neutral / negative. The scale isn't documented yet, so it is
 * recognised from the value: -1..1 (most sentiment models), 1..5 (rating-like) or 0..100 (percent).
 */
export function sentimentLabel(v: number): 'positive' | 'neutral' | 'negative' {
  if (v >= -1 && v <= 1) return v > 0.2 ? 'positive' : v < -0.2 ? 'negative' : 'neutral';
  if (v > 1 && v <= 5) return v >= 4 ? 'positive' : v <= 2 ? 'negative' : 'neutral';
  return v >= 60 ? 'positive' : v <= 40 ? 'negative' : 'neutral';
}
interface ElSummary {
  agent_id: string;
  conversation_id: string;
  start_time_unix_secs: number;
  call_duration_secs: number;
  status: 'initiated' | 'in-progress' | 'processing' | 'done' | 'failed';
  call_successful: 'success' | 'failure' | 'unknown';
  transcript_summary?: string | null;
  call_summary_title?: string | null;
  main_language?: string | null;
  rating?: number | null;
  sentiment_analysis?: { overall_label?: 'positive' | 'neutral' | 'negative'; overall_frustration_score?: number | null } | null;
  data_collection_results?: Record<string, unknown> | null;
  evaluation_criteria_results?: Record<string, { result: 'success' | 'failure' | 'unknown'; rationale?: string }> | null;
}
interface ElDetail {
  conversation_id: string;
  status: ElSummary['status'];
  transcript: { role: 'user' | 'agent'; message?: string | null; time_in_call_secs: number }[];
  analysis?: {
    evaluation_criteria_results?: Record<string, { criteria_id: string; result: 'success' | 'failure' | 'unknown'; rationale?: string }>;
    data_collection_results?: Record<string, { value?: unknown }>;
  } | null;
}

/** Names of the evaluation criteria the agent is configured with (agent/05-provisioning). */
const CRITERIA: Record<string, string> = {
  ai_disclosure: 'Discloses it is an AI',
  no_invention: 'No invented facts',
  demo_labelled: 'Demo values labelled',
  language_followed: 'Follows the caller language',
  handover_correct: 'Hands over when it should',
  booking_confirmed: 'Reads back before booking',
};
const DATA_FIELDS = ['service_discussed', 'outcome', 'caller_language'];

// ---------------------------------------------------------------- helpers

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dubaiIso = (date: string, time: string) => `${date}T${time.slice(0, 5)}:00+04:00`;
const slotLabel = (date: string, time: string) => `${WEEKDAY[new Date(`${date}T12:00:00+04:00`).getUTCDay()]} ${time.slice(0, 5)}`;
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const dcValue = (v: unknown) => str(v && typeof v === 'object' && 'value' in (v as object) ? (v as { value: unknown }).value : v);
const isArabic = (t: string) => /[؀-ۿ]/.test(t);

/** Dubai wall-clock date + time for an ISO instant (for the reschedule tool). */
function toDubai(iso: string) {
  const d = new Date(Date.parse(iso) + 4 * 3600e3);
  const p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`, time: `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` };
}


/** Handover reason -> request outcome on the dashboard. */
function handoverOutcome(reason: string): { status: RequestStatus; unsolved: UnsolvedReason | null } {
  switch (reason) {
    case 'fee_dispute':
      return { status: 'unsolved', unsolved: 'fee_dispute' };
    case 'unknown_answer':
      return { status: 'unsolved', unsolved: 'unknown_answer' };
    case 'out_of_scope':
    case 'legal_question':
    case 'emergency':
      return { status: 'unsolved', unsolved: 'out_of_scope' };
    default: // caller_requested, upset_caller, other
      return { status: 'needs_followup', unsolved: null };
  }
}

// ---------------------------------------------------------------- mapping team data -> dashboard Db

interface Raw {
  bookings: TBooking[];
  requests: TRequest[];
  handovers: THandover[];
  events: TEvent[];
  conversations: ElSummary[];
  details: Map<string, ElDetail>;
  answers?: TAnswer[];
  /** hala_robot_logs: the robot bridge's log, incl. every spoken line ('agent' / 'user' levels). */
  robotLogs?: TRobotLog[];
  phoneConvs?: TPhoneConv[];
  phoneMessages?: TPhoneMsg[];
  rings?: TRing[];
  contacts?: TContact[];
}

/** Phone line tables (phone team): which conversations were phone calls, the chat, outbound rings, contacts. */
interface TPhoneConv { conversation_id: string; phone: string; created_at: string }
interface TPhoneMsg { seq: number; phone: string; from_who: string; kind: string; text: string | null; duration_sec: number | null; ts: string }
interface TRing { id: string; phone: string; reason: string | null; opening: string | null; kind: string | null; nudge_key: string | null; status: string | null; created_at: string }
interface TContact { phone: string; name: string | null; language: string | null }

interface TRobotLog {
  ts: string;
  level: string;
  message: string;
  robot_id?: string | null;
}

/** A robot conversation, cut out of the robot log ("connected." … "conversation closed"). */
interface RobotSession {
  start: number;
  end: number;
  turns: { role: 'agent' | 'user'; message: string; time_in_call_secs: number }[];
}

function robotSessions(logs: TRobotLog[]): RobotSession[] {
  const out: RobotSession[] = [];
  let cur: RobotSession | null = null;
  for (const l of [...logs].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const t = Date.parse(l.ts);
    const msg = (l.message ?? '').trim();
    if (l.level === 'info' && msg.startsWith('connected.')) {
      if (cur) out.push(cur);
      cur = { start: t, end: t, turns: [] };
      continue;
    }
    if (!cur) continue;
    if ((l.level === 'agent' || l.level === 'user') && msg && msg !== '...') {
      cur.turns.push({ role: l.level, message: msg, time_in_call_secs: Math.round((t - cur.start) / 1000) });
      cur.end = t; // a session ends at its last spoken line, not when the robot finally disconnects
    }
    if (msg.startsWith('conversation closed')) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push(cur);
  return out.filter((s) => s.turns.some((x) => x.role === 'user'));
}

const last4 = (v: unknown) => (String(v ?? '').match(/(\d{4})\D*$/) ?? [])[1] ?? '';

export function mapTeamData(raw: Raw, agents = { web: '', robot: '' }): Db {
  const db: Db = { calls: [], requests: [], events: [], bookings: [], tasks: [], handovers: [], knowledge_gaps: [], feedback: [] };
  const bookingByRef = new Map(raw.bookings.map((b) => [b.ref, b]));
  const requestByRef = new Map(raw.requests.map((r) => [r.ref, r]));
  const handoverById = new Map(raw.handovers.map((h) => [h.id, h]));
  const convLang = new Map<string, string>();

  // Calls: ElevenLabs conversations first (they have transcript + analysis).
  for (const c of raw.conversations) {
    const dc: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.data_collection_results ?? {})) dc[k] = dcValue(v);
    const detail = raw.details.get(c.conversation_id);
    for (const [k, v] of Object.entries(detail?.analysis?.data_collection_results ?? {})) dc[k] = dcValue(v);
    const evalSrc = detail?.analysis?.evaluation_criteria_results ?? c.evaluation_criteria_results ?? {};
    const analysis: CallAnalysis = {
      evaluation: Object.entries(evalSrc).map(([id, r]) => ({ id, name: CRITERIA[id] ?? id.replace(/_/g, ' '), result: r.result, rationale: r.rationale })),
      data: dc,
      title: c.call_summary_title ?? null,
    };
    const lang = (['en', 'ar', 'mixed'].includes(dc.caller_language) ? dc.caller_language : c.main_language?.slice(0, 2)) as Call['language'];
    if (lang) convLang.set(c.conversation_id, lang);
    const start = c.start_time_unix_secs * 1000;
    db.calls.push({
      id: c.conversation_id,
      agent_id: c.agent_id,
      channel: agents.robot && c.agent_id === agents.robot ? 'robot' : 'web',
      started_at: new Date(start).toISOString(),
      ended_at: c.status === 'done' ? new Date(start + c.call_duration_secs * 1000).toISOString() : null,
      duration_secs: c.call_duration_secs,
      language: lang ?? null,
      caller_type: null,
      status: c.status === 'done' || c.status === 'failed' ? 'done' : 'in_progress',
      call_successful: c.call_successful,
      sentiment: null,
      summary: c.call_summary_title || c.transcript_summary || null,
      transcript: detail
        ? detail.transcript.filter((t) => t.message).map((t) => ({ role: t.role, message: t.message, time_in_call_secs: t.time_in_call_secs }))
        : null,
      analysis,
      mood: c.sentiment_analysis?.overall_label
        ? {
            label: c.sentiment_analysis.overall_label,
            source: 'elevenlabs',
            detail: `ElevenLabs sentiment${
              c.sentiment_analysis.overall_frustration_score != null ? ` · frustration ${Math.round(c.sentiment_analysis.overall_frustration_score * 100)}%` : ''
            }`,
          }
        : null,
    });
    if (c.rating) db.feedback.push({ id: `fb_${c.conversation_id}`, call_id: c.conversation_id, rating: Math.round(c.rating), comment: null, created_at: new Date(start).toISOString() });
  }

  // Conversations only seen in agent events (e.g. ElevenLabs key not configured): make a basic call row.
  const known = new Set(db.calls.map((c) => c.id));
  const byConv = new Map<string, TEvent[]>();
  for (const e of [...raw.events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    if (!e.conversationId) continue;
    byConv.set(e.conversationId, [...(byConv.get(e.conversationId) ?? []), e]);
  }
  for (const [id, evs] of byConv) {
    if (known.has(id)) continue;
    const lang = [...raw.bookings, ...raw.requests, ...raw.handovers].find((x) => x.conversationId === id)?.language ?? null;
    db.calls.push({
      id,
      agent_id: null,
      channel: 'web',
      started_at: evs[0].ts,
      ended_at: evs[evs.length - 1].ts,
      duration_secs: Math.round((Date.parse(evs[evs.length - 1].ts) - Date.parse(evs[0].ts)) / 1000) || null,
      language: lang,
      caller_type: null,
      status: 'done',
      call_successful: null,
      sentiment: null,
      summary: null,
      transcript: null,
      analysis: null,
    });
    if (lang) convLang.set(id, lang);
  }

  // Events + derived requests (one request per outcome the agent produced).
  let eventId = 0;
  const lastService = new Map<string, string>();
  const withOutcome = new Set<string>();
  const gaps = new Map<string, KnowledgeGap>();

  const addRequest = (
    e: TEvent,
    service: string,
    status: RequestStatus,
    resolution: Resolution,
    question: string | null,
    extra: { contact?: string | null; unsolved?: UnsolvedReason | null; language?: string | null; id?: string; note?: string | null } = {},
  ) => {
    const r: ServiceRequest = {
      id: extra.id ?? `req_${e.id}`,
      call_id: e.conversationId ?? null,
      contact: extra.contact ?? null,
      service,
      question,
      language: extra.language ?? (e.conversationId ? convLang.get(e.conversationId) ?? null : null),
      status,
      resolution,
      unsolved_reason: extra.unsolved ?? null,
      assigned_to: null,
      note: extra.note ?? null,
      created_at: e.ts,
      updated_at: e.ts,
    };
    db.requests.push(r);
    if (e.conversationId) withOutcome.add(e.conversationId);
    return r.id;
  };

  // One case per booking reference, across however many calls it takes.
  const threads = new Map<string, ServiceRequest>();
  /** Conversations HALA started itself (reminders / callbacks): always phone. */
  const outboundCalls = new Set<string>();
  const startThread = (ref: string, requestId: string, e: TEvent, label: string) => {
    const r = db.requests.find((x) => x.id === requestId);
    if (!r || !ref) return;
    r.thread = { key: ref, calls: e.conversationId ? [e.conversationId] : [], steps: [{ at: e.ts, label, call_id: e.conversationId ?? null }] };
    threads.set(ref, r);
  };
  const continueThread = (ref: string, e: TEvent, label: string, resolution: Resolution): string | null => {
    const r = ref ? threads.get(ref) : undefined;
    if (!r?.thread) return null;
    r.thread.steps.push({ at: e.ts, label, call_id: e.conversationId ?? null });
    if (e.conversationId && !r.thread.calls.includes(e.conversationId)) r.thread.calls.push(e.conversationId);
    r.resolution = resolution;
    r.updated_at = e.ts;
    if (e.conversationId) withOutcome.add(e.conversationId);
    return r.id;
  };
  const push = (e: TEvent, type: string, service: string | null, detail: string, requestId?: string) =>
    db.events.push({ id: ++eventId, call_id: e.conversationId ?? null, created_at: e.ts, type, service, payload: { detail, request_id: requestId, source_id: e.id } });

  for (const e of [...raw.events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts))) {
    const d = e.data ?? {};
    const conv = e.conversationId ?? '';
    const svcFromConv = () => lastService.get(conv) ?? 'none';
    switch (e.type) {
      case 'service_matched': {
        const s = Array.isArray(d.services) ? str(d.services[0]) : '';
        if (s) lastService.set(conv, s);
        push(e, 'intent_detected', s || null, d.found ? `matched: ${str(d.query)}` : `no match: ${str(d.query)}`);
        break;
      }
      case 'slots_listed':
        push(e, 'intent_detected', svcFromConv(), `${str(d.count)} slots listed`);
        break;
      case 'booking_created': {
        const b = bookingByRef.get(str(d.ref));
        const ref = str(d.ref);
        const service = str(d.service) || b?.serviceId || svcFromConv();
        const detail = `${str(d.ref)} · booked for ${slotLabel(str(d.date), str(d.time))}`;
        const rid = addRequest(e, service, 'solved', 'booked', `Book ${getService(service)?.label ?? service} for ${str(d.attendee) || b?.attendeeName || 'caller'}`, {
          contact: b?.contact,
          language: b?.language,
        });
        startThread(ref, rid, e, `Booked for ${slotLabel(str(d.date), str(d.time))}`);
        push(e, 'booking_created', service, detail, rid);
        break;
      }
      case 'booking_rescheduled':
      case 'booking_cancelled': {
        const b = bookingByRef.get(str(d.ref));
        const service = b?.serviceId ?? svcFromConv();
        const moved = e.type === 'booking_rescheduled';
        const detail = moved ? `${str(d.ref)} · moved to ${slotLabel(str(d.date), str(d.time))}` : `${str(d.ref)} · booking cancelled`;
        const step = moved ? `Moved to ${slotLabel(str(d.date), str(d.time))}` : 'Cancelled';
        // Same booking as an earlier request (often a follow-up call): continue that case, don't start a new one.
        const existing = continueThread(str(d.ref), e, step, moved ? 'rescheduled' : 'cancelled');
        const rid =
          existing ??
          addRequest(e, service, 'solved', moved ? 'rescheduled' : 'cancelled', moved ? 'Move my appointment' : 'Cancel my appointment', {
            contact: b?.contact,
            language: b?.language,
          });
        if (!existing) startThread(str(d.ref), rid, e, step);
        push(e, e.type, service, detail, rid);
        break;
      }
      case 'request_logged': {
        const r = requestByRef.get(str(d.ref));
        const service = str(d.service) || r?.serviceId || svcFromConv();
        // Ticket status comes from hala_requests.status (migration 002): done = solved.
        const status: RequestStatus = r?.status === 'done' ? 'solved' : 'open';
        const rid = addRequest(e, service, status, 'task_created', r?.details ?? str(d.summary), {
          contact: r?.contact,
          language: r?.language,
          id: `${TICKET_PREFIX}${str(d.ref)}`,
          note: r?.resolution ?? null,
        });
        push(e, service === 'complaint' ? 'complaint_logged' : 'maintenance_logged', service, `${str(d.ref)} · ${str(d.summary).slice(0, 80)}`, rid);
        break;
      }
      case 'handover_requested': {
        const h = handoverById.get(str(d.id));
        const reason = str(d.reason) || h?.reason || 'other';
        const o = handoverOutcome(reason);
        const service = svcFromConv();
        const rid = addRequest(e, service, h?.status === 'closed' ? 'solved' : o.status, 'handed_over', str(d.summary) || h?.summary || null, {
          contact: h?.contact,
          unsolved: o.unsolved,
          language: str(d.language) || h?.language,
        });
        push(e, 'handover', service, `${HANDOVER_REASON_LABEL[reason] ?? reason} → human`, rid);
        break;
      }
      case 'fact_lookup': {
        const q = str(d.question);
        if (d.found) {
          push(e, 'docs_listed', svcFromConv(), 'answered from the fact base');
          break;
        }
        const service = svcFromConv();
        const rid = addRequest(e, service, 'unsolved', 'unanswered', q, { unsolved: 'unknown_answer', language: isArabic(q) ? 'ar' : 'en' });
        push(e, 'kb_miss', service, `didn't know: ${q.slice(0, 80)}`, rid);
        const key = normQuestion(q);
        const g = gaps.get(key);
        if (g) {
          g.times_asked++;
          g.last_asked_at = e.ts;
        } else if (key) {
          gaps.set(key, {
            id: `${GAP_PREFIX}${key}`,
            question: q,
            service,
            language: isArabic(q) ? 'ar' : 'en',
            times_asked: 1,
            first_asked_at: e.ts,
            last_asked_at: e.ts,
            status: 'waiting',
            answer_en: null,
            answer_ar: null,
            answered_by: null,
            answered_at: null,
            times_used: 0,
          });
        }
        break;
      }
      case 'outbound_call': {
        // HALA called the person (reminder before an appointment, or a promised callback). Proposed event:
        // { type: 'outbound_call', conversationId, data: { purpose: 'reminder' | 'callback', ref?, handover_id?, phone?, outcome? } }
        const purpose = str(d.purpose) === 'reminder' ? 'Reminder call' : 'Callback';
        const outcome = str(d.outcome);
        const label = `📞 ${purpose} by HALA${outcome ? ` (${outcome.replace(/_/g, ' ')})` : ''}`;
        const ref = str(d.ref);
        const thread = ref ? threads.get(ref) : undefined;
        if (thread?.thread) {
          thread.thread.steps.push({ at: e.ts, label, call_id: e.conversationId ?? null });
          if (e.conversationId && !thread.thread.calls.includes(e.conversationId)) thread.thread.calls.push(e.conversationId);
        }
        if (e.conversationId) {
          outboundCalls.add(e.conversationId);
          withOutcome.add(e.conversationId);
        }
        const handoverReq = d.handover_id ? db.requests.find((r) => r.id === `req_${raw.events.find((x) => x.type === 'handover_requested' && x.data?.id === d.handover_id)?.id}`) : undefined;
        // Logged as a callback against the case, so the Follow-ups page shows "callback … ago".
        push(e, 'callback_scheduled', thread?.service ?? handoverReq?.service ?? svcFromConv(), `${purpose.toLowerCase()} by HALA${ref ? ` · ${ref}` : ''}${outcome ? ` · ${outcome}` : ''}`, thread?.id ?? handoverReq?.id);
        break;
      }
      case 'tool_error':
        push(e, 'error', svcFromConv(), `tool error: ${str(d.code || d.message || d.tool)}`);
        break;
      default:
        push(e, e.type, null, e.type.replace(/_/g, ' '));
    }
  }

  // Conversations that ended without a booking / ticket / handover: use ElevenLabs' data collection outcome.
  for (const c of db.calls) {
    if (withOutcome.has(c.id) || c.status !== 'done') continue;
    const outcome = c.analysis?.data.outcome;
    const service = c.analysis?.data.service_discussed || lastService.get(c.id) || 'none';
    const fake: TEvent = { id: `el_${c.id}`, ts: c.ended_at ?? c.started_at, conversationId: c.id, type: 'outcome', data: {} };
    if (outcome === 'info_only' || (!outcome && lastService.has(c.id))) {
      const rid = addRequest(fake, service, 'solved', 'info_given', c.summary);
      push(fake, 'docs_listed', service, 'answered, information given', rid);
    } else if (outcome === 'abandoned') {
      const rid = addRequest(fake, service, 'unsolved', 'unanswered', c.summary, { unsolved: 'caller_hung_up' });
      push(fake, 'error', service, 'caller left before it was resolved', rid);
    }
  }

  // Merge admin answers (hala_knowledge_answers). Answered questions stay listed even if not asked again.
  for (const a of raw.answers ?? []) {
    const key = a.question_norm || normQuestion(a.question);
    const g = gaps.get(key);
    const merged = {
      status: a.status,
      answer_en: a.answer_en,
      answer_ar: a.answer_ar,
      answered_by: a.answered_by,
      answered_at: a.answered_at,
      times_used: a.times_used ?? 0,
      service: g?.service && g.service !== 'none' ? g.service : a.service_id,
    };
    if (g) Object.assign(g, merged);
    else
      gaps.set(key, {
        id: `${GAP_PREFIX}${key}`,
        question: a.question,
        language: isArabic(a.question) ? 'ar' : 'en',
        times_asked: 0,
        first_asked_at: a.created_at,
        last_asked_at: a.updated_at,
        ...merged,
      });
  }
  db.knowledge_gaps = [...gaps.values()];

  db.bookings = raw.bookings.map(
    (b): Booking => ({
      id: b.ref,
      call_id: b.conversationId ?? null,
      service: b.serviceId,
      customer_name: b.attendeeName,
      contact: b.contact,
      company: b.bookedByName ? `booked by ${b.bookedByName}` : null,
      slot_at: dubaiIso(b.date, b.time),
      status: b.status,
      documents: [],
      demo_fee_aed: null,
      created_at: b.createdAt,
      updated_at: b.updatedAt,
    }),
  );
  db.tasks = raw.requests.map(
    (r): Task => ({
      id: r.ref,
      call_id: r.conversationId ?? null,
      kind: r.serviceId === 'complaint' ? 'complaint' : 'maintenance',
      service: r.serviceId,
      priority: 'normal',
      status: r.status === 'done' ? 'done' : r.status === 'in_progress' ? 'in_progress' : 'open',
      title: `${r.ref} · ${r.callerName}`,
      details: { details: r.details, location: r.location },
      created_at: r.createdAt,
    }),
  );
  // ---- Channel: robot / phone / web (the agent doesn't record it, so work it out from what it leaves behind).
  const firstTs = new Map<string, number>();
  for (const e of raw.events) {
    if (!e.conversationId) continue;
    const t = Date.parse(e.ts);
    if (!firstTs.has(e.conversationId) || t < firstTs.get(e.conversationId)!) firstTs.set(e.conversationId, t);
  }
  const callById = new Map(db.calls.map((c) => [c.id, c]));

  // Robot: the conversation happened inside a robot session in hala_robot_logs. The log also holds the transcript.
  const phoneIds = new Set((raw.phoneConvs ?? []).map((p) => p.conversation_id));
  for (const s of robotSessions(raw.robotLogs ?? [])) {
    const inside = [...firstTs]
      .filter(([id, t]) => !phoneIds.has(id) && t >= s.start - 5000 && t <= s.end + 30000)
      .sort((a, b) => a[1] - b[1]) // the earliest conversation in the session is the robot's
      .map(([id]) => id);
    const target = inside.map((id) => callById.get(id)).find(Boolean);
    const lang = s.turns.some((x) => isArabic(x.message)) ? (s.turns.some((x) => x.role === 'user' && !isArabic(x.message)) ? 'mixed' : 'ar') : 'en';
    if (target) {
      target.channel = 'robot';
      target.started_at = new Date(Math.min(s.start, Date.parse(target.started_at))).toISOString();
      if (!target.transcript?.length) target.transcript = s.turns;
      if (target.status === 'done') {
        target.ended_at = new Date(s.end).toISOString();
        target.duration_secs = Math.round((s.end - s.start) / 1000);
      }
      target.language = target.language ?? lang;
    } else {
      // A robot conversation where the agent didn't call any tool: still a call worth showing.
      const id = `robot:${new Date(s.start).toISOString()}`;
      const call: Call = {
        id, agent_id: null, channel: 'robot', started_at: new Date(s.start).toISOString(), ended_at: new Date(s.end).toISOString(),
        duration_secs: Math.round((s.end - s.start) / 1000), language: lang, caller_type: null, status: 'done',
        call_successful: null, sentiment: null, summary: null, transcript: s.turns, analysis: null,
      };
      db.calls.push(call);
      callById.set(id, call);
    }
  }

  // ---- Phone line (exact, from the phone team's tables) ----
  const phoneConvs = [...(raw.phoneConvs ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  // Names: ONLY what was given in that conversation (booking attendee, ticket caller, handover caller).
  // Never the phone contact's name: test numbers are shared, so a number's saved name can belong to someone else.
  const nameInCall = new Map<string, string>();
  for (const x of [...raw.bookings.map((b) => ({ c: b.conversationId, n: b.attendeeName })), ...raw.requests.map((r) => ({ c: r.conversationId, n: r.callerName })), ...raw.handovers.map((h) => ({ c: h.conversationId, n: h.callerName }))])
    if (x.c && x.n && !nameInCall.has(x.c)) nameInCall.set(x.c, x.n);
  for (const [i, pc] of phoneConvs.entries()) {
    let c = callById.get(pc.conversation_id);
    if (!c) {
      c = {
        id: pc.conversation_id, agent_id: null, channel: 'phone', started_at: pc.created_at, ended_at: null, duration_secs: null,
        language: null, caller_type: null, status: 'done', call_successful: null, sentiment: null, summary: null, transcript: null, analysis: null,
      };
      db.calls.push(c);
      callById.set(c.id, c);
    }
    c.channel = 'phone';
    c.phone = pc.phone;
    c.caller_name = c.caller_name ?? nameInCall.get(pc.conversation_id) ?? null;
    // The phone chat (texts / voice notes) around this conversation, until the next conversation on the same number.
    if (!c.transcript?.length) {
      const start = Date.parse(pc.created_at) - 120e3;
      const next = phoneConvs.slice(i + 1).find((x) => x.phone === pc.phone);
      const end = next ? Date.parse(next.created_at) - 120e3 : Infinity;
      const msgs = (raw.phoneMessages ?? [])
        .filter((m) => m.phone === pc.phone && m.text && Date.parse(m.ts) >= start && Date.parse(m.ts) < end)
        .sort((a, b) => a.seq - b.seq);
      if (msgs.length)
        c.transcript = msgs.map((m) => ({
          role: m.from_who === 'agent' ? ('agent' as const) : ('user' as const),
          message: m.kind === 'voice' ? `(voice note) ${m.text}` : (m.text as string),
          time_in_call_secs: Math.max(0, Math.round((Date.parse(m.ts) - Date.parse(pc.created_at)) / 1000)),
        }));
    }
    if (!c.language && c.transcript?.length) c.language = c.transcript.some((t) => isArabic(t.message ?? '')) ? 'ar' : 'en';
  }

  // Rings = HALA calling someone (appointment reminders, callbacks). Link each to the conversation it started
  // (same number, within 3 minutes) and to the booking it is about.
  const bookingsOut = new Map<string, { status: string; at: string }>();
  for (const ring of raw.rings ?? []) {
    const kind = (ring.kind ?? 'call').replace(/_/g, ' ');
    const label = kind.charAt(0).toUpperCase() + kind.slice(1);
    const t = Date.parse(ring.created_at);
    const conv = phoneConvs.find((pc) => pc.phone === ring.phone && Date.parse(pc.created_at) >= t && Date.parse(pc.created_at) - t < 3 * 60e3);
    const call = conv ? callById.get(conv.conversation_id) : undefined;
    if (call) {
      call.direction = 'outbound';
      call.outbound_reason = label;
      call.started_at = new Date(Math.min(t, Date.parse(call.started_at))).toISOString();
    }
    const ref = `${ring.reason ?? ''} ${ring.nudge_key ?? ''}`.match(/HALA-\d+/)?.[0];
    const r = ref ? threads.get(ref) : undefined;
    const step = `HALA called: ${label.toLowerCase()} (${ring.status ?? 'sent'})`;
    if (r?.thread) {
      r.thread.steps.push({ at: ring.created_at, label: step, call_id: call?.id ?? null });
      if (call && !r.thread.calls.includes(call.id)) r.thread.calls.push(call.id);
      r.thread.steps.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
      r.thread.calls.sort((a, b) => Date.parse(callById.get(a)?.started_at ?? '') - Date.parse(callById.get(b)?.started_at ?? ''));
    }
    if (ref) bookingsOut.set(ref, { status: ring.status ?? 'sent', at: ring.created_at });
    db.events.push({
      id: ++eventId,
      call_id: call?.id ?? null,
      created_at: ring.created_at,
      type: 'callback_scheduled',
      service: r?.service ?? null,
      payload: {
        // The person on the booking HALA called about (not the number's saved contact name).
        detail: `HALA called ${(ref && raw.bookings.find((b) => b.ref === ref)?.attendeeName) || 'the caller'}: ${label.toLowerCase()}${ref ? ` · ${ref}` : ''} · ${ring.status ?? 'sent'}`,
        request_id: r?.id,
        source_id: ring.id,
      },
    });
  }

  for (const b of db.bookings) b.reminder = bookingsOut.get(b.id) ?? null;

  for (const c of db.calls) if (!c.caller_name && nameInCall.has(c.id)) c.caller_name = nameInCall.get(c.id)!;

  // Phone fallback when the phone tables aren't readable: a phone number was linked just before the conversation, or the same number was used.
  const phoneLinks = raw.events.filter((e) => e.type === 'phone_linked').map((e) => ({ t: Date.parse(e.ts), digits: last4(e.data?.phone) }));
  const contactsByConv = new Map<string, string[]>();
  for (const x of [...raw.bookings, ...raw.requests, ...raw.handovers])
    if (x.conversationId) contactsByConv.set(x.conversationId, [...(contactsByConv.get(x.conversationId) ?? []), last4(x.contact)]);
  const candidates = db.calls
    .filter((c) => c.channel !== 'robot' && !(c.agent_id && c.agent_id === agents.web))
    .map((c) => ({ c, t: firstTs.get(c.id) ?? Date.parse(c.started_at) }))
    .sort((x, y) => x.t - y.t);
  if (!phoneConvs.length) for (const p of phoneLinks) {
    // The phone call is the first conversation that starts within 5 minutes of the number being linked.
    const next = candidates.find((x) => x.t > p.t && x.t - p.t < 5 * 60e3);
    if (next) next.c.channel = 'phone';
    // Any conversation that used the same phone number.
    if (p.digits) for (const x of candidates) if ((contactsByConv.get(x.c.id) ?? []).includes(p.digits)) x.c.channel = 'phone';
  }
  for (const id of outboundCalls) {
    const c = callById.get(id);
    if (c) c.channel = 'phone';
  }
  // A follow-up call in the same case as a phone call is a phone call too (unless it was on the robot).
  for (const r of db.requests) {
    const calls = r.thread?.calls ?? [];
    if (!calls.some((id) => callById.get(id)?.channel === 'phone')) continue;
    for (const id of calls) {
      const c = callById.get(id);
      if (c && c.channel === 'web') c.channel = 'phone';
    }
  }

  // The agent's own sentiment score (hala_events.average_sentiment): latest value per conversation wins over
  // ElevenLabs-less defaults; ElevenLabs sentiment, when present, is kept.
  const latestScore = new Map<string, { t: number; v: number }>();
  for (const e of raw.events) {
    const v = e.averageSentiment;
    if (!e.conversationId || v == null || !Number.isFinite(v)) continue;
    const t = Date.parse(e.ts);
    const prev = latestScore.get(e.conversationId);
    if (!prev || t > prev.t) latestScore.set(e.conversationId, { t, v });
  }
  for (const [id, { v }] of latestScore) {
    const c = callById.get(id);
    if (c && c.mood?.source !== 'elevenlabs')
      c.mood = { label: sentimentLabel(v), source: 'agent', detail: `HALA sentiment score ${Math.round(v * 100) / 100}`, score: v };
  }

  // HALA's own signal: it handed over because the caller was upset.
  for (const h of raw.handovers) {
    const c = h.conversationId ? callById.get(h.conversationId) : undefined;
    if (c && !c.mood && h.reason === 'upset_caller') c.mood = { label: 'negative', source: 'hala', detail: 'HALA flagged the caller as upset and handed over' };
  }

  db.handovers = raw.handovers.map(
    (h): Handover => ({
      id: h.id,
      call_id: h.conversationId ?? null,
      reason: h.reason,
      service: h.conversationId ? lastService.get(h.conversationId) ?? null : null,
      status: h.status === 'open' ? 'waiting' : h.status === 'taken' ? 'picked_up' : 'resolved',
      context: [h.callerName && `${h.callerName}${h.contact ? ` (${h.contact})` : ''}`, h.summary].filter(Boolean).join(' — '),
      created_at: h.createdAt,
      caller_name: h.callerName ?? (h.conversationId ? callById.get(h.conversationId)?.caller_name : null) ?? null,
      contact: h.contact ?? null,
      language: h.language,
    }),
  );
  return db;
}

// ---------------------------------------------------------------- the DataSource

export function createTeamSource(): DataSource {
  const agents = __HALA_AGENTS__;
  const proxy = __HALA_PROXY__;
  const details = new Map<string, ElDetail>();
  const listeners = new Set<() => void>();
  let cache: Promise<Db> | null = null;
  let lastDb: Db | null = null;
  let health: HealthItem[] = [];
  let es: EventSource | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const fetchTalk = async () => {
    if (!proxy.talk) return { ok: false as const, why: 'HALA_ADMIN_KEY not set' };
    try {
      const [bookings, requests, handovers, events] = await Promise.all(
        (['bookings', 'requests', 'handovers', 'events'] as const).map((k) => getJson<unknown[]>('hala', `/api/admin/${k}`)),
      );
      return { ok: true as const, bookings: bookings as TBooking[], requests: requests as TRequest[], handovers: handovers as THandover[], events: events as TEvent[] };
    } catch (e) {
      return { ok: false as const, why: (e as Error).message };
    }
  };

  /** Supabase hala_* tables, read directly (service key added by the guarded dev-server proxy). */
  type Row = Record<string, unknown>;
  const sbGet = (table: string, order: string) => getJson<Row[]>('sb', `/${table}?select=*&order=${order}.desc&limit=1000`);
  const fetchSupabase = async () => {
    if (!proxy.supabase) return { ok: false as const, why: 'SUPABASE_URL / SUPABASE_SERVICE_KEY not set' };
    try {
      const [b, r, h, e] = await Promise.all([
        sbGet('hala_bookings', 'created_at'),
        sbGet('hala_requests', 'created_at'),
        sbGet('hala_handovers', 'created_at'),
        sbGet('hala_events', 'ts'),
      ]);
      const o = (x: unknown) => (x == null ? undefined : str(x));
      return {
        ok: true as const,
        bookings: b.map(
          (x): TBooking => ({
            ref: str(x.ref), serviceId: str(x.service_id), attendeeName: str(x.attendee_name), bookedByName: o(x.booked_by_name),
            contact: str(x.contact), date: str(x.date), time: str(x.time).slice(0, 5), language: x.language === 'ar' ? 'ar' : 'en',
            conversationId: o(x.conversation_id), status: x.status === 'cancelled' ? 'cancelled' : 'confirmed',
            createdAt: str(x.created_at), updatedAt: str(x.updated_at),
          }),
        ),
        requests: r.map(
          (x): TRequest => ({
            ref: str(x.ref), serviceId: str(x.service_id), callerName: str(x.caller_name), contact: str(x.contact), details: str(x.details),
            location: o(x.location), language: x.language === 'ar' ? 'ar' : 'en', conversationId: o(x.conversation_id), createdAt: str(x.created_at),
            status: x.status === 'done' ? 'done' : x.status === 'in_progress' ? 'in_progress' : x.status === 'open' ? 'open' : undefined,
            resolution: o(x.resolution) ?? null,
          }),
        ),
        handovers: h.map(
          (x): THandover => ({
            id: str(x.id), reason: str(x.reason), language: x.language === 'ar' ? 'ar' : 'en', summary: str(x.summary),
            callerName: o(x.caller_name), contact: o(x.contact), conversationId: o(x.conversation_id),
            status: x.status === 'taken' ? 'taken' : x.status === 'closed' ? 'closed' : 'open', createdAt: str(x.created_at),
          }),
        ),
        events: e.map(
          (x): TEvent => ({
            id: str(x.id),
            ts: str(x.ts),
            conversationId: o(x.conversation_id),
            type: str(x.type),
            data: (x.data as Row) ?? {},
            averageSentiment: x.average_sentiment == null || x.average_sentiment === '' ? null : Number(x.average_sentiment),
          }),
        ),
        // Migration 002 may not be run yet: then Teach answers are simply empty.
        answers: (await sbGet('hala_knowledge_answers', 'updated_at').catch(() => null)) as TAnswer[] | null,
        robotLogs: ((await sbGet('hala_robot_logs', 'ts').catch(() => null)) ?? []) as unknown as TRobotLog[],
        // Phone line tables: optional, the dashboard works without them.
        phoneConvs: ((await sbGet('hala_phone_conversations', 'created_at').catch(() => null)) ?? []) as unknown as TPhoneConv[],
        phoneMessages: ((await sbGet('hala_phone_messages', 'ts').catch(() => null)) ?? []) as unknown as TPhoneMsg[],
        rings: ((await sbGet('hala_phone_rings', 'created_at').catch(() => null)) ?? []) as unknown as TRing[],
        contacts: ((await sbGet('hala_phone_contacts', 'last_seen_at').catch(() => null)) ?? []) as unknown as TContact[],
      };
    } catch (err) {
      const msg = (err as Error).message;
      return {
        ok: false as const,
        why: /PGRST205|Could not find the table/.test(msg) ? 'hala_* tables not created yet: run agent/09-supabase/migrations/001_hala_tables.sql' : msg,
      };
    }
  };

  const sbPatch = async (path: string, body: Row) => {
    await getJson('sb', `/${path}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(body),
    });
    refresh();
  };

  const fetchEleven = async () => {
    if (!proxy.eleven) return { ok: false as const, why: 'ELEVENLABS_API_KEY not set' };
    const ids = [agents.web, agents.robot].filter(Boolean);
    if (!ids.length) return { ok: false as const, why: 'HALA_AGENT_ID not set' };
    try {
      const qs = (id: string) => {
        const p = new URLSearchParams({ agent_id: id, page_size: '100', summary_mode: 'include' });
        DATA_FIELDS.forEach((f) => p.append('data_collection_ids', f));
        Object.keys(CRITERIA).forEach((c) => p.append('evaluation_criteria_ids', c));
        return p.toString();
      };
      const lists = await Promise.all(ids.map((id) => getJson<{ conversations: ElSummary[] }>('el', `/v1/convai/conversations?${qs(id)}`)));
      const conversations = lists.flatMap((l) => l.conversations ?? []);
      // Transcripts for the newest 40; finished ones never change, so they are cached.
      const want = [...conversations]
        .sort((a, b) => b.start_time_unix_secs - a.start_time_unix_secs)
        .slice(0, 40)
        .filter((c) => !details.has(c.conversation_id) || c.status !== 'done' || details.get(c.conversation_id)?.status !== 'done');
      for (let i = 0; i < want.length; i += 4) {
        await Promise.all(
          want.slice(i, i + 4).map(async (c) => {
            try {
              details.set(c.conversation_id, await getJson<ElDetail>('el', `/v1/convai/conversations/${c.conversation_id}`));
            } catch {
              /* keep the summary row without a transcript */
            }
          }),
        );
      }
      return { ok: true as const, conversations };
    } catch (e) {
      return { ok: false as const, why: (e as Error).message };
    }
  };

  const load = (): Promise<Db> => {
    if (!cache) {
      cache = Promise.all([fetchSupabase(), proxy.talk ? fetchTalk() : null, fetchEleven()]).then(([sbRes, talkRes, el]) => {
        // Supabase is the store of record; the agent server's admin API is the fallback.
        const talk = sbRes.ok ? sbRes : talkRes && talkRes.ok ? talkRes : sbRes;
        health = [
          {
            label: 'Supabase',
            ok: sbRes.ok,
            detail: sbRes.ok
              ? `${sbRes.bookings.length} bookings · ${sbRes.events.length} events${sbRes.answers ? '' : ' · Teach table missing: run migration 002'}`
              : sbRes.why,
          },
          ...(talkRes ? [{ label: 'Agent server', ok: talkRes.ok, detail: talkRes.ok ? `${talkRes.events.length} events · ${proxy.talkUrl}` : talkRes.why }] : []),
          // Only feeds that are configured: a missing ElevenLabs key isn't an error, the feature just isn't on.
          ...(proxy.eleven ? [{ label: 'ElevenLabs', ok: el.ok, detail: el.ok ? `${el.conversations.length} conversations` : el.why }] : []),
        ];
        return (lastDb = mapTeamData(
          {
            bookings: talk.ok ? talk.bookings : [],
            requests: talk.ok ? talk.requests : [],
            handovers: talk.ok ? talk.handovers : [],
            events: talk.ok ? talk.events : [],
            conversations: el.ok ? el.conversations : [],
            details,
            answers: sbRes.ok ? sbRes.answers ?? [] : [],
            robotLogs: sbRes.ok ? sbRes.robotLogs : [],
            phoneConvs: sbRes.ok ? sbRes.phoneConvs : [],
            phoneMessages: sbRes.ok ? sbRes.phoneMessages : [],
            rings: sbRes.ok ? sbRes.rings : [],
            contacts: sbRes.ok ? sbRes.contacts : [],
          },
          agents,
        ));
      });
    }
    return cache;
  };

  const refresh = () => {
    cache = null;
    listeners.forEach((fn) => fn());
  };

  const tool = async (name: string, body: Record<string, unknown>) => {
    if (!proxy.tools) throw new Error('HALA_TOOL_SECRET is not set for the dashboard, so it cannot change bookings.');
    const res = await getJson<{ ok: boolean; message?: string }>('hala', `/api/tools/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res?.ok) throw new Error(res?.message ?? `${name} failed`);
    refresh();
  };

  const migration002 = (e: Error): never => {
    throw new Error(/PGRST20[45]|column|does not exist|Could not find/.test(e.message) ? 'Run migration 002 in the Supabase SQL editor first (agent/09-supabase/migrations/002_teach_and_ticket_status.sql).' : e.message);
  };

  /** Upsert one hala_knowledge_answers row per question (unique on question_norm). */
  const saveAnswer = async (gapId: string, fields: Row, questionText?: string) => {
    if (!proxy.supabase) return notYet('Saving an answer for the agent')();
    const gap = questionText ? { question: questionText, service: fields.service_id as string | null } : lastDb?.knowledge_gaps.find((g) => g.id === gapId);
    if (!gap) throw new Error('Question not found. Refresh and try again.');
    const now = new Date().toISOString();
    await getJson('sb', '/hala_knowledge_answers?on_conflict=question_norm', {
      method: 'POST',
      headers: { 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        question: gap.question,
        question_norm: normQuestion(gap.question),
        service_id: gap.service && gap.service !== 'none' ? gap.service : null,
        updated_at: now,
        ...fields,
      }),
    }).catch(migration002);
    refresh();
  };

  const notYet = (what: string) => () =>
    Promise.reject(new Error(`${what} needs a write endpoint on the agent server. It isn't available in live mode yet (works in demo mode).`));

  return {
    mode: 'live',
    getHealth: async () => {
      await load().catch(() => undefined);
      return health;
    },
    getSnapshot: async (f) => filterDb(await load(), f),
    getKpis: async (f) => computeKpis(await load(), f),
    getLiveFeed: async (f, limit) => buildFeed(await load(), f, limit),
    getCall: async (id) => buildCallDetail(await load(), id),
    getInsights: async (f) => computeInsights(await load(), f),
    getConversations: async (f, q) => buildConversations(await load(), f, q),
    getDayStats: async (f) => buildDayStats(await load(), f),
    getHandoverAlert: async (id) => buildHandoverAlert(await load(), id),
    getLatestCall: async (f) => buildLatestCall(await load(), f),

    async updateBooking(id, patch) {
      // Prefer the agent's own booking tools (calendar rules + live event); else write the row directly.
      if (proxy.tools) {
        if (patch.status === 'cancelled') return tool('cancel_appointment', { ref: id, language: 'en' });
        if (patch.status === 'rescheduled' && patch.slot_at) return tool('reschedule_appointment', { ref: id, ...toDubai(patch.slot_at), language: 'en' });
      } else if (proxy.supabase) {
        const ref = encodeURIComponent(id);
        if (patch.status === 'cancelled') return sbPatch(`hala_bookings?ref=eq.${ref}`, { status: 'cancelled', updated_at: new Date().toISOString() });
        if (patch.status === 'rescheduled' && patch.slot_at)
          // The table only allows confirmed/cancelled; the unique slot index still blocks double booking.
          return sbPatch(`hala_bookings?ref=eq.${ref}`, { ...toDubai(patch.slot_at), updated_at: new Date().toISOString() }).catch((e: Error) => {
            throw new Error(/23505|duplicate/.test(e.message) ? 'That slot is already taken.' : e.message);
          });
      }
      return notYet('Changing this booking')();
    },
    async updateHandover(id, status) {
      if (!proxy.supabase) return notYet('Changing a handover status')();
      return sbPatch(`hala_handovers?id=eq.${encodeURIComponent(id)}`, { status: status === 'picked_up' ? 'taken' : 'closed' });
    },
    async updateRequest(id, patch) {
      // Only tickets (maintenance / complaints) have a status column (migration 002).
      if (!id.startsWith(TICKET_PREFIX) || !proxy.supabase)
        return notYet('Changing this request (only maintenance tickets and complaints can be closed)')();
      const body: Row = { updated_at: new Date().toISOString() };
      if (patch.status) body.status = patch.status === 'solved' ? 'done' : patch.status === 'needs_followup' ? 'in_progress' : 'open';
      if (patch.note !== undefined) body.resolution = patch.note;
      return sbPatch(`hala_requests?ref=eq.${encodeURIComponent(id.slice(TICKET_PREFIX.length))}`, body).catch(migration002);
    },
    answerGap: (id, a) =>
      saveAnswer(id, {
        answer_en: a.answer_en,
        answer_ar: a.answer_ar || null,
        service_id: a.service === 'none' ? null : a.service,
        status: 'answered',
        answered_by: 'dashboard admin',
        answered_at: new Date().toISOString(),
      }),
    setGapStatus: (id, status) => saveAnswer(id, { status }),
    addKnowledge: (e) =>
      saveAnswer(
        '',
        {
          answer_en: e.answer_en,
          answer_ar: e.answer_ar || null,
          service_id: e.service === 'none' || e.service === 'general' ? null : e.service,
          status: 'answered',
          answered_by: 'dashboard admin',
          answered_at: new Date().toISOString(),
        },
        e.question.trim(),
      ),

    subscribe(onChange) {
      listeners.add(onChange);
      if (!es && proxy.talk) {
        // Live agent events (bookings, handovers, ...) the moment they happen.
        let debounce: ReturnType<typeof setTimeout> | null = null;
        es = new EventSource(apiUrl('hala', '/api/events'));
        es.addEventListener('hala', () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(refresh, 400);
        });
      }
      // ElevenLabs has no push to the browser: poll for new conversations and live transcripts.
      if (!poll) poll = setInterval(refresh, proxy.talk ? 10_000 : 5_000); // no push from Supabase without exposing the key
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          es?.close();
          es = null;
          if (poll) clearInterval(poll);
          poll = null;
        }
      };
    },
  };
}
