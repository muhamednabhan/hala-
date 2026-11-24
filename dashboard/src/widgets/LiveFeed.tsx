import { useData, useQuery } from '../app/DataContext';
import { serviceLabel } from '../data/services';
import { LangBadge, StatusPill } from '../ui/Badges';
import { fmtTime } from '../ui/format';
import { STATUS_META } from '../ui/status';
import type { WidgetDef } from './types';

function LiveFeedView() {
  const { openCall, source } = useData();
  const { data, error } = useQuery((s, f) => s.getLiveFeed(f, 40));

  if (error) return <div className="text-red-400">Couldn't load feed: {error}</div>;
  if (!data) return <div className="text-slate-500">Loading…</div>;
  if (!data.length) return <div className="py-8 text-center text-slate-500">No activity for these filters yet.</div>;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
        {source.mode === 'mock' ? 'Simulated — new call every 5s' : 'Realtime'}
      </div>
      <ul className="max-h-[calc(100vh-14rem)] space-y-1.5 overflow-y-auto pr-1">
        {data.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => item.call_id && openCall(item.call_id)}
              className={`feed-in flex w-full items-center gap-3 rounded-lg border-l-4 bg-slate-800/50 px-3 py-2 text-left transition hover:bg-slate-800 ${STATUS_META[item.status].border}`}
            >
              <span className="shrink-0 font-mono text-sm tabular-nums text-slate-400">{fmtTime(item.created_at)}</span>
              <LangBadge lang={item.language} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-slate-100">{serviceLabel(item.service)}</span>
                <span className="block truncate text-sm text-slate-400" dir="auto">
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

const LiveFeed: WidgetDef = { id: 'live-feed', title: 'Live feed', size: 'sm', Component: LiveFeedView };
export default LiveFeed;
