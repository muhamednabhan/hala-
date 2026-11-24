// Pure functions: raw tables (Db) + filters -> what widgets need.
// Shared by mockSource and supabaseSource so both modes show identical numbers.

import { serviceLabel } from './services';
import type { CallDetail, CallerHistory, ConversationRow, Db, FeedItem, Filters, Handover, HandoverAlert, Kpis, Language, RequestStatus, TranscriptTurn } from './types';

export function startOfToday(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function rangeStart(range: Filters['range'], now = Date.now()): number | null {
  if (range === 'today') return startOfToday(now);
  if (range === '7d') return now - 7 * 24 * 3600 * 1000;
  return null;
}

/** Conversations the team created while testing (not real callers). */
const TEST_CALL = /^(t|test|smoke|prod-smoke|demo)([-_ ].*|\d*)$/i;
const TEST_NAME = /^(demo caller|test( user)?|.*\btest)$/i; // "Smoke Test", "Latency Test"…
export const isTestCall = (id: string) => TEST_CALL.test(id);

/** Apply the global filter bar. Calls are filtered first; child rows follow their call. */
export function filterDb(db: Db, f: Filters): Db {
  const start = rangeStart(f.range);
  const calls = db.calls.filter(
    (c) =>
      !(f.hideTests && isTestCall(c.id)) &&
      (start == null || Date.parse(c.started_at) >= start) &&
      (f.channel === 'all' || c.channel === f.channel) &&
      (f.language === 'all' || c.language === f.language),
  );
  const ids = new Set(calls.map((c) => c.id));
  // Rows not tied to a conversation (e.g. a booking made outside a call) only show when not filtering by channel/language.
  const orphanOk = (r: { created_at?: string }) =>
    f.channel === 'all' && f.language === 'all' && (start == null || !r.created_at || Date.parse(r.created_at) >= start);
  const byCall = <T extends { call_id: string | null; created_at?: string }>(rows: T[]) =>
    rows.filter((r) => (r.call_id != null ? ids.has(r.call_id) : orphanOk(r)));
  return {
    calls,
    requests: byCall(db.requests),
    events: byCall(db.events),
    bookings: byCall(db.bookings).filter((b) => !(f.hideTests && TEST_NAME.test(b.customer_name.trim()))),
    tasks: byCall(db.tasks),
    handovers: byCall(db.handovers),
    feedback: byCall(db.feedback),
    // Gaps aren't tied to a call: filter by language + last asked.
    knowledge_gaps: db.knowledge_gaps.filter(
      (g) =>
        (f.language === 'all' || g.language === f.language) &&
        (start == null || Date.parse(g.last_asked_at) >= start),
    ),
  };
}

/** Event types that mean "the call led to an action" (booking / task / handover). */
const ACTION_EVENTS = new Set([
  'booking_created',
  'booking_rescheduled',
  'booking_cancelled',
  'complaint_logged',
  'maintenance_logged',
  'followup_sent',
  'handover',
]);

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function computeKpis(db: Db, f: Filters): Kpis {
  const d = filterDb(db, f);
  const today = startOfToday();

  const status: Record<RequestStatus, number> = { solved: 0, open: 0, needs_followup: 0, unsolved: 0 };
  for (const r of d.requests) if (r.status in status) status[r.status]++;

  const languageSplit: Record<Language, number> = { en: 0, ar: 0, mixed: 0 };
  for (const c of d.calls) if (c.language && c.language in languageSplit) languageSplit[c.language]++;

  const countEvents = (t: string) => d.events.filter((e) => e.type === t).length;
  const ratings = d.feedback.map((x) => x.rating);

  return {
    totalCalls: d.calls.length,
    callsToday: d.calls.filter((c) => Date.parse(c.started_at) >= today).length,
    totalRequests: d.requests.length,
    requestsPerCall: d.calls.length ? d.requests.length / d.calls.length : 0,
    status,
    resolutionRate: d.requests.length ? status.solved / d.requests.length : 0,
    callsWithAction: new Set(d.events.filter((e) => ACTION_EVENTS.has(e.type)).map((e) => e.call_id)).size,
    bookingsMade: countEvents('booking_created'),
    bookingsRescheduled: countEvents('booking_rescheduled'),
    bookingsCancelled: countEvents('booking_cancelled'),
    waitingHandovers: d.handovers.filter((h) => h.status === 'waiting').length,
    gapsWaiting: d.knowledge_gaps.filter((g) => g.status === 'waiting').length,
    avgDurationSecs: avg(d.calls.map((c) => c.duration_secs).filter((x): x is number => x != null)),
    avgRating: avg(ratings),
    ratingCount: ratings.length,
    languageSplit,
  };
}

// ---- Live feed ----

/** Noise we don't show in the feed (every request has an outcome event anyway). */
const FEED_HIDDEN = new Set(['call_started', 'intent_detected', 'feedback']);

const TYPE_STATUS: Record<string, RequestStatus> = {
  booking_created: 'solved',
  booking_rescheduled: 'solved',
  booking_cancelled: 'solved',
  docs_listed: 'solved',
  complaint_logged: 'open',
  maintenance_logged: 'open',
  followup_sent: 'needs_followup',
  callback_scheduled: 'needs_followup',
  handover: 'needs_followup',
  kb_miss: 'unsolved',
  error: 'unsolved',
  handover_resolved: 'solved',
};

const TYPE_DETAIL: Record<string, string> = {
  docs_listed: 'documents listed',
  booking_created: 'booking created',
  booking_rescheduled: 'booking rescheduled',
  booking_cancelled: 'booking cancelled',
  handover: 'handed to a human',
  followup_sent: 'follow-up sent',
  callback_scheduled: 'callback scheduled',
  complaint_logged: 'complaint logged',
  maintenance_logged: 'maintenance ticket created',
  kb_miss: "agent didn't know the answer",
  error: 'error',
  handover_resolved: 'resolved by staff',
};

export function buildFeed(db: Db, f: Filters, limit = 50): FeedItem[] {
  const d = filterDb(db, f);
  const callById = new Map(d.calls.map((c) => [c.id, c]));
  const reqById = new Map(d.requests.map((r) => [r.id, r]));
  return d.events
    .filter((e) => !FEED_HIDDEN.has(e.type))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id)
    .slice(0, limit)
    .map((e) => {
      const req = e.payload?.request_id ? reqById.get(e.payload.request_id) : undefined;
      const call = e.call_id ? callById.get(e.call_id) : undefined;
      return {
        id: e.id,
        created_at: e.created_at,
        type: e.type,
        service: e.service,
        call_id: e.call_id,
        language: req?.language ?? call?.language ?? null,
        // Colour by the request's CURRENT status, so the feed updates when it ages into follow-up.
        status: req?.status ?? TYPE_STATUS[e.type] ?? 'open',
        detail: (typeof e.payload?.detail === 'string' && e.payload.detail) || TYPE_DETAIL[e.type] || e.type,
      };
    });
}

export function buildCallDetail(db: Db, callId: string): CallDetail | null {
  const call = db.calls.find((c) => c.id === callId);
  if (!call) return null;
  const mine = <T extends { call_id: string | null }>(rows: T[]) => rows.filter((r) => r.call_id === callId);
  return {
    call,
    requests: db.requests.filter((r) => r.call_id === callId || r.thread?.calls.includes(callId)),
    events: mine(db.events).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    bookings: mine(db.bookings),
    handovers: mine(db.handovers),
    feedback: mine(db.feedback),
  };
}

// ---- Conversations (ElevenLabs transcripts) ----

export const turnText = (t: TranscriptTurn) => t.message ?? t.text ?? '';

export function buildConversations(db: Db, f: Filters, query = '', limit = 150): ConversationRow[] {
  const d = filterDb(db, f);
  const q = query.trim().toLowerCase();
  const reqsByCall = new Map<string, Db['requests']>();
  for (const r of d.requests) {
    for (const id of new Set([r.call_id, ...(r.thread?.calls ?? [])])) {
      if (!id) continue;
      const list = reqsByCall.get(id) ?? [];
      list.push(r);
      reqsByCall.set(id, list);
    }
  }
  const ratingByCall = new Map(d.feedback.map((x) => [x.call_id, x.rating]));
  const rows: ConversationRow[] = [];
  for (const c of [...d.calls].sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))) {
    const turns = c.transcript ?? [];
    let snippet = turnText(turns.find((t) => t.role === 'user') ?? { role: 'user' }) || c.summary || '';
    if (q) {
      const hit = turns.find((t) => turnText(t).toLowerCase().includes(q));
      if (hit) snippet = turnText(hit);
      else if (!(c.summary ?? '').toLowerCase().includes(q)) continue;
    }
    const reqs = reqsByCall.get(c.id) ?? [];
    rows.push({
      id: c.id,
      started_at: c.started_at,
      channel: c.channel,
      language: c.language,
      status: c.status,
      duration_secs: c.duration_secs,
      summary: c.summary,
      turnCount: turns.length,
      services: [...new Set(reqs.map((r) => r.service))],
      statuses: reqs.map((r) => r.status),
      rating: ratingByCall.get(c.id) ?? null,
      snippet,
      caller_name: c.caller_name ?? null,
      direction: c.direction,
      outbound_reason: c.outbound_reason ?? null,
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

export function buildLatestCall(db: Db, f: Filters): CallDetail | null {
  const d = filterDb(db, f);
  let latest: Db['calls'][number] | undefined;
  for (const c of d.calls) if (!latest || Date.parse(c.started_at) > Date.parse(latest.started_at)) latest = c;
  return latest ? buildCallDetail(db, latest.id) : null;
}

/** Demo follow-up threshold (real: 2 days): open requests older than this need a follow-up. */
export const FOLLOWUP_THRESHOLD_MS = 2 * 60 * 1000;

// ---- Handover alert: who is this caller, and what happened with them before? ----

const phoneKey = (v: string | null | undefined) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length >= 6 ? d.slice(-7) : ''; // 050 1234567 and +971 50 1234567 are the same person
};
const nameKey = (v: string | null | undefined) => {
  const n = String(v ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return n.length >= 3 ? n : '';
};

/** Name and contact for a handover: from the handover itself, else from its call, its context, or rows in the same call. */
function callerOf(db: Db, h: Handover): { name: string | null; contact: string | null } {
  const call = h.call_id ? db.calls.find((c) => c.id === h.call_id) : undefined;
  const sameCall = h.call_id ? db.requests.find((r) => r.call_id === h.call_id && r.contact)?.contact : null;
  const booking = h.call_id ? db.bookings.find((b) => b.call_id === h.call_id) : undefined;
  const fromContext = h.context?.match(/^([^(—]+?)\s*\(([^)]+)\)/);
  return {
    // All of these come from THIS call; nothing is borrowed from earlier calls on the same number.
    name: h.caller_name || call?.caller_name || booking?.customer_name || fromContext?.[1]?.trim() || null,
    contact: h.contact || call?.phone || sameCall || booking?.contact || fromContext?.[2]?.trim() || null,
  };
}

export function buildHandoverAlert(db: Db, handoverId: string): HandoverAlert | null {
  const handover = db.handovers.find((h) => h.id === handoverId);
  if (!handover) return null;
  const call = handover.call_id ? db.calls.find((c) => c.id === handover.call_id) ?? null : null;
  const { name, contact } = callerOf(db, handover);
  const pk = phoneKey(contact);
  const nk = nameKey(name);
  const isThem = (c: string | null | undefined, n: string | null | undefined) => (!!pk && phoneKey(c) === pk) || (!!nk && nameKey(n) === nk);

  // Their calls: any call where a row carries their number/name, or the call itself carries their name.
  const callIds = new Set<string>();
  for (const r of db.requests) if (r.call_id && isThem(r.contact, null)) callIds.add(r.call_id);
  for (const b of db.bookings) if (b.call_id && isThem(b.contact, b.customer_name)) callIds.add(b.call_id);
  for (const h of db.handovers) if (h.call_id && isThem(h.contact, h.caller_name)) callIds.add(h.call_id);
  for (const c of db.calls) if (isThem(c.phone, c.caller_name)) callIds.add(c.id);
  if (handover.call_id) callIds.delete(handover.call_id); // "before": not the call happening now

  const items: CallerHistory['items'] = [];
  const seen = new Set<string>();
  for (const r of db.requests) {
    const mine = (r.call_id && callIds.has(r.call_id)) || (r.thread?.calls ?? []).some((id) => callIds.has(id)) || isThem(r.contact, null);
    if (!mine || r.call_id === handover.call_id || seen.has(r.id)) continue;
    seen.add(r.id);
    items.push({
      at: r.created_at,
      kind: 'request',
      title: serviceLabel(r.service),
      detail: r.question,
      status: r.status,
      call_id: r.call_id,
      complaint: r.service === 'complaint',
    });
  }
  for (const b of db.bookings) {
    if (!isThem(b.contact, b.customer_name) && !(b.call_id && callIds.has(b.call_id))) continue;
    items.push({
      at: b.created_at,
      kind: 'booking',
      title: `${serviceLabel(b.service)} · ${b.id}`,
      detail: `${b.status === 'cancelled' ? 'Cancelled' : 'Appointment'} ${new Date(b.slot_at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`,
      status: null,
      call_id: b.call_id,
      complaint: false,
    });
  }
  for (const h of db.handovers) {
    if (h.id === handover.id || !(isThem(h.contact, h.caller_name) || (h.call_id && callIds.has(h.call_id)))) continue;
    items.push({
      at: h.created_at,
      kind: 'handover',
      title: `Handed to a person · ${h.reason.replace(/_/g, ' ')}`,
      detail: h.context,
      status: h.status === 'resolved' ? 'solved' : 'needs_followup',
      call_id: h.call_id,
      complaint: h.reason === 'fee_dispute' || h.reason === 'upset_caller',
    });
  }
  items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const calls = db.calls
    .filter((c) => callIds.has(c.id))
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .map((c) => ({ id: c.id, at: c.started_at, channel: c.channel, summary: c.summary }));

  return { handover, call, history: { name, contact, calls, items } };
}

// ---- "How the day went": outcomes, caller satisfaction, and the shape of the day ----

export interface DayStats {
  outcomes: Record<RequestStatus, number>;
  satisfaction: { positive: number; neutral: number; negative: number; notMeasured: number };
  /** Average of numeric sentiment scores, when the source gives them. */
  avgScore: number | null;
  /** Requests per hour of day (or per day for multi-day periods), stacked by outcome. */
  timeline: ({ label: string } & Record<RequestStatus, number>)[];
  byDay: boolean;
}

export function buildDayStats(db: Db, f: Filters): DayStats {
  const d = filterDb(db, f);
  const outcomes: Record<RequestStatus, number> = { solved: 0, open: 0, needs_followup: 0, unsolved: 0 };
  for (const r of d.requests) outcomes[r.status]++;

  const satisfaction = { positive: 0, neutral: 0, negative: 0, notMeasured: 0 };
  const scores: number[] = [];
  for (const c of d.calls) {
    if (c.mood) satisfaction[c.mood.label]++;
    else satisfaction.notMeasured++;
    if (c.mood?.score != null) scores.push(c.mood.score);
  }

  // One day: by hour. Longer: by day.
  const times = d.requests.map((r) => Date.parse(r.created_at));
  const span = times.length ? Math.max(...times) - Math.min(...times) : 0;
  const byDay = f.range !== 'today' && span > 24 * 3600e3;
  const buckets = new Map<string, { at: number } & Record<RequestStatus, number>>();
  for (const r of d.requests) {
    const t = new Date(r.created_at);
    const key = byDay ? t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : `${String(t.getHours()).padStart(2, '0')}:00`;
    const at = byDay ? new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime() : t.getHours();
    const b = buckets.get(key) ?? { at, solved: 0, open: 0, needs_followup: 0, unsolved: 0 };
    b[r.status]++;
    buckets.set(key, b);
  }
  const timeline = [...buckets].sort((a, b) => a[1].at - b[1].at).map(([label, { at: _at, ...counts }]) => ({ label, ...counts }));

  return {
    outcomes,
    satisfaction,
    avgScore: scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null,
    timeline,
    byDay,
  };
}
