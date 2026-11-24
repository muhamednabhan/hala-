import { useData, useQuery } from '../app/DataContext';
import { serviceLabel } from '../data/services';
import { LangBadge, StatusPill } from '../ui/Badges';
import { fmtTime } from '../ui/format';
import { STATUS_META } from '../ui/status';
import type { WidgetDef } from './types';

function LiveFeedView() {
  const { openCall, source } = useData();
  const { data, error } = useQuery((s, f) => s.getLiveFeed(f, 40));

  if (error) return <div className="text-red-700">Couldn't load feed: {error}</div>;
  if (!data) return <div className="text-slate-400">Loading…</div>;
  if (!data.length) return <div className="py-8 text-center text-slate-400">No activity for these filters yet.</div>;

  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs text-slate-500">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600" />
        </span>
        {source.mode === 'mock' ? 'Simulated: a new call every 5 seconds' : 'Realtime from the robot'}
      </div>
      <ul className="scroll-quiet max-h-[560px] divide-y divide-slate-100 overflow-y-auto pr-1">
        {data.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => item.call_id && openCall(item.call_id)}
              className={`feed-in flex w-full items-center gap-3 border-l-[3px] px-3 py-2.5 text-left transition hover:bg-navy-50/60 ${STATUS_META[item.status].border}`}
            >
              <span className="w-11 shrink-0 text-sm tabular-nums text-slate-500">{fmtTime(item.created_at)}</span>
              <LangBadge lang={item.language} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-ink">{serviceLabel(item.service)}</span>
                <span className="block text-[13px] leading-snug text-slate-500" dir="auto">
                  {item.detail}
                </span>
              </span>
              <StatusPill status={item.status} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const LiveFeed: WidgetDef = { id: 'live-feed', title: 'Live activity', size: 'md', Component: LiveFeedView };
export default LiveFeed;
