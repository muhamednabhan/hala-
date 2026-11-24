import { useQuery } from '../app/DataContext';
import type { InsightTone } from '../data/types';
import type { WidgetDef } from './types';

const TONE: Record<InsightTone, { label: string; chip: string; bar: string; metric: string }> = {
  critical: { label: 'Action needed', chip: 'bg-red-50 text-red-700 ring-red-200', bar: 'bg-red-600', metric: 'text-red-700' },
  warning: { label: 'Watch', chip: 'bg-amber-50 text-amber-800 ring-amber-200', bar: 'bg-amber-500', metric: 'text-amber-700' },
  positive: { label: 'Working well', chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200', bar: 'bg-emerald-600', metric: 'text-emerald-700' },
  info: { label: 'Pattern', chip: 'bg-gold-50 text-gold-800 ring-gold-200', bar: 'bg-gold-500', metric: 'text-gold-700' },
};

function InsightsView() {
  const { data, error } = useQuery((s, f) => s.getInsights(f));
  if (error) return <div className="text-red-700">Couldn't compute insights: {error}</div>;
  if (!data) return <div className="text-stone-400">Analysing…</div>;

  return (
    <ul className="space-y-2.5">
      {data.map((i) => {
        const t = TONE[i.tone];
        return (
          <li key={i.id} className="relative flex gap-4 overflow-hidden rounded-lg border border-stone-200 bg-white py-3 pl-5 pr-4">
            <span className={`absolute inset-y-0 left-0 w-[3px] ${t.bar}`} />
            <div className="min-w-0 flex-1">
              <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ring-1 ${t.chip}`}>
                {t.label}
              </span>
              <div className="mt-1.5 text-[15px] font-semibold leading-snug text-ink">{i.title}</div>
              {i.quote && (
                <div className="mt-1 border-l-2 border-gold-300 pl-2.5 text-sm italic text-stone-700" dir="auto">
                  “{i.quote}”
                </div>
              )}
              <div className="mt-1 text-[13px] leading-relaxed text-stone-500">{i.detail}</div>
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

const Insights: WidgetDef = { id: 'insights', title: 'Pattern insights', size: 'md', Component: InsightsView };
export default Insights;
