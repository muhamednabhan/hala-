import { describe, expect, it } from 'vitest';
import { buildCallDetail, buildHandoverAlert, computeKpis, filterDb } from './compute';
import { mapTeamData, sentimentLabel } from './teamSource';
import { DEFAULT_FILTERS } from './types';

// Shapes copied from the team's real Supabase rows (24 Nov), contacts made up.
const T0 = Date.parse('2026-11-24T16:00:00Z');
const t = (min: number) => new Date(T0 + min * 60e3).toISOString();
const PHONE = '+971501234567';

const raw = () => ({
  bookings: [
    { ref: 'HALA-1003', serviceId: 'visa_renewal', attendeeName: 'Grian', contact: '050123', date: '2026-11-25', time: '08:30', language: 'en' as const, conversationId: 'robo1', status: 'confirmed' as const, createdAt: t(32), updatedAt: t(32) },
    { ref: 'HALA-1004', serviceId: 'licence_renewal', attendeeName: 'Sara Al Mansoori', contact: PHONE, date: '2026-11-25', time: '10:00', language: 'en' as const, conversationId: 'p1', status: 'cancelled' as const, createdAt: t(37), updatedAt: t(39) },
    { ref: 'HALA-1001', serviceId: 'noc', attendeeName: 'Smoke Test', contact: '0500000000', date: '2026-11-25', time: '09:30', language: 'en' as const, conversationId: 'smoke-sb', status: 'cancelled' as const, createdAt: t(-6), updatedAt: t(-6) },
  ],
  requests: [
    { ref: 'REQ-1001', serviceId: 'maintenance', callerName: 'Omar', contact: '0509', details: 'AC broken', language: 'en' as const, conversationId: 'w1', createdAt: t(50), status: 'done' as const, resolution: 'Fixed' },
  ],
  handovers: [],
  events: [
    { id: 'e0', ts: t(-6), conversationId: 'smoke-sb', type: 'booking_created', data: { ref: 'HALA-1001', service: 'noc', date: '2026-11-25', time: '09:30' } },
    { id: 'e1', ts: t(30.6), conversationId: 'robo1', type: 'service_matched', data: { found: true, query: 'visa renewal', services: ['visa_renewal'] } },
    { id: 'e2', ts: t(32), conversationId: 'robo1', type: 'booking_created', data: { ref: 'HALA-1003', service: 'visa_renewal', date: '2026-11-25', time: '08:30', attendee: 'Grian' } },
    { id: 'e3', ts: t(36.3), type: 'phone_linked', data: { code: 'FK3RGC', phone: '***4567' } },
    { id: 'e4', ts: t(37.4), conversationId: 'p1', type: 'booking_created', data: { ref: 'HALA-1004', service: 'licence_renewal', date: '2026-11-25', time: '10:00', attendee: 'Sara Al Mansoori' } },
    { id: 'e5', ts: t(39.9), conversationId: 'p2', type: 'booking_cancelled', data: { ref: 'HALA-1004' } },
    { id: 'e6', ts: t(50), conversationId: 'w1', type: 'request_logged', data: { ref: 'REQ-1001', service: 'maintenance', summary: 'AC broken' } },
    { id: 'e7', ts: t(51), conversationId: 'w2', type: 'fact_lookup', data: { question: 'Which bus routes serve DSO?', found: false } },
    { id: 'e8', ts: t(52), conversationId: 'w3', type: 'fact_lookup', data: { question: '  which  bus routes serve DSO? ', found: false } },
  ],
  conversations: [],
  details: new Map(),
  robotLogs: [
    { ts: t(30), level: 'info', message: 'connected. agent speaks pcm_16000' },
    { ts: t(30.2), level: 'agent', message: 'Welcome to HALA.' },
    { ts: t(30.4), level: 'user', message: 'Find the nearest Visa renewal spot.' },
    { ts: t(31), level: 'user', message: '...' },
    { ts: t(35), level: 'agent', message: 'Goodbye.' },
    { ts: t(47), level: 'info', message: 'still connected, idle' }, // robot stays connected; the session ended at the last line
  ],
  phoneConvs: [
    { conversation_id: 'p1', phone: PHONE, created_at: t(37.1) },
    { conversation_id: 'p2', phone: PHONE, created_at: t(39.4) },
  ],
  phoneMessages: [{ seq: 1, phone: PHONE, from_who: 'user', kind: 'text', text: 'HALA FK3RGC', duration_sec: null, ts: t(36.2) }],
  rings: [
    { id: 'ring-1', phone: PHONE, reason: 'Appointment HALA-1004 (Licence renewal) on 2026-11-25 at 10:00', opening: 'Hi…', kind: 'appointment_reminder', nudge_key: 'reminder:HALA-1004', status: 'answered', created_at: t(39.2) },
  ],
  contacts: [{ phone: PHONE, name: 'Sara Al Mansoori', language: 'en' }],
  answers: [
    { id: 'a1', question: 'Which bus routes serve DSO?', question_norm: 'which bus routes serve dso?', service_id: null, answer_en: 'F55 (DEMO)', answer_ar: null, status: 'answered' as const, answered_by: 'admin', answered_at: t(60), times_used: 3, created_at: t(60), updated_at: t(60) },
  ],
});

describe('mapTeamData', () => {
  const db = mapTeamData(raw(), { web: '', robot: '' });
  const call = (id: string) => db.calls.find((c) => c.id === id)!;

  it('keeps one case per booking across follow-up and reminder calls', () => {
    const lic = db.requests.filter((r) => r.service === 'licence_renewal');
    expect(lic).toHaveLength(1);
    expect(lic[0].resolution).toBe('cancelled');
    expect(lic[0].thread?.calls).toEqual(['p1', 'p2']);
    expect(lic[0].thread?.steps.map((s) => s.label)).toEqual([
      'Booked for Wed 10:00',
      'HALA called: appointment reminder (answered)',
      'Cancelled',
    ]);
    // Both calls show the case in their detail view.
    expect(buildCallDetail(db, 'p2')!.requests.map((r) => r.id)).toEqual([lic[0].id]);
  });

  it('labels channels from the robot log and the phone tables', () => {
    expect(call('robo1').channel).toBe('robot');
    expect(call('robo1').transcript?.map((x) => x.message)).toEqual(['Welcome to HALA.', 'Find the nearest Visa renewal spot.', 'Goodbye.']);
    expect(call('p1').channel).toBe('phone');
    expect(call('p1').caller_name).toBe('Sara Al Mansoori');
    expect(call('p2')).toMatchObject({ channel: 'phone', direction: 'outbound', outbound_reason: 'Appointment reminder' });
    expect(call('w1').channel).toBe('web');
  });

  it('records the reminder on the booking', () => {
    expect(db.bookings.find((b) => b.id === 'HALA-1004')?.reminder).toEqual({ status: 'answered', at: t(39.2) });
  });

  it('closes tickets from hala_requests.status', () => {
    const ticket = db.requests.find((r) => r.id === 'ticket:REQ-1001')!;
    expect(ticket.status).toBe('solved');
    expect(ticket.note).toBe('Fixed');
  });

  it('groups the same unanswered question and merges the admin answer', () => {
    expect(db.knowledge_gaps).toHaveLength(1);
    expect(db.knowledge_gaps[0]).toMatchObject({ times_asked: 2, status: 'answered', answer_en: 'F55 (DEMO)', times_used: 3 });
  });

  it('hides the team smoke tests by default', () => {
    const shown = filterDb(db, DEFAULT_FILTERS);
    expect(shown.calls.some((c) => c.id === 'smoke-sb')).toBe(false);
    expect(shown.bookings.some((b) => b.customer_name === 'Smoke Test')).toBe(false);
    expect(filterDb(db, { ...DEFAULT_FILTERS, hideTests: false }).calls.some((c) => c.id === 'smoke-sb')).toBe(true);
    expect(computeKpis(db, { ...DEFAULT_FILTERS, channel: 'phone' }).totalCalls).toBe(2);
  });
});

describe('handover alert', () => {
  it("shows who is calling and their history from earlier calls", () => {
    const r = raw();
    // Later the same day Sara texts about something out of scope and HALA hands over (real row shape).
    r.phoneConvs.push({ conversation_id: 'p3', phone: PHONE, created_at: t(46) });
    (r.events as unknown[]).push({ id: 'e9', ts: t(46.2), conversationId: 'p3', type: 'handover_requested', data: { id: 'HO-1', reason: 'out_of_scope', language: 'en', summary: 'Wants a meeting with a CEO' } });
    (r.handovers as unknown[]).push({ id: 'HO-1', reason: 'out_of_scope', language: 'en', summary: 'Wants a meeting with a CEO', conversationId: 'p3', status: 'open', createdAt: t(46.2) });
    const db = mapTeamData(r, { web: '', robot: '' });
    const alert = buildHandoverAlert(db, 'HO-1')!;
    // No name was given in this call: don't borrow one from the number's saved contact (test numbers are shared).
    expect(alert.history.name).toBeNull();
    expect(alert.history.calls.map((c) => c.id).sort()).toEqual(['p1', 'p2']); // earlier calls, not the current one
    expect(alert.history.items.map((i) => i.title)).toContain('Licence renewal · HALA-1004');
    expect(alert.history.items.some((i) => i.kind === 'request' && i.title === 'Licence renewal')).toBe(true);
    expect(alert.history.items.some((i) => i.title.includes('Employment visa'))).toBe(false); // Grian's, not hers
  });
});

describe('caller names', () => {
  it('never puts an earlier caller\'s name on a new call from the same number', () => {
    const r = raw();
    // 18:45: a different person (a man) calls from the shared test number Sara used earlier; he gives no name.
    r.phoneConvs.push({ conversation_id: 'p9', phone: PHONE, created_at: t(165) });
    (r.events as unknown[]).push({ id: 'e20', ts: t(165.5), conversationId: 'p9', type: 'service_matched', data: { found: true, query: 'noc', services: ['noc'] } });
    const db = mapTeamData(r, { web: '', robot: '' });
    expect(db.calls.find((c) => c.id === 'p9')?.caller_name ?? null).toBeNull();
    expect(db.calls.find((c) => c.id === 'p1')?.caller_name).toBe('Sara Al Mansoori'); // she gave it in that call (booking)
  });
});

describe('sentiment', () => {
  it('reads the score on whichever scale the agent uses', () => {
    expect([0.6, 0, -0.7].map(sentimentLabel)).toEqual(['positive', 'neutral', 'negative']); // -1..1
    expect([5, 3, 1.5].map(sentimentLabel)).toEqual(['positive', 'neutral', 'negative']); // 1..5
    expect([80, 50, 10].map(sentimentLabel)).toEqual(['positive', 'neutral', 'negative']); // 0..100
  });

  it('puts hala_events.average_sentiment on the call (latest value wins)', () => {
    const r = raw();
    (r.events as unknown[]).push(
      { id: 's1', ts: t(37.5), conversationId: 'p1', type: 'service_matched', data: {}, averageSentiment: -0.5 },
      { id: 's2', ts: t(38), conversationId: 'p1', type: 'service_matched', data: {}, averageSentiment: 0.7 },
    );
    const db = mapTeamData(r, { web: '', robot: '' });
    expect(db.calls.find((c) => c.id === 'p1')?.mood).toMatchObject({ label: 'positive', source: 'agent', score: 0.7 });
    expect(db.calls.find((c) => c.id === 'w1')?.mood ?? null).toBeNull(); // no score, no guess
  });
});
