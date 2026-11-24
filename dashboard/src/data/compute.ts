// Pure functions: raw tables (Db) + filters -> what widgets need.
// Shared by mockSource and supabaseSource so both modes show identical numbers.

import type { CallDetail, Db, FeedItem, Filters, Kpis, Language, RequestStatus } from './types';

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

/** Apply the global filter bar. Calls are filtered first; child rows follow their call. */
export function filterDb(db: Db, f: Filters): Db {
  const start = rangeStart(f.range);
  const calls = db.calls.filter(
    (c) =>
      (start == null || Date.parse(c.started_at) >= start) &&
      (f.channel === 'all' || c.channel === f.channel) &&
      (f.language === 'all' || c.language === f.language),
  );
  const ids = new Set(calls.map((c) => c.id));
  const byCall = <T extends { call_id: string | null }>(rows: T[]) =>
    rows.filter((r) => r.call_id != null && ids.has(r.call_id));
  return {
    calls,
    requests: byCall(db.requests),
    events: byCall(db.events),
    bookings: byCall(db.bookings),
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
    requests: mine(db.requests),
    events: mine(db.events).sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    bookings: mine(db.bookings),
    handovers: mine(db.handovers),
    feedback: mine(db.feedback),
  };
}
