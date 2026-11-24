import type { ReactNode } from 'react';
import { useQuery } from '../app/DataContext';
import type { Kpis } from '../data/types';
import { fmtDuration, fmtInt, fmtPct } from '../ui/format';
import { STATUS_META, STATUS_ORDER } from '../ui/status';
import type { WidgetDef } from './types';

function Card({
  label,
  value,
  sub,
  accent = 'border-slate-700',
  valueClass = 'text-slate-50',
  className = '',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  valueClass?: string;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border-l-4 bg-slate-900 p-4 ring-1 ring-slate-800 ${accent} ${className}`}>
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className={`mt-1 text-4xl font-bold tabular-nums leading-tight ${valueClass}`}>{value}</div>
      {sub != null && <div className="mt-1 text-sm text-slate-400">{sub}</div>}
    </div>
  );
}

function LanguageSplit({ split }: { split: Kpis['languageSplit'] }) {
  const total = split.en + split.ar + split.mixed;
  const parts = [
    { key: 'EN', n: split.en, cls: 'bg-indigo-500' },
    { key: 'AR', n: split.ar, cls: 'bg-teal-500' },
    { key: 'MIX', n: split.mixed, cls: 'bg-slate-500' },
  ];
  return (
    <div className="rounded-xl border-l-4 border-slate-700 bg-slate-900 p-4 ring-1 ring-slate-800">
      <div className="text-xs font-semibold uppercase tracking-wider text-slate-400">Language split</div>
      <div className="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-800">
        {parts.map((p) => (
          <div key={p.key} className={p.cls} style={{ width: total ? `${(100 * p.n) / total}%` : 0 }} />
        ))}
      </div>
      <div className="mt-3 flex justify-between text-sm tabular-nums">
        {parts.map((p) => (
          <span key={p.key} className="text-slate-300">
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${p.cls}`} />
            <b>{p.key}</b> {fmtPct(p.n, total)}
          </span>
        ))}
      </div>
    </div>
  );
}

function KpiCardsView() {
  const { data: k, error } = useQuery((s, f) => s.getKpis(f));
  if (error) return <div className="text-red-400">Couldn't load metrics: {error}</div>;
  if (!k) return <div className="text-slate-500">Loading…</div>;

  return (
    <div className="space-y-3">
      {/* Headline row */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 rounded-xl border-l-4 border-emerald-500 bg-gradient-to-br from-emerald-500/15 to-slate-900 p-5 ring-1 ring-slate-800 lg:col-span-1 lg:row-span-1">
          <div className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Resolution rate</div>
          <div className="mt-1 text-6xl font-extrabold tabular-nums text-emerald-400">
            {k.totalRequests ? `${Math.round(k.resolutionRate * 100)}%` : '—'}
          </div>
          <div className="mt-1 text-sm text-slate-300">
            {fmtInt(k.status.solved)} of {fmtInt(k.totalRequests)} requests solved by the agent
          </div>
        </div>
        <Card label="Total calls" value={fmtInt(k.totalCalls)} sub={`${fmtInt(k.callsToday)} today`} />
        <Card label="Total requests" value={fmtInt(k.totalRequests)} sub={`${k.requestsPerCall.toFixed(2)} per call`} />
        <Card
          label="Calls → action"
          value={fmtInt(k.callsWithAction)}
          sub={`${fmtPct(k.callsWithAction, k.totalCalls)} booked / task / handover`}
        />
      </div>

      {/* Request status */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUS_ORDER.map((s) => (
          <Card
            key={s}
            label={STATUS_META[s].label}
            value={fmtInt(k.status[s])}
            valueClass={STATUS_META[s].text}
            accent={STATUS_META[s].border}
            sub={`${fmtPct(k.status[s], k.totalRequests, 1)} of requests`}
          />
        ))}
      </div>

      {/* Operations */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Bookings made"
          value={fmtInt(k.bookingsMade)}
          sub={
            <>
              {fmtInt(k.bookingsRescheduled)} rescheduled · {fmtInt(k.bookingsCancelled)} cancelled
            </>
          }
        />
        <Card
          label="Handovers waiting"
          value={fmtInt(k.waitingHandovers)}
          valueClass={k.waitingHandovers ? 'text-amber-400' : 'text-slate-50'}
          accent={k.waitingHandovers ? 'border-amber-500' : 'border-slate-700'}
          sub="human needed now"
        />
        <Card
          label="Knowledge gaps"
          value={fmtInt(k.gapsWaiting)}
          valueClass={k.gapsWaiting ? 'text-violet-300' : 'text-slate-50'}
          accent="border-violet-500"
          sub="waiting for an admin answer"
        />
        <Card
          label="Avg rating"
          value={k.avgRating != null ? `${k.avgRating.toFixed(2)} ★` : '—'}
          valueClass="text-yellow-300"
          sub={`${fmtInt(k.ratingCount)} ratings · avg call ${fmtDuration(k.avgDurationSecs)}`}
        />
      </div>

      <LanguageSplit split={k.languageSplit} />
    </div>
  );
}

const KpiCards: WidgetDef = { id: 'kpi-cards', title: 'Key metrics', size: 'lg', Component: KpiCardsView };
export default KpiCards;
