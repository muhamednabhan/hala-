import { useState } from 'react';
import { useData, useQuery } from '../app/DataContext';
import { serviceLabel } from '../data/services';
import type { RequestStatus } from '../data/types';
import { ChannelBadge, LangBadge, OutboundBadge } from '../ui/Badges';
import { fmtDateTime, fmtDuration } from '../ui/format';
import { STATUS_META } from '../ui/status';
import type { WidgetDef } from './types';

function StatusDots({ statuses }: { statuses: RequestStatus[] }) {
  return (
    <span className="flex gap-1">
      {statuses.map((s, i) => (
        <span key={i} title={STATUS_META[s].label} className={`h-2.5 w-2.5 rounded-full ${STATUS_META[s].dot}`} />
      ))}
    </span>
  );
}

function ConversationsView() {
  const { openCall } = useData();
  const [query, setQuery] = useState('');
  const { data, error } = useQuery((s, f) => s.getConversations(f, query));
  const rated = !!data?.some((c) => c.rating != null);

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search what callers and HALA said (English or العربية)…"
          dir="auto"
          className="w-full max-w-lg rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none placeholder:text-slate-400 focus:border-navy-400 focus:ring-2 focus:ring-navy-100"
        />
        {data && <span className="text-sm text-slate-500">{data.length} conversations</span>}
      </div>
      {error && <div className="text-red-700">{error}</div>}
      {!data && !error && <div className="text-slate-400">Loading…</div>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-navy-200 text-left text-[11px] uppercase tracking-[0.12em] text-slate-500">
                <th className="py-2 pr-3 font-semibold">Time</th>
                <th className="py-2 pr-3 font-semibold">Channel</th>
                <th className="py-2 pr-3 font-semibold">Lang</th>
                <th className="py-2 pr-3 font-semibold">Services</th>
                <th className="py-2 pr-3 font-semibold">What was said</th>
                <th className="py-2 pr-3 font-semibold">Outcome</th>
                <th className="py-2 pr-3 text-right font-semibold">Length</th>
                {rated && <th className="py-2 text-right font-semibold">Rating</th>}
              </tr>
            </thead>
            <tbody>
              {data.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => openCall(c.id)}
                  className="cursor-pointer border-b border-slate-100 align-top transition hover:bg-navy-50/60"
                >
                  <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-slate-600">{fmtDateTime(c.started_at)}</td>
                  <td className="py-2.5 pr-3">
                    <ChannelBadge channel={c.channel} />
                    {c.direction === 'outbound' && (
                      <div className="mt-1">
                        <OutboundBadge />
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <LangBadge lang={c.language} />
                  </td>
                  <td className="py-2.5 pr-3 font-medium text-ink">
                    {c.services.map(serviceLabel).join(', ') || <span className="text-slate-400">—</span>}
                    {c.caller_name && <div className="text-xs font-normal text-slate-500">{c.caller_name}</div>}
                  </td>
                  <td className="max-w-[360px] py-2.5 pr-3 text-slate-600">
                    <div className="truncate" dir="auto">
                      {c.snippet}
                    </div>
                    <div className="text-xs text-slate-400">{c.turnCount} lines</div>
                  </td>
                  <td className="py-2.5 pr-3">
                    {c.status === 'in_progress' ? (
                      <span className="text-xs font-semibold text-red-700">● On air</span>
                    ) : (
                      <StatusDots statuses={c.statuses} />
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-600">{fmtDuration(c.duration_secs)}</td>
                  {rated && <td className="py-2.5 text-right text-navy-600">{c.rating ? '★'.repeat(c.rating) : '—'}</td>}
                </tr>
              ))}
            </tbody>
          </table>
          {!data.length && <div className="py-10 text-center text-slate-400">No conversations match.</div>}
        </div>
      )}
    </div>
  );
}

const Conversations: WidgetDef = { id: 'conversations', title: 'All conversations', size: 'full', Component: ConversationsView };
export default Conversations;
