import type { ReactNode } from 'react';
import { useData, useQuery, type NavTarget } from '../app/DataContext';
import type { Kpis } from '../data/types';
import { fmtDuration, fmtInt, fmtPct } from '../ui/format';
import { STATUS_META, STATUS_ORDER } from '../ui/status';
import type { WidgetDef } from './types';

function Card({
  label,
  value,
  sub,
  accent = '',
  valueClass = 'text-navy-900',
  to,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  valueClass?: string;
  /** Clicking the card opens these items (e.g. Requests filtered to "Open"). */
  to?: NavTarget;
}) {
  const { navigate } = useData();
  const body = (
    <>
      <div className="flex items-center justify-between font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-slate-600">
        {label}
        {to && <span className="text-lg leading-none text-signal opacity-0 transition group-hover:opacity-100" aria-hidden>→</span>}
      </div>
      <div className={`mt-1 font-display text-[44px] font-semibold leading-none tabular-nums ${valueClass}`}>{value}</div>
      {sub != null && <div className="mt-2 text-[13px] text-slate-600">{sub}</div>}
    </>
  );
  const cls = `group rounded-card border border-slate-200 bg-white px-5 py-4 text-left ${accent}`;
  return to ? (
    <button type="button" onClick={() => navigate(to)} className={`${cls} transition hover:border-navy-300 hover:shadow-card focus:outline-none focus-visible:ring-2 focus-visible:ring-signal`}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function LanguageSplit({ split }: { split: Kpis['languageSplit'] }) {
  const total = split.en + split.ar + split.mixed;
  const parts = [
    { key: 'English', n: split.en, cls: 'bg-navy-600' },
    { key: 'Arabic', n: split.ar, cls: 'bg-signal' },
    { key: 'Mixed', n: split.mixed, cls: 'bg-cyan' },
  ];
  return (
    <div className="h-full rounded-card border border-slate-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-slate-600">Language split</div>
        <div className="flex gap-4 text-[13px] tabular-nums text-slate-600">
          {parts.map((p) => (
            <span key={p.key}>
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${p.cls}`} />
              {p.key} <b className="text-ink">{fmtPct(p.n, total)}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-mist">
        {parts.map((p) => (
          <div key={p.key} className={p.cls} style={{ width: total ? `${(100 * p.n) / total}%` : 0 }} />
        ))}
      </div>
    </div>
  );
}

/** "The Link" from the design system: nodes joined by a bar. Here: share of requests HALA solved. */
function TheLink({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="relative mt-5 h-3" aria-hidden>
      <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/20" />
      <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-cyan" style={{ width: `${pct}%` }} />
      <span className="absolute left-0 top-0 h-3 w-6 rounded-full bg-cyan" />
      <span className="absolute top-0 h-3 w-6 -translate-x-1/2 rounded-full bg-white" style={{ left: `${Math.max(6, Math.min(94, pct))}%` }} />
      <span className="absolute right-0 top-0 h-3 w-6 rounded-full bg-white/40" />
    </div>
  );
}

function AgentPanel({ k, live }: { k: Kpis; live: boolean }) {
  const { navigate } = useData();
  const totalLang = k.languageSplit.en + k.languageSplit.ar + k.languageSplit.mixed;
  const Stat = ({ value, label, onClick, accent }: { value: string; label: string; onClick: () => void; accent?: boolean }) => (
    <button type="button" onClick={onClick} className="group text-left">
      <div className={`font-display text-[52px] font-semibold leading-none tabular-nums ${accent ? 'text-cyan' : 'text-white'}`}>{value}</div>
      <div className="mt-1.5 text-[13px] text-white/70 group-hover:text-white">{label} →</div>
    </button>
  );
  return (
    <div className="rounded-card bg-midnight px-7 py-6 text-white shadow-card">
      <div className="mb-5 flex items-center justify-between">
        <h3 className="font-display text-[26px] font-bold leading-tight">HALA AI agent</h3>
        <span className="flex items-center gap-1.5 text-sm text-cyan">
          <span className="h-2 w-2 rounded-full bg-cyan" />
          {live ? 'Live' : 'Demo'}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-6 lg:grid-cols-4">
        <Stat value={fmtInt(k.totalCalls)} label="conversations (robot, phone, web)" onClick={() => navigate({ page: 'conversations' })} />
        <Stat
          value={k.totalRequests ? `${Math.round(k.resolutionRate * 100)}%` : '—'}
          label="resolved by HALA, no person needed"
          accent
          onClick={() => navigate({ page: 'requests', status: 'solved' })}
        />
        <Stat value={fmtPct(k.languageSplit.ar + k.languageSplit.mixed, totalLang)} label="in Arabic" onClick={() => navigate({ page: 'conversations' })} />
        <Stat value={fmtDuration(k.avgDurationSecs).replace('m ', ':').replace('s', '')} label="average call (min:sec)" onClick={() => navigate({ page: 'conversations' })} />
      </div>
      <TheLink value={k.resolutionRate} />
    </div>
  );
}

function KpiCardsView() {
  const { source } = useData();
  const { data: k, error } = useQuery((s, f) => s.getKpis(f));
  if (error) return <div className="text-red-700">Couldn't load metrics: {error}</div>;
  if (!k) return <div className="text-slate-400">Loading…</div>;

  return (
    <div className="space-y-3">
      <AgentPanel k={k} live={source.mode === 'live'} />
      {/* Row 1: what needs a person now */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Handovers waiting"
          value={fmtInt(k.waitingHandovers)}
          valueClass={k.waitingHandovers ? 'text-amber-700' : 'text-navy-900'}
          accent={k.waitingHandovers ? 'border-amber-300 bg-amber-50/40' : ''}
          sub="a staff member is needed now"
          to={{ page: 'handovers', tab: 'waiting' }}
        />
        <Card
          label="Needs follow-up"
          value={fmtInt(k.status.needs_followup)}
          valueClass={STATUS_META.needs_followup.text}
          sub="waiting on DSO"
          to={{ page: 'followups', tab: 'due' }}
        />
        <Card
          label="Knowledge gaps"
          value={fmtInt(k.gapsWaiting)}
          valueClass="text-signal"
          sub="questions waiting for an answer"
          to={{ page: 'teach', tab: 'waiting' }}
        />
        <Card
          label="Bookings made"
          value={fmtInt(k.bookingsMade)}
          sub={`${fmtInt(k.bookingsRescheduled)} moved · ${fmtInt(k.bookingsCancelled)} cancelled`}
          to={{ page: 'bookings', tab: 'upcoming' }}
        />
      </div>

      {/* Row 2: every request by status */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUS_ORDER.map((s) => (
          <Card
            key={s}
            label={STATUS_META[s].label}
            value={fmtInt(k.status[s])}
            valueClass={STATUS_META[s].text}
            sub={`${fmtPct(k.status[s], k.totalRequests, 1)} of ${fmtInt(k.totalRequests)} requests`}
            to={{ page: 'requests', status: s }}
          />
        ))}
      </div>

      {/* Row 3: volume */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Calls with an action"
          value={fmtInt(k.callsWithAction)}
          sub={`${fmtPct(k.callsWithAction, k.totalCalls)} booked, ticketed or handed over`}
          to={{ page: 'conversations' }}
        />
        <Card label="Calls today" value={fmtInt(k.callsToday)} sub={`${fmtInt(k.totalCalls)} in this period`} to={{ page: 'conversations' }} />
        {/* Ratings only exist when callers were asked for one (ElevenLabs feedback). */}
        {k.ratingCount > 0 && (
          <Card
            label="Caller rating"
            value={k.avgRating!.toFixed(2)}
            sub={`out of 5 · ${fmtInt(k.ratingCount)} ratings`}
            to={{ page: 'conversations' }}
          />
        )}
        <div className={k.ratingCount > 0 ? '' : 'col-span-2'}>
          <LanguageSplit split={k.languageSplit} />
        </div>
      </div>
    </div>
  );
}

// Explicit class list so Tailwind keeps the derived border-t-* colours.
// border-t-emerald-600 border-t-blue-600 border-t-amber-500 border-t-red-600

const KpiCards: WidgetDef = { id: 'kpi-cards', title: 'Service performance', size: 'full', Component: KpiCardsView };
export default KpiCards;
