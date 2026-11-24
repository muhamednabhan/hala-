import { buildCallDetail, buildFeed, computeKpis } from './compute';
import { MIX_TODAY, addCall, seedDb } from './mockData';
import { createRng } from './rng';
import type { DataSource } from './source';

/** Demo follow-up threshold (real: 2 days). Open requests older than this become needs_followup. */
export const FOLLOWUP_THRESHOLD_MS = 2 * 60 * 1000;
const TICK_MS = 5000;

export function createMockSource(): DataSource {
  const bootTime = Date.now();
  const rng = createRng(20251125);
  const db = seedDb(rng, bootTime);
  const liveRng = createRng(bootTime); // new calls vary per session
  const listeners = new Set<() => void>();
  let timer: ReturnType<typeof setInterval> | null = null;

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

  const tick = () => {
    const now = Date.now();
    const callId = addCall({ rng: liveRng, db }, now, MIX_TODAY, now);
    endCallAt(callId, now);
    // Age requests created during this session: open too long -> needs follow-up.
    for (const r of db.requests) {
      const created = Date.parse(r.created_at);
      if (r.status === 'open' && created >= bootTime - 5 * 60e3 && now - created > FOLLOWUP_THRESHOLD_MS) {
        r.status = 'needs_followup';
        r.updated_at = new Date(now).toISOString();
      }
    }
    notify();
  };

  return {
    mode: 'mock',
    getKpis: async (f) => computeKpis(db, f),
    getLiveFeed: async (f, limit) => buildFeed(db, f, limit),
    getCall: async (id) => buildCallDetail(db, id),
    subscribe(onChange) {
      listeners.add(onChange);
      if (!timer) timer = setInterval(tick, TICK_MS);
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
