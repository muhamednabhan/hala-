import { buildCallDetail, buildConversations, buildDayStats, buildFeed, buildHandoverAlert, buildLatestCall, computeKpis, filterDb } from './compute';
import { createMockActions } from './mockActions';
import { computeInsights } from './insights';
import { MIX_TODAY, addCall, seedDb } from './mockData';
import { createRng } from './rng';
import type { DataSource } from './source';
import type { TranscriptTurn } from './types';

/** Demo follow-up threshold (real: 2 days). Open requests older than this become needs_followup. */
export const FOLLOWUP_THRESHOLD_MS = 2 * 60 * 1000;
const STEP_MS = 1000; // transcript lines stream in once per second
const CALL_EVERY_STEPS = 5; // a new call every 5s

export function createMockSource(): DataSource {
  const bootTime = Date.now();
  const rng = createRng(20251125);
  const db = seedDb(rng, bootTime);
  const liveRng = createRng(bootTime); // new calls vary per session
  const listeners = new Set<() => void>();
  /** Calls still "on air": transcript lines not yet spoken. */
  const streaming = new Map<string, TranscriptTurn[]>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let steps = 0;

  const notify = () => listeners.forEach((fn) => fn());

  /** Shift a freshly generated call back in time so its last event lands at `now` (newest on top of the feed). */
  const endCallAt = (callId: string, now: number) => {
    const last = Math.max(...db.events.filter((e) => e.call_id === callId).map((e) => Date.parse(e.created_at)));
    const delta = last - now;
    if (!(delta > 0)) return;
    const shift = (row: Record<string, unknown>, keys: string[]) => {
      for (const k of keys) {
        const v = row[k];
        if (typeof v === 'string') row[k] = new Date(Date.parse(v) - delta).toISOString();
      }
    };
    const keys = ['created_at', 'updated_at', 'started_at', 'ended_at'];
    for (const c of db.calls) if (c.id === callId) shift(c as unknown as Record<string, unknown>, keys);
    for (const table of [db.events, db.requests, db.bookings, db.tasks, db.handovers, db.feedback])
      for (const row of table) if (row.call_id === callId) shift(row as unknown as Record<string, unknown>, keys);
    for (const g of db.knowledge_gaps) if (Date.parse(g.last_asked_at) > now) g.last_asked_at = new Date(now).toISOString();
  };

  const newCall = (now: number) => {
    const callId = addCall({ rng: liveRng, db }, now, MIX_TODAY, now);
    endCallAt(callId, now);
    const call = db.calls.find((c) => c.id === callId);
    if (call?.transcript?.length) {
      streaming.set(callId, call.transcript.slice(1));
      call.transcript = call.transcript.slice(0, 1);
      call.status = 'in_progress';
    }
    // Age requests created during this session: open too long -> needs follow-up.
    for (const r of db.requests) {
      const created = Date.parse(r.created_at);
      if (r.status === 'open' && created >= bootTime - 5 * 60e3 && now - created > FOLLOWUP_THRESHOLD_MS) {
        r.status = 'needs_followup';
        r.updated_at = new Date(now).toISOString();
      }
    }
  };

  const speakNextLines = () => {
    for (const [callId, rest] of streaming) {
      const call = db.calls.find((c) => c.id === callId);
      const next = rest.shift();
      if (call && next) call.transcript = [...(call.transcript ?? []), next];
      if (!rest.length) {
        if (call) call.status = 'done';
        streaming.delete(callId);
      }
    }
  };

  const step = () => {
    steps++;
    if (steps % CALL_EVERY_STEPS === 0) newCall(Date.now());
    speakNextLines();
    notify();
  };

  const actions = createMockActions(db, notify);

  return {
    mode: 'mock',
    ...actions,
    getSnapshot: async (f) => filterDb(db, f),
    getKpis: async (f) => computeKpis(db, f),
    getLiveFeed: async (f, limit) => buildFeed(db, f, limit),
    getCall: async (id) => buildCallDetail(db, id),
    getInsights: async (f) => computeInsights(db, f),
    getConversations: async (f, q) => buildConversations(db, f, q),
    getDayStats: async (f) => buildDayStats(db, f),
    getHandoverAlert: async (id) => buildHandoverAlert(db, id),
    getLatestCall: async (f) => buildLatestCall(db, f),
    subscribe(onChange) {
      listeners.add(onChange);
      if (!timer) timer = setInterval(step, STEP_MS);
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0 && timer) {
          clearInterval(timer);
          timer = null;
        }
      };
    },
  };
}
