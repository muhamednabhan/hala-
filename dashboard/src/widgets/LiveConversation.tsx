import { useData, useQuery } from '../app/DataContext';
import { serviceLabel } from '../data/services';
import { LangBadge, StatusPill } from '../ui/Badges';
import { fmtDuration, fmtTime } from '../ui/format';
import { Transcript } from '../ui/Transcript';
import type { WidgetDef } from './types';

/** The robot's current (or most recent) conversation, transcript streaming in from ElevenLabs. */
function LiveConversationView() {
  const { openCall } = useData();
  const { data, error } = useQuery((s, f) => s.getLatestCall(f));
  if (error) return <div className="text-red-700">Couldn't load conversation: {error}</div>;
  if (data === undefined) return <div className="text-stone-400">Loading…</div>;
  if (!data) return <div className="py-8 text-center text-stone-400">No conversations yet.</div>;

  const { call, requests } = data;
  const live = call.status === 'in_progress';

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-stone-500">
        {live ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700 ring-1 ring-red-200">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" /> On air
          </span>
        ) : (
          <span className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-600">Ended</span>
        )}
        <LangBadge lang={call.language} />
        <span className="tabular-nums">{fmtTime(call.started_at)}</span>
        {!live && <span>· {fmtDuration(call.duration_secs)}</span>}
        <span className="capitalize">· {call.channel}</span>
        <button
          type="button"
          onClick={() => openCall(call.id)}
          className="ml-auto text-xs font-semibold uppercase tracking-wider text-gold-700 hover:text-gold-900"
        >
          Details →
        </button>
      </div>
      {requests.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2">
          {requests.map((r) => (
            <span key={r.id} className="inline-flex items-center gap-2 rounded-md border border-stone-200 px-2 py-1 text-xs">
              <span className="font-medium text-ink">{serviceLabel(r.service)}</span>
              <StatusPill status={r.status} />
            </span>
          ))}
        </div>
      )}
      <Transcript turns={call.transcript ?? []} maxHeight="420px" autoScroll />
    </div>
  );
}

const LiveConversation: WidgetDef = {
  id: 'live-conversation',
  title: 'Live conversation',
  size: 'md',
  Component: LiveConversationView,
};
export default LiveConversation;
