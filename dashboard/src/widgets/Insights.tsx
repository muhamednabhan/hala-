import { useData, useQuery } from '../app/DataContext';
import type { InsightTone } from '../data/types';
import type { WidgetDef } from './types';

const TONE: Record<InsightTone, { label: string; chip: string; bar: string; metric: string }> = {
  critical: { label: 'Action needed', chip: 'bg-red-50 text-red-700 ring-red-200', bar: 'bg-red-600', metric: 'text-red-700' },
  warning: { label: 'Watch', chip: 'bg-amber-50 text-amber-800 ring-amber-200', bar: 'bg-amber-500', metric: 'text-amber-700' },
  positive: { label: 'Working well', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-600', metric: 'text-emerald-700' },
  info: { label: 'Pattern', chip: 'bg-navy-50 text-navy-800 ring-navy-200', bar: 'bg-navy-500', metric: 'text-navy-700' },
};

function InsightsView() {
  const { navigate } = useData();
  const { data, error } = useQuery((s, f) => s.getInsights(f));
  if (error) return <div className="text-red-700">Couldn't compute insights: {error}</div>;
  if (!data) return <div className="text-slate-400">Analysing…</div>;

  return (
    <ul className="space-y-2.5">
      {data.map((i) => {
        const t = TONE[i.tone];
        return (
          <li
            key={i.id}
            onClick={() => i.to && navigate(i.to)}
            className={`relative flex gap-4 overflow-hidden rounded-lg border border-slate-200 bg-white py-3 pl-5 pr-4 ${
              i.to ? 'cursor-pointer transition hover:border-navy-300 hover:shadow-card' : ''
            }`}
          >
            <span className={`absolute inset-y-0 left-0 w-[3px] ${t.bar}`} />
            <div className="min-w-0 flex-1">
              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${t.chip}`}>
                {t.label}
              </span>
              <div className="mt-1.5 text-[15px] font-semibold leading-snug text-ink">{i.title}</div>
              {i.quote && (
                <div className="mt-1 border-l-2 border-navy-300 pl-2.5 text-sm italic text-slate-700" dir="auto">
                  “{i.quote}”
                </div>
              )}
              <div className="mt-1 text-[13px] leading-relaxed text-slate-500">{i.detail}</div>
            </div>
            {i.metric && (
              <div className={`shrink-0 self-center text-right text-2xl font-semibold tabular-nums ${t.metric}`}>{i.metric}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const Insights: WidgetDef = { id: 'insights', title: 'Pattern insights', size: 'full', Component: InsightsView };
export default Insights;
