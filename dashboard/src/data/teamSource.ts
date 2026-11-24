// LIVE mode: reads the team's real agent data and maps it onto the dashboard's tables (Db).
//
//  1. Agent server (agent/06-talk-app, Briyan's branch), through the Vite proxy at /hala-api
//     GET /api/admin/bookings | requests | handovers | events   (admin key added by the proxy)
//     GET /api/events                                            (live server-sent events)
//     POST /api/tools/cancel_appointment | reschedule_appointment (tool secret added by the proxy)
//     These read Supabase hala_* tables (or the JSON file) on the server.
//  2. ElevenLabs, through the Vite proxy at /el-api (xi-api-key added by the proxy)
//     GET /v1/convai/conversations           list + summary + evaluation + data collection
//     GET /v1/convai/conversations/{id}      transcript
//     ElevenLabs is where conversation transcripts are stored; nothing is copied.
//
// Keys never reach the browser: vite.config.ts injects them into the proxied requests.

import { buildCallDetail, buildConversations, buildFeed, buildLatestCall, computeKpis, filterDb } from './compute';
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
}
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

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${url.split('?')[0]}: ${text.slice(0, 160) || res.statusText}`);
  return (text ? JSON.parse(text) : null) as T;
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
}

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
    extra: { contact?: string | null; unsolved?: UnsolvedReason | null; language?: string | null } = {},
  ) => {
    const r: ServiceRequest = {
      id: `req_${e.id}`,
      call_id: e.conversationId ?? null,
      contact: extra.contact ?? null,
      service,
      question,
      language: extra.language ?? (e.conversationId ? convLang.get(e.conversationId) ?? null : null),
      status,
      resolution,
      unsolved_reason: extra.unsolved ?? null,
      assigned_to: null,
      note: null,
      created_at: e.ts,
      updated_at: e.ts,
    };
    db.requests.push(r);
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
        const service = str(d.service) || b?.serviceId || svcFromConv();
        const detail = `${str(d.ref)} · booked for ${slotLabel(str(d.date), str(d.time))}`;
        const rid = addRequest(e, service, 'solved', 'booked', `Book ${getService(service)?.label ?? service} for ${str(d.attendee) || b?.attendeeName || 'caller'}`, {
          contact: b?.contact,
          language: b?.language,
        });
        push(e, 'booking_created', service, detail, rid);
        break;
      }
      case 'booking_rescheduled':
      case 'booking_cancelled': {
        const b = bookingByRef.get(str(d.ref));
        const service = b?.serviceId ?? svcFromConv();
        const moved = e.type === 'booking_rescheduled';
        const detail = moved ? `${str(d.ref)} · moved to ${slotLabel(str(d.date), str(d.time))}` : `${str(d.ref)} · booking cancelled`;
        const rid = addRequest(e, service, 'solved', moved ? 'rescheduled' : 'cancelled', moved ? 'Move my appointment' : 'Cancel my appointment', {
          contact: b?.contact,
          language: b?.language,
        });
        push(e, e.type, service, detail, rid);
        break;
      }
      case 'request_logged': {
        const r = requestByRef.get(str(d.ref));
        const service = str(d.service) || r?.serviceId || svcFromConv();
        const rid = addRequest(e, service, 'open', 'task_created', r?.details ?? str(d.summary), { contact: r?.contact, language: r?.language });
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
        const key = q.trim().toLowerCase();
        const g = gaps.get(key);
        if (g) {
          g.times_asked++;
          g.last_asked_at = e.ts;
        } else if (key) {
          gaps.set(key, {
            id: `gap_${e.id}`,
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
      status: 'open',
      title: `${r.ref} · ${r.callerName}`,
      details: { details: r.details, location: r.location },
      created_at: r.createdAt,
    }),
  );
  db.handovers = raw.handovers.map(
    (h): Handover => ({
      id: h.id,
      call_id: h.conversationId ?? null,
      reason: h.reason,
      service: h.conversationId ? lastService.get(h.conversationId) ?? null : null,
      status: h.status === 'open' ? 'waiting' : h.status === 'taken' ? 'picked_up' : 'resolved',
      context: [h.callerName && `${h.callerName}${h.contact ? ` (${h.contact})` : ''}`, h.summary].filter(Boolean).join(' — '),
      created_at: h.createdAt,
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
  let health: HealthItem[] = [];
  let es: EventSource | null = null;
  let poll: ReturnType<typeof setInterval> | null = null;

  const fetchTalk = async () => {
    if (!proxy.talk) return { ok: false as const, why: 'HALA_ADMIN_KEY not set' };
    try {
      const [bookings, requests, handovers, events] = await Promise.all(
        (['bookings', 'requests', 'handovers', 'events'] as const).map((k) => getJson<unknown[]>(`/hala-api/api/admin/${k}`)),
      );
      return { ok: true as const, bookings: bookings as TBooking[], requests: requests as TRequest[], handovers: handovers as THandover[], events: events as TEvent[] };
    } catch (e) {
      return { ok: false as const, why: (e as Error).message };
    }
  };

  /** Supabase hala_* tables, read directly (service key added by the guarded dev-server proxy). */
  type Row = Record<string, unknown>;
  const sbGet = (table: string, order: string) => getJson<Row[]>(`/sb-api/${table}?select=*&order=${order}.desc&limit=1000`);
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
          }),
        ),
        handovers: h.map(
          (x): THandover => ({
            id: str(x.id), reason: str(x.reason), language: x.language === 'ar' ? 'ar' : 'en', summary: str(x.summary),
            callerName: o(x.caller_name), contact: o(x.contact), conversationId: o(x.conversation_id),
            status: x.status === 'taken' ? 'taken' : x.status === 'closed' ? 'closed' : 'open', createdAt: str(x.created_at),
          }),
        ),
        events: e.map((x): TEvent => ({ id: str(x.id), ts: str(x.ts), conversationId: o(x.conversation_id), type: str(x.type), data: (x.data as Row) ?? {} })),
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
    await getJson(`/sb-api/${path}`, {
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
      const lists = await Promise.all(ids.map((id) => getJson<{ conversations: ElSummary[] }>(`/el-api/v1/convai/conversations?${qs(id)}`)));
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
              details.set(c.conversation_id, await getJson<ElDetail>(`/el-api/v1/convai/conversations/${c.conversation_id}`));
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
          { label: 'Supabase', ok: sbRes.ok, detail: sbRes.ok ? `${sbRes.bookings.length} bookings · ${sbRes.events.length} events` : sbRes.why },
          ...(talkRes ? [{ label: 'Agent server', ok: talkRes.ok, detail: talkRes.ok ? `${talkRes.events.length} events · ${proxy.talkUrl}` : talkRes.why }] : []),
          { label: 'ElevenLabs', ok: el.ok, detail: el.ok ? `${el.conversations.length} conversations` : el.why },
        ];
        return mapTeamData(
          {
            bookings: talk.ok ? talk.bookings : [],
            requests: talk.ok ? talk.requests : [],
            handovers: talk.ok ? talk.handovers : [],
            events: talk.ok ? talk.events : [],
            conversations: el.ok ? el.conversations : [],
            details,
          },
          agents,
        );
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
    const res = await getJson<{ ok: boolean; message?: string }>(`/hala-api/api/tools/${name}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res?.ok) throw new Error(res?.message ?? `${name} failed`);
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
      return notYet('Marking a booking completed')();
    },
    async updateHandover(id, status) {
      if (!proxy.supabase) return notYet('Changing a handover status')();
      return sbPatch(`hala_handovers?id=eq.${encodeURIComponent(id)}`, { status: status === 'picked_up' ? 'taken' : 'closed' });
    },
    updateRequest: notYet('Changing a request'),
    logFollowup: notYet('Logging a follow-up'),
    answerGap: notYet('Saving an answer for the agent'),
    setGapStatus: notYet('Marking a question out of scope'),

    subscribe(onChange) {
      listeners.add(onChange);
      if (!es && proxy.talk) {
        // Live agent events (bookings, handovers, ...) the moment they happen.
        let debounce: ReturnType<typeof setTimeout> | null = null;
        es = new EventSource('/hala-api/api/events');
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
