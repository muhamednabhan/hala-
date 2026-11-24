// Admin actions applied to the in-memory mock Db. Same effects supabaseSource applies to the real tables.

import { serviceLabel } from './services';
import type { GapAnswer, RequestPatch } from './source';
import type { Booking, Db } from './types';

const nowIso = () => new Date().toISOString();

export function createMockActions(db: Db, notify: () => void) {
  let eventId = db.events.reduce((m, e) => Math.max(m, e.id), 0);

  const addEvent = (callId: string | null, type: string, service: string | null, payload: Record<string, unknown>) => {
    db.events.push({ id: ++eventId, call_id: callId, created_at: nowIso(), type, service, payload });
  };

  const find = <T extends { id: string }>(rows: T[], id: string, what: string): T => {
    const row = rows.find((r) => r.id === id);
    if (!row) throw new Error(`${what} not found`);
    return row;
  };

  const done = () => {
    notify();
    return Promise.resolve();
  };

  return {
    updateRequest(id: string, patch: RequestPatch) {
      const r = find(db.requests, id, 'Request');
      Object.assign(r, patch, { updated_at: nowIso() });
      if (patch.status === 'solved' && !r.resolution) r.resolution = 'info_given';
      return done();
    },

    logFollowup(requestId: string, type: 'followup_sent' | 'callback_scheduled', detail: string) {
      const r = find(db.requests, requestId, 'Request');
      addEvent(r.call_id, type, r.service, { request_id: r.id, detail });
      if (r.status === 'open') r.status = 'needs_followup';
      r.updated_at = nowIso();
      return done();
    },

    answerGap(id: string, a: GapAnswer) {
      const g = find(db.knowledge_gaps, id, 'Question');
      Object.assign(g, {
        status: 'answered',
        answer_en: a.answer_en,
        answer_ar: a.answer_ar || null,
        service: a.service,
        answered_by: 'admin',
        answered_at: nowIso(),
      });
      return done();
    },

    setGapStatus(id: string, status: 'waiting' | 'out_of_scope') {
      const g = find(db.knowledge_gaps, id, 'Question');
      g.status = status;
      return done();
    },

    updateHandover(id: string, status: 'picked_up' | 'resolved') {
      const h = find(db.handovers, id, 'Handover');
      h.status = status;
      if (status === 'resolved') {
        for (const r of db.requests)
          if (r.call_id === h.call_id && r.resolution === 'handed_over' && (!h.service || r.service === h.service)) {
            r.status = 'solved';
            r.updated_at = nowIso();
          }
        addEvent(h.call_id, 'handover_resolved', h.service, { detail: `${serviceLabel(h.service)} resolved by staff` });
      }
      return done();
    },

    updateBooking(id: string, patch: { status: Booking['status']; slot_at?: string }) {
      const b = find(db.bookings, id, 'Booking');
      Object.assign(b, patch, { updated_at: nowIso() });
      return done();
    },
  };
}
