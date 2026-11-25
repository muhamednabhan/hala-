// "How the day went": request outcomes (donut), caller satisfaction (donut) and requests through the day
// (stacked bars). Colours validated with the dataviz palette checker (CVD-safe; low-contrast slices are labelled).

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useData, useQuery, type NavTarget } from '../app/DataContext';
import type { RequestStatus } from '../data/types';
import type { WidgetDef } from './types';

// Status = outcome of a request (reserved status colours, always shown with a label).
const OUTCOME: { key: RequestStatus; label: string; color: string }[] = [
  { key: 'solved', label: 'Solved by HALA', color: '#0F8A5F' },
  { key: 'open', label: 'Open (staff task)', color: '#2F6BF6' },
  { key: 'needs_followup', label: 'Needs follow-up', color: '#D99A06' },
  { key: 'unsolved', label: 'Unsolved', color: '#D9363E' },
];
// Satisfaction = polarity: two hues with a neutral grey midpoint; "not measured" is a recessive fill.
const MOOD = [
  { key: 'positive', label: 'Positive', color: '#2F6BF6' },
  { key: 'neutral', label: 'Neutral', color: '#94A1B2' },
  { key: 'negative', label: 'Negative', color: '#E0662B' },
  { key: 'notMeasured', label: 'Not measured', color: '#E3E8EF' },
] as const;

const pct = (n: number, total: number) => (total ? `${Math.round((100 * n) / total)}%` : '—');

function TipBox({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number; color?: string; payload?: { fill?: string } }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-control bg-midnight px-3 py-2 text-xs text-white shadow-xl">
      {label && <div className="mb-1 font-display text-[13px] font-semibold uppercase tracking-wider">{label}</div>}
      {payload
        .filter((p) => (p.value ?? 0) > 0)
        .map((p) => (
          <div key={p.name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: p.color ?? p.payload?.fill }} />
            <span className="text-white/80">{p.name}</span>
            <span className="ml-auto pl-3 font-semibold tabular-nums">{p.value}</span>
          </div>
        ))}
    </div>
  );
}

function Donut({
  title,
  slices,
  centre,
  centreLabel,
  note,
}: {
  title: string;
  slices: { key: string; label: string; color: string; value: number; to?: NavTarget }[];
  centre: string;
  centreLabel: string;
  note?: string;
}) {
  const { navigate } = useData();
  const total = slices.reduce((s, x) => s + x.value, 0);
  const data = slices.filter((s) => s.value > 0);
  return (
    <div className="rounded-card border border-slate-200 p-5">
      <div className="font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-slate-600">{title}</div>
      <div className="mt-2 flex flex-wrap items-center gap-5">
        <div className="relative h-[180px] w-[180px] shrink-0">
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={data.length ? data : [{ key: 'empty', label: 'No data', color: '#E3E8EF', value: 1 }]}
                dataKey="value"
                nameKey="label"
                innerRadius={62}
                outerRadius={86}
                stroke="#FFFFFF"
                strokeWidth={2}
                startAngle={90}
                endAngle={-270}
                isAnimationActive={false}
              >
                {(data.length ? data : [{ key: 'empty', color: '#E3E8EF' }]).map((s) => (
                  <Cell key={s.key} fill={s.color} />
                ))}
              </Pie>
              {data.length > 0 && <Tooltip content={<TipBox />} />}
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
            <div className="font-display text-[34px] font-bold leading-none text-ink">{centre}</div>
            <div className="mt-1 max-w-[100px] text-[11px] leading-tight text-slate-600">{centreLabel}</div>
          </div>
        </div>
        {/* Legend with values: identity is never colour-alone. */}
        <ul className="min-w-[180px] flex-1 space-y-1.5">
          {slices.map((s) => (
            <li key={s.key}>
              <button
                type="button"
                disabled={!s.to}
                onClick={() => s.to && navigate(s.to)}
                className="flex w-full items-center gap-2 rounded-control px-1.5 py-1 text-left text-sm enabled:hover:bg-mist"
              >
                <span className="h-3 w-3 shrink-0 rounded-sm" style={{ background: s.color }} />
                <span className="text-slate-700">{s.label}</span>
                <span className="ml-auto font-semibold tabular-nums text-ink">{s.value}</span>
                <span className="w-10 text-right text-xs tabular-nums text-slate-500">{pct(s.value, total)}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {note && <p className="mt-3 text-xs text-slate-600">{note}</p>}
    </div>
  );
}

function DayChartsView() {
  const { filters } = useData();
  const { data } = useQuery((s, f) => s.getDayStats(f));
  if (!data) return <div className="text-slate-400">Loading…</div>;

  const { outcomes, satisfaction, timeline, byDay, avgScore } = data;
  const totalReq = OUTCOME.reduce((s, o) => s + outcomes[o.key], 0);
  const measured = satisfaction.positive + satisfaction.neutral + satisfaction.negative;
  const period = filters.range === 'today' ? 'today' : filters.range === '7d' ? 'in the last 7 days' : 'in this period';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Donut
          title={`How requests ended ${period}`}
          slices={OUTCOME.map((o) => ({ ...o, value: outcomes[o.key], to: { page: 'requests', status: o.key } }))}
          centre={totalReq ? pct(outcomes.solved, totalReq) : '—'}
          centreLabel="solved by HALA"
        />
        <Donut
          title={`Caller satisfaction ${period}`}
          slices={MOOD.map((m) => ({ ...m, value: satisfaction[m.key] }))}
          centre={measured ? pct(satisfaction.positive, measured) : '—'}
          centreLabel={measured ? 'positive, of calls measured' : 'not measured yet'}
          note={
            measured
              ? `${measured} of ${measured + satisfaction.notMeasured} calls have a sentiment${avgScore != null ? ` · average score ${Math.round(avgScore * 100) / 100}` : ''}.`
              : 'No call has a sentiment yet. It fills in from hala_events.average_sentiment (being added by the agent team), ElevenLabs sentiment, or HALA flagging an upset caller.'
          }
        />
      </div>

      <div className="rounded-card border border-slate-200 p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div className="font-display text-[15px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            Requests {byDay ? 'per day' : 'through the day'}
          </div>
          <div className="flex flex-wrap gap-3 text-xs text-slate-600">
            {OUTCOME.map((o) => (
              <span key={o.key} className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm" style={{ background: o.color }} />
                {o.label}
              </span>
            ))}
          </div>
        </div>
        {timeline.length ? (
          <div className="h-[220px]">
            <ResponsiveContainer>
              <BarChart data={timeline} barCategoryGap="28%" margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#EEF1F5" />
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: '#DFE4EB' }} tick={{ fill: '#5B677D', fontSize: 12 }} />
                <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: '#5B677D', fontSize: 12 }} />
                <Tooltip content={<TipBox />} cursor={{ fill: '#EBF1F9' }} />
                {OUTCOME.map((o, i) => (
                  <Bar
                    key={o.key}
                    dataKey={o.key}
                    name={o.label}
                    stackId="s"
                    fill={o.color}
                    stroke="#FFFFFF"
                    strokeWidth={1}
                    radius={i === OUTCOME.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="py-10 text-center text-sm text-slate-500">No requests in this period.</div>
        )}
      </div>
    </div>
  );
}

const DayCharts: WidgetDef = { id: 'day-charts', title: 'How the day went', size: 'full', Component: DayChartsView };
export default DayCharts;
