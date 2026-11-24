// Generates realistic fake calls for mock mode. Mutates the Db it is given.

import type { Rng } from './rng';
import { GAP_QUESTIONS, SERVICES, serviceLabel } from './services';
import type {
  Call,
  CallEvent,
  Channel,
  Db,
  Language,
  RequestStatus,
  Resolution,
  ServiceRequest,
  TranscriptTurn,
  UnsolvedReason,
} from './types';

const NAMES = [
  'Ahmed Al Mansoori', 'Fatima Hassan', 'Priya Nair', 'Omar Khalid', 'Sara Ibrahim', 'John Mathew',
  'Aisha Rahman', 'Rajesh Kumar', 'Layla Saeed', 'Mohammed Yusuf', 'Elena Petrova', 'Hassan Ali',
];
const COMPANIES = ['Nexa Robotics FZCO', 'ByteBridge Tech', 'Oasis AI Labs', 'GreenGrid FZCO', null, null];

let seq = 0;
const id = (prefix: string) => `${prefix}_${(++seq).toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
let eventSeq = 0;

const iso = (ms: number) => new Date(ms).toISOString();
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const slotLabel = (ms: number) => {
  const d = new Date(ms);
  return `${WEEKDAY[d.getDay()]} ${hhmm(d)}`;
};

/** Next working-day slot (Mon–Fri, 08:00–14:30) 1–5 days after `fromMs`. */
function nextSlot(rng: Rng, fromMs: number): number {
  const d = new Date(fromMs);
  d.setDate(d.getDate() + rng.int(1, 5));
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(rng.int(8, 14), rng.pick([0, 30]), 0, 0);
  return d.getTime();
}

export type OutcomeMix = readonly (readonly [RequestStatus, number])[];
export const MIX_PAST: OutcomeMix = [['solved', 66], ['needs_followup', 11], ['unsolved', 18], ['open', 5]];
export const MIX_TODAY: OutcomeMix = [['solved', 56], ['open', 20], ['needs_followup', 8], ['unsolved', 16]];

interface Ctx {
  rng: Rng;
  db: Db;
}

function pushEvent(db: Db, callId: string, atMs: number, type: string, service: string | null, payload: CallEvent['payload'] = {}) {
  db.events.push({ id: ++eventSeq, call_id: callId, created_at: iso(atMs), type, service, payload });
}

function recordGap(db: Db, rng: Rng, service: string, language: 'en' | 'ar', atMs: number): string {
  const candidates = GAP_QUESTIONS.filter((g) => g.service === service);
  const src = candidates.length ? rng.pick(candidates) : rng.pick(GAP_QUESTIONS);
  const existing = db.knowledge_gaps.find((g) => g.question === src.question);
  if (existing) {
    existing.times_asked++;
    if (atMs > Date.parse(existing.last_asked_at)) existing.last_asked_at = iso(atMs);
    if (atMs < Date.parse(existing.first_asked_at)) existing.first_asked_at = iso(atMs);
  } else {
    db.knowledge_gaps.push({
      id: id('gap'),
      question: src.question,
      service: src.service,
      language: src.language ?? language,
      times_asked: 1,
      first_asked_at: iso(atMs),
      last_asked_at: iso(atMs),
      status: 'waiting',
      answer_en: null,
      answer_ar: null,
      answered_by: null,
      answered_at: null,
      times_used: 0,
    });
  }
  return src.question;
}

const AGENT_HELLO = {
  en: "Hello, I'm HALA, Dubai Silicon Oasis's AI concierge. How can I help you today?",
  ar: 'مرحباً، أنا هالة، المساعدة الذكية لواحة دبي للسيليكون. كيف يمكنني مساعدتك؟',
};

function agentReply(lang: 'en' | 'ar', resolution: Resolution, detail: string): string {
  const en: Record<Resolution, string> = {
    booked: `Done — you're ${detail}. I've sent the document list by SMS.`,
    rescheduled: `No problem, your appointment is ${detail}.`,
    cancelled: 'Your booking has been cancelled.',
    info_given: "Here's what you need. I've also sent the checklist by SMS.",
    task_created: "I've logged this for the team; you'll get an update by SMS.",
    handed_over: "I'll connect you with a colleague who can help with this.",
    unanswered: "I'm sorry, I don't have that information yet.",
  };
  const ar: Record<Resolution, string> = {
    booked: 'تم الحجز، وأرسلت لك قائمة المستندات برسالة نصية.',
    rescheduled: 'تم تغيير موعدك بنجاح.',
    cancelled: 'تم إلغاء الحجز.',
    info_given: 'هذه هي المتطلبات، وأرسلت لك القائمة برسالة نصية.',
    task_created: 'سجلت طلبك للفريق وستصلك رسالة بالتحديثات.',
    handed_over: 'سأحولك إلى زميل يمكنه مساعدتك.',
    unanswered: 'عذراً، لا تتوفر لدي هذه المعلومة حالياً.',
  };
  return lang === 'ar' ? ar[resolution] : en[resolution];
}

/**
 * Add one finished call (1–3 requests) starting at `startMs`.
 * `mix` controls how outcomes are distributed. Returns the call id.
 */
export function addCall({ rng, db }: Ctx, startMs: number, mix: OutcomeMix, now = Date.now()): string {
  const callId = `conv_${id('c')}`;
  const language = rng.weighted<Language>([['en', 55], ['ar', 35], ['mixed', 10]]);
  const channel = rng.weighted<Channel>([['robot', 60], ['phone', 30], ['web', 10]]);
  const callerType = rng.weighted([['resident', 40], ['company_hr', 30], ['pro', 25], ['unknown', 5]] as const);
  const name = rng.pick(NAMES);
  const contact = `+9715${rng.int(0, 9)}${String(rng.int(1000000, 9999999))}`;
  const nReq = rng.weighted([[1, 60], [2, 30], [3, 10]] as const);

  const callLang = (): 'en' | 'ar' => (language === 'mixed' ? rng.pick(['en', 'ar'] as const) : language);
  const transcript: TranscriptTurn[] = [{ role: 'agent', text: AGENT_HELLO[language === 'ar' ? 'ar' : 'en'] }];

  pushEvent(db, callId, startMs, 'call_started', null, { channel });

  const usedServices = new Set<string>();
  let t = startMs + rng.int(15, 40) * 1000;
  let anyBad = false;

  for (let i = 0; i < nReq; i++) {
    let svc = rng.weighted(SERVICES.map((s) => [s, s.weight] as const));
    if (usedServices.has(svc.key)) svc = rng.pick(SERVICES.filter((s) => !usedServices.has(s.key)));
    usedServices.add(svc.key);

    const lang = callLang();
    const reqId = id('req');
    let question = rng.pick(svc.questions[lang]);
    let status = rng.weighted(mix);
    let resolution: Resolution;
    let unsolved: UnsolvedReason | null = null;
    let detail: string;

    pushEvent(db, callId, t, 'intent_detected', svc.key, { request_id: reqId });
    t += rng.int(20, 60) * 1000;

    if (status === 'solved') {
      resolution = svc.bookable
        ? rng.weighted<Resolution>([['booked', 55], ['info_given', 25], ['rescheduled', 12], ['cancelled', 8]])
        : 'info_given';
      if (resolution === 'booked' || resolution === 'rescheduled') {
        const slot = nextSlot(rng, t);
        detail = resolution === 'booked' ? `booked for ${slotLabel(slot)}` : `moved to ${slotLabel(slot)}`;
        db.bookings.push({
          id: id('bk'),
          call_id: callId,
          service: svc.key,
          customer_name: name,
          contact,
          company: rng.pick(COMPANIES),
          slot_at: iso(slot),
          status: resolution === 'booked' ? 'confirmed' : 'rescheduled',
          documents: ['Passport copy', 'Emirates ID', 'Photo'],
          demo_fee_aed: rng.pick([250, 500, 750, 1100]),
          created_at: iso(t),
          updated_at: iso(t),
        });
        pushEvent(db, callId, t, resolution === 'booked' ? 'booking_created' : 'booking_rescheduled', svc.key, {
          request_id: reqId,
          detail,
          slot_at: iso(slot),
        });
      } else if (resolution === 'cancelled') {
        detail = 'booking cancelled';
        pushEvent(db, callId, t, 'booking_cancelled', svc.key, { request_id: reqId, detail });
      } else {
        detail = svc.bookable ? 'documents listed' : 'answered, info sent by SMS';
        pushEvent(db, callId, t, 'docs_listed', svc.key, { request_id: reqId, detail });
      }
    } else if (status === 'open') {
      resolution = 'task_created';
      const kind = svc.key === 'complaint' ? 'complaint' : svc.key === 'maintenance' ? 'maintenance' : 'noc_review';
      detail = kind === 'maintenance' ? 'ticket created, technician pending' : kind === 'complaint' ? 'complaint logged' : 'waiting on documents';
      db.tasks.push({
        id: id('task'),
        call_id: callId,
        kind,
        service: svc.key,
        priority: rng.weighted([['normal', 70], ['high', 25], ['urgent', 5]] as const),
        status: 'open',
        title: `${serviceLabel(svc.key)} — ${name}`,
        details: { request_id: reqId },
        created_at: iso(t),
      });
      const type = kind === 'maintenance' ? 'maintenance_logged' : kind === 'complaint' ? 'complaint_logged' : 'docs_listed';
      pushEvent(db, callId, t, type, svc.key, { request_id: reqId, detail });
    } else if (status === 'needs_followup') {
      resolution = rng.chance(0.5) ? 'handed_over' : 'task_created';
      detail = 'callback promised';
      if (resolution === 'handed_over') {
        db.handovers.push({
          id: id('ho'),
          call_id: callId,
          reason: 'caller_request',
          service: svc.key,
          status: now - t > 2 * 3600e3 ? rng.pick(['resolved', 'picked_up'] as const) : 'waiting',
          context: `${name} (${contact}) — ${question}`,
          created_at: iso(t),
        });
        pushEvent(db, callId, t, 'handover', svc.key, { request_id: reqId, detail: 'handed to a human, callback promised' });
      } else {
        pushEvent(db, callId, t, 'callback_scheduled', svc.key, { request_id: reqId, detail });
      }
    } else {
      anyBad = true;
      unsolved = rng.weighted<UnsolvedReason>([
        ['unknown_answer', 45],
        ['out_of_scope', 20],
        ['fee_dispute', 15],
        ['caller_hung_up', 12],
        ['other', 8],
      ]);
      if (unsolved === 'unknown_answer') {
        question = recordGap(db, rng, svc.key, lang, t);
        resolution = 'unanswered';
        detail = "agent didn't know — sent to Teach";
        pushEvent(db, callId, t, 'kb_miss', svc.key, { request_id: reqId, detail, question });
      } else if (unsolved === 'out_of_scope' || unsolved === 'fee_dispute') {
        resolution = 'handed_over';
        detail = unsolved === 'fee_dispute' ? 'fee dispute → human' : 'out of scope → human';
        db.handovers.push({
          id: id('ho'),
          call_id: callId,
          reason: unsolved,
          service: svc.key,
          status: now - t > 2 * 3600e3 ? rng.pick(['resolved', 'resolved', 'picked_up'] as const) : 'waiting',
          context: `${name} (${contact}) — ${question}`,
          created_at: iso(t),
        });
        pushEvent(db, callId, t, 'handover', svc.key, { request_id: reqId, detail });
      } else {
        resolution = 'unanswered';
        detail = unsolved === 'caller_hung_up' ? 'caller hung up' : 'not resolved';
        pushEvent(db, callId, t, 'error', svc.key, { request_id: reqId, detail });
      }
    }

    transcript.push({ role: 'user', text: question }, { role: 'agent', text: agentReply(lang, resolution, detail) });

    const req: ServiceRequest = {
      id: reqId,
      call_id: callId,
      contact,
      service: svc.key,
      question,
      language: lang,
      status,
      resolution,
      unsolved_reason: unsolved,
      assigned_to: null,
      note: null,
      created_at: iso(t),
      updated_at: iso(t),
    };
    db.requests.push(req);
    t += rng.int(10, 40) * 1000;
  }

  const duration = Math.round((t - startMs) / 1000) + rng.int(10, 40);
  const labels = [...usedServices].map(serviceLabel);
  const call: Call = {
    id: callId,
    agent_id: 'hala_concierge',
    channel,
    started_at: iso(startMs),
    ended_at: iso(startMs + duration * 1000),
    duration_secs: duration,
    language,
    caller_type: callerType,
    status: 'done',
    call_successful: anyBad ? 'failure' : 'success',
    sentiment: anyBad ? rng.pick(['impatient', 'neutral', 'angry']) : rng.pick(['calm', 'neutral', 'calm']),
    summary: `${name} (${callerType.replace('_', ' ')}) asked about ${labels.join(' + ')}.`,
    transcript,
  };
  db.calls.push(call);

  if (rng.chance(0.7)) {
    const rating = anyBad ? rng.int(2, 4) : rng.weighted([[5, 60], [4, 32], [3, 8]] as const);
    db.feedback.push({ id: id('fb'), call_id: callId, rating, comment: null, created_at: iso(t) });
    pushEvent(db, callId, t, 'feedback', null, { rating });
  }
  return callId;
}

/** Build ~7 days of history plus today's calls up to `now`. */
export function seedDb(rng: Rng, now = Date.now()): Db {
  const db: Db = { calls: [], requests: [], events: [], bookings: [], tasks: [], handovers: [], knowledge_gaps: [], feedback: [] };
  const ctx = { rng, db };
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  for (let dayOffset = 7; dayOffset >= 0; dayOffset--) {
    const day = new Date(today);
    day.setDate(day.getDate() - dayOffset);
    const isToday = dayOffset === 0;
    for (let h = 8; h <= 18; h++) {
      const hourStart = new Date(day).setHours(h, 0, 0, 0);
      if (hourStart > now) break;
      // Busier mid-morning, quieter after lunch.
      const base = h >= 9 && h <= 12 ? 5 : h >= 13 && h <= 15 ? 3 : 2;
      const n = rng.int(Math.max(1, base - 2), base + 1);
      for (let i = 0; i < n; i++) {
        const start = hourStart + rng.int(0, 59) * 60e3 + rng.int(0, 59) * 1000;
        if (start > now - 60e3) continue;
        addCall(ctx, start, isToday ? MIX_TODAY : MIX_PAST, now);
      }
    }
  }

  // A few gaps were already answered by an admin (shows the "teach" loop working).
  const answered = [...db.knowledge_gaps].sort((a, b) => b.times_asked - a.times_asked).slice(2, 4);
  for (const g of answered) {
    g.status = 'answered';
    g.answer_en = 'Yes — see the DSO e-services portal for the exact steps. [DEMO]';
    g.answered_by = 'admin@dso';
    g.answered_at = new Date(now - 3600e3).toISOString();
    g.times_used = rng.int(1, 6);
  }

  // Older open tasks are done by now.
  for (const task of db.tasks) if (now - Date.parse(task.created_at) > 24 * 3600e3) task.status = 'done';

  return db;
}

