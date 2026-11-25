// Admin actions applied to the in-memory mock Db. Same effects supabaseSource applies to the real tables.

import { serviceLabel } from './services';
import type { GapAnswer, RequestPatch } from './source';
import type { Db } from './types';

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

    addKnowledge(e: GapAnswer & { question: string }) {
      const now = nowIso();
      const existing = db.knowledge_gaps.find((g) => g.question.trim().toLowerCase() === e.question.trim().toLowerCase());
      const fields = { status: 'answered' as const, answer_en: e.answer_en, answer_ar: e.answer_ar || null, service: e.service, answered_by: 'admin', answered_at: now };
      if (existing) Object.assign(existing, fields);
      else
        db.knowledge_gaps.push({
          id: `gap_new_${Date.now()}`, question: e.question.trim(), language: /[\u0600-\u06FF]/.test(e.question) ? 'ar' : 'en',
          times_asked: 0, first_asked_at: now, last_asked_at: now, times_used: 0, ...fields,
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

    updateBooking(id: string, patch: { status: 'cancelled' | 'rescheduled'; slot_at?: string }) {
      const b = find(db.bookings, id, 'Booking');
      Object.assign(b, patch, { updated_at: nowIso() });
      return done();
    },
  };
}
