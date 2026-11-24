// Pattern insights: plain-language findings computed from whatever data has been collected.
// Same function for mock and live, so the pitch shows real patterns once the robot is talking.

import { filterDb } from './compute';
import { serviceLabel } from './services';
import type { Db, Filters, Insight, InsightTone, ServiceRequest, UnsolvedReason } from './types';

const pct = (a: number, b: number) => (b ? Math.round((100 * a) / b) : 0);
const solvedRate = (rs: ServiceRequest[]) => pct(rs.filter((r) => r.status === 'solved').length, rs.length);

function groupBy<T>(rows: T[], key: (r: T) => string | null | undefined) {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    if (k == null) continue;
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

function topEntry(counts: Map<string, number>): [string, number] | null {
  let best: [string, number] | null = null;
  for (const e of counts) if (!best || e[1] > best[1]) best = e;
  return best;
}

const REASON_LABEL: Record<UnsolvedReason, string> = {
  unknown_answer: "the agent didn't know the answer",
  out_of_scope: 'out of scope',
  fee_dispute: 'fee disputes',
  caller_hung_up: 'caller hung up',
  other: 'other reasons',
};

const REASON_FIX: Record<UnsolvedReason, string> = {
  unknown_answer: 'Answering the top questions in “Teach the agent” fixes this; each answer is reused on the next call.',
  out_of_scope: 'Route these directly to a human, or widen the agent’s scope for the most common ones.',
  fee_dispute: 'Publish clearer fee guidance (DEMO figures) so callers know what to expect before calling.',
  caller_hung_up: 'Shorten answers and confirm the next step earlier in the call.',
  other: 'Review these transcripts for a common thread.',
};

const MIN_N = 5;
const TONE_ORDER: InsightTone[] = ['critical', 'warning', 'positive', 'info'];

export function computeInsights(db: Db, f: Filters): Insight[] {
  const d = filterDb(db, f);
  const reqs = d.requests;
  if (reqs.length < MIN_N) {
    return [
      {
        id: 'collecting',
        tone: 'info',
        title: 'Collecting data',
        detail: 'Patterns appear here after a few more conversations.',
      },
    ];
  }
  const out: Insight[] = [];
  const overall = solvedRate(reqs);

  // 1. The most-asked question the agent can't answer yet.
  const gap = d.knowledge_gaps.filter((g) => g.status === 'waiting').sort((a, b) => b.times_asked - a.times_asked)[0];
  if (gap && gap.times_asked >= 2) {
    out.push({
      id: 'top-gap',
      tone: 'critical',
      title: 'Most-asked question with no answer',
      quote: gap.question,
      detail: `Asked ${gap.times_asked} times (${serviceLabel(gap.service)}). One admin answer lets the agent resolve it on every future call.`,
      metric: `${gap.times_asked}×`,
      to: { page: 'teach', tab: 'waiting' },
    });
  }

  // 2/3. Weakest and strongest service.
  const svc = [...groupBy(reqs, (r) => r.service)]
    .filter(([, rs]) => rs.length >= MIN_N)
    .map(([key, rs]) => ({ key, rs, rate: solvedRate(rs) }));
  if (svc.length >= 2) {
    const worst = svc.reduce((a, b) => (b.rate < a.rate ? b : a));
    const best = svc.reduce((a, b) => (b.rate > a.rate ? b : a));
    if (worst.rate <= overall - 8) {
      const reasons = new Map<string, number>();
      for (const r of worst.rs) if (r.status === 'unsolved') reasons.set(r.unsolved_reason ?? 'other', (reasons.get(r.unsolved_reason ?? 'other') ?? 0) + 1);
      const top = topEntry(reasons);
      out.push({
        id: 'weak-service',
        tone: 'warning',
        title: `${serviceLabel(worst.key)} resolves only ${worst.rate}%`,
        detail: `Against ${overall}% overall, across ${worst.rs.length} requests.${top ? ` Main blocker: ${REASON_LABEL[top[0] as UnsolvedReason] ?? top[0]}.` : ''}`,
        metric: `${worst.rate}%`,
        to: { page: 'requests', status: 'all', service: worst.key },
      });
    }
    if (best.key !== worst.key && best.rate >= overall) {
      out.push({
        id: 'strong-service',
        tone: 'positive',
        title: `${serviceLabel(best.key)} is handled end-to-end`,
        detail: `${best.rate}% of ${best.rs.length} requests solved by the agent without staff. It is the strongest service right now.`,
        metric: `${best.rate}%`,
        to: { page: 'requests', status: 'all', service: best.key },
      });
    }
  }

  // 4. Why requests go unsolved.
  const unsolved = reqs.filter((r) => r.status === 'unsolved');
  if (unsolved.length >= 3) {
    const counts = new Map<string, number>();
    for (const r of unsolved) counts.set(r.unsolved_reason ?? 'other', (counts.get(r.unsolved_reason ?? 'other') ?? 0) + 1);
    const top = topEntry(counts)!;
    const reason = (top[0] in REASON_LABEL ? top[0] : 'other') as UnsolvedReason;
    out.push({
      id: 'unsolved-reason',
      tone: 'warning',
      title: `${pct(top[1], unsolved.length)}% of unsolved requests: ${REASON_LABEL[reason]}`,
      detail: REASON_FIX[reason],
      metric: String(top[1]),
      to: reason === 'unknown_answer' ? { page: 'teach', tab: 'waiting' } : { page: 'requests', status: 'unsolved' },
    });
  }

  // 5. Arabic vs English service quality.
  const ar = reqs.filter((r) => r.language === 'ar');
  const en = reqs.filter((r) => r.language === 'en');
  if (ar.length >= MIN_N && en.length >= MIN_N) {
    const ra = solvedRate(ar);
    const re = solvedRate(en);
    if (re - ra >= 8) {
      out.push({
        id: 'lang-gap',
        tone: 'warning',
        title: `Arabic callers resolve ${ra}% vs ${re}% in English`,
        detail: 'Add Arabic answers in “Teach the agent” and review Arabic transcripts for misunderstood intents.',
        metric: `−${re - ra} pts`,
      });
    } else if (ra - re >= 8) {
      out.push({
        id: 'lang-gap',
        tone: 'info',
        title: `English callers resolve ${re}% vs ${ra}% in Arabic`,
        detail: 'English answers are lagging; check which English questions end unsolved.',
        metric: `−${ra - re} pts`,
      });
    } else {
      out.push({
        id: 'lang-parity',
        tone: 'positive',
        title: 'Arabic and English callers are served equally',
        detail: `${ra}% resolved in Arabic and ${re}% in English. No language gap.`,
        metric: `${ra}% / ${re}%`,
      });
    }
  }

  // 6. Repeat callers with something still unresolved.
  const callsByContact = groupBy(reqs, (r) => r.contact);
  const repeat = [...callsByContact].filter(([, rs]) => new Set(rs.map((r) => r.call_id)).size >= 2);
  if (repeat.length) {
    const stillOpen = repeat.filter(([, rs]) => rs.some((r) => r.status !== 'solved')).length;
    out.push({
      id: 'repeat-callers',
      tone: stillOpen ? 'warning' : 'info',
      title: `${repeat.length} people called more than once`,
      detail: stillOpen
        ? `${stillOpen} of them still have an open or unsolved request. Following up first would prevent another call.`
        : 'All of their requests are now solved.',
      metric: String(repeat.length),
      to: { page: 'requests', status: 'needs_followup' },
    });
  }

  // 7. Services asked together in the same call.
  const pairs = new Map<string, number>();
  for (const [, rs] of groupBy(reqs, (r) => r.call_id)) {
    const s = [...new Set(rs.map((r) => r.service))].sort();
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      const k = `${s[i]}|${s[j]}`;
      pairs.set(k, (pairs.get(k) ?? 0) + 1);
    }
  }
  const pair = topEntry(pairs);
  if (pair && pair[1] >= 3) {
    const [a, b] = pair[0].split('|');
    out.push({
      id: 'pair',
      tone: 'info',
      title: `${serviceLabel(a)} + ${serviceLabel(b)} are often asked together`,
      detail: `${pair[1]} calls asked for both. The agent can offer the second service proactively.`,
      metric: `${pair[1]} calls`,
    });
  }

  // 8. Peak hour.
  if (d.calls.length >= 10) {
    const hours = new Map<string, number>();
    for (const c of d.calls) {
      const h = String(new Date(c.started_at).getHours());
      hours.set(h, (hours.get(h) ?? 0) + 1);
    }
    const [h, n] = topEntry(hours)!;
    const hh = Number(h);
    out.push({
      id: 'peak',
      tone: 'info',
      title: `Peak demand ${String(hh).padStart(2, '0')}:00–${String(hh + 1).padStart(2, '0')}:00`,
      detail: `${pct(n, d.calls.length)}% of calls land in this hour. Keep a human on standby for handovers then.`,
      metric: `${n} calls`,
    });
  }

  // 9. What an unsolved request costs in satisfaction.
  const rating = new Map(d.feedback.map((x) => [x.call_id, x.rating]));
  const badCalls = new Set(unsolved.map((r) => r.call_id));
  const good: number[] = [];
  const bad: number[] = [];
  for (const [callId, r] of rating) (badCalls.has(callId) ? bad : good).push(r);
  if (good.length >= 3 && bad.length >= 3) {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const diff = avg(good) - avg(bad);
    if (diff >= 0.4) {
      out.push({
        id: 'rating-cost',
        tone: 'info',
        title: `An unsolved request costs ${diff.toFixed(1)} stars`,
        detail: `Callers rate ${avg(good).toFixed(1)}★ when everything is solved and ${avg(bad).toFixed(1)}★ when something isn't.`,
        metric: `−${diff.toFixed(1)}★`,
      });
    }
  }

  return out.sort((a, b) => TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone)).slice(0, 6);
}
