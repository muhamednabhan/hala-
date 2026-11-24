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
  accent = 'border-t-stone-200',
  valueClass = 'text-ink',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  valueClass?: string;
}) {
  return (
    <div className={`rounded-lg border border-stone-200 border-t-[3px] bg-white px-4 py-3.5 ${accent}`}>
      <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">{label}</div>
      <div className={`mt-1 text-[34px] font-semibold leading-tight tabular-nums ${valueClass}`}>{value}</div>
      {sub != null && <div className="mt-0.5 text-[13px] text-stone-500">{sub}</div>}
    </div>
  );
}

function LanguageSplit({ split }: { split: Kpis['languageSplit'] }) {
  const total = split.en + split.ar + split.mixed;
  const parts = [
    { key: 'English', n: split.en, cls: 'bg-indigo-500' },
    { key: 'Arabic', n: split.ar, cls: 'bg-teal-600' },
    { key: 'Mixed', n: split.mixed, cls: 'bg-gold-400' },
  ];
  return (
    <div className="rounded-lg border border-stone-200 bg-white px-4 py-3.5">
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">Language split</div>
        <div className="flex gap-4 text-[13px] tabular-nums text-stone-600">
          {parts.map((p) => (
            <span key={p.key}>
              <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${p.cls}`} />
              {p.key} <b className="text-ink">{fmtPct(p.n, total)}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-stone-100">
        {parts.map((p) => (
          <div key={p.key} className={p.cls} style={{ width: total ? `${(100 * p.n) / total}%` : 0 }} />
        ))}
      </div>
    </div>
  );
}

function KpiCardsView() {
  const { data: k, error } = useQuery((s, f) => s.getKpis(f));
  if (error) return <div className="text-red-700">Couldn't load metrics: {error}</div>;
  if (!k) return <div className="text-stone-400">Loading…</div>;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="col-span-2 rounded-lg border border-gold-300 bg-gradient-to-br from-gold-50 via-white to-white px-5 py-4 lg:col-span-1">
          <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-gold-700">Resolution rate</div>
          <div className="mt-1 text-6xl font-semibold tabular-nums leading-none text-emerald-700">
            {k.totalRequests ? `${Math.round(k.resolutionRate * 100)}%` : '—'}
          </div>
          <div className="mt-2 text-[13px] text-stone-600">
            {fmtInt(k.status.solved)} of {fmtInt(k.totalRequests)} requests solved by HALA
          </div>
        </div>
        <Card label="Total calls" value={fmtInt(k.totalCalls)} sub={`${fmtInt(k.callsToday)} today`} />
        <Card label="Total requests" value={fmtInt(k.totalRequests)} sub={`${k.requestsPerCall.toFixed(2)} per call`} />
        <Card
          label="Calls with an action"
          value={fmtInt(k.callsWithAction)}
          sub={`${fmtPct(k.callsWithAction, k.totalCalls)} booked, tasked or handed over`}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {STATUS_ORDER.map((s) => (
          <Card
            key={s}
            label={STATUS_META[s].label}
            value={fmtInt(k.status[s])}
            valueClass={STATUS_META[s].text}
            accent={STATUS_META[s].border.replace('border-', 'border-t-')}
            sub={`${fmtPct(k.status[s], k.totalRequests, 1)} of requests`}
          />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card
          label="Bookings made"
          value={fmtInt(k.bookingsMade)}
          sub={`${fmtInt(k.bookingsRescheduled)} rescheduled · ${fmtInt(k.bookingsCancelled)} cancelled`}
        />
        <Card
          label="Handovers waiting"
          value={fmtInt(k.waitingHandovers)}
          valueClass={k.waitingHandovers ? 'text-amber-700' : 'text-ink'}
          accent={k.waitingHandovers ? 'border-t-amber-500' : 'border-t-stone-200'}
          sub="a staff member is needed now"
        />
        <Card
          label="Knowledge gaps"
          value={fmtInt(k.gapsWaiting)}
          valueClass="text-gold-700"
          accent="border-t-gold-500"
          sub="questions waiting for an answer"
        />
        <Card
          label="Caller rating"
          value={
            k.avgRating != null ? (
              <>
                {k.avgRating.toFixed(2)}
                <span className="ml-1 text-2xl text-gold-500">★</span>
              </>
            ) : (
              '—'
            )
          }
          sub={`${fmtInt(k.ratingCount)} ratings · avg call ${fmtDuration(k.avgDurationSecs)}`}
        />
      </div>

      <LanguageSplit split={k.languageSplit} />
    </div>
  );
}

// Explicit class list so Tailwind keeps the derived border-t-* colours.
// border-t-emerald-600 border-t-blue-600 border-t-amber-500 border-t-red-600

const KpiCards: WidgetDef = { id: 'kpi-cards', title: 'Service performance', size: 'lg', Component: KpiCardsView };
export default KpiCards;
