// A short card when a call ends: what it was about, how it ended, and how the caller felt (when measured).
// Bottom-left, so it never covers the handover pop-up (bottom-right). Follows the Alerts switch.

import { useEffect, useRef, useState } from 'react';
import { serviceLabel } from '../data/services';
import type { Call, Db, RequestStatus } from '../data/types';
import { ChannelBadge, DemoTag, MoodBadge, StatusPill } from '../ui/Badges';
import { fmtDuration } from '../ui/format';
import { useData, useQuery } from './DataContext';
import { alertsEnabled } from './HandoverAlert';

const ALL = { range: 'all', channel: 'all', language: 'all', hideTests: true } as const;
const SHOW_MS = 12_000;

interface Ended {
  call: Call;
  services: string[];
  statuses: RequestStatus[];
  rating: number | null;
}

function summarise(db: Db, call: Call): Ended {
  const reqs = db.requests.filter((r) => r.call_id === call.id || r.thread?.calls.includes(call.id));
  return {
    call,
    services: [...new Set(reqs.map((r) => r.service).filter((s) => s && s !== 'none'))],
    statuses: reqs.map((r) => r.status),
    rating: db.feedback.find((f) => f.call_id === call.id)?.rating ?? null,
  };
}

export function CallEndedCards() {
  const { openCall, source } = useData();
  const { data } = useQuery((s) => s.getSnapshot(ALL));
  const known = useRef<Map<string, string> | null>(null); // call id -> status last seen
  const [card, setCard] = useState<Ended | null>(null);

  useEffect(() => {
    if (!data) return;
    if (!known.current) {
      known.current = new Map(data.calls.map((c) => [c.id, c.status]));
      return;
    }
    let latest: Call | null = null;
    for (const c of data.calls) {
      const before = known.current.get(c.id);
      // Ended now: was in progress, or appeared already finished since the page opened.
      if (c.status === 'done' && before !== 'done' && (!latest || Date.parse(c.started_at) > Date.parse(latest.started_at))) latest = c;
      known.current.set(c.id, c.status);
    }
    if (latest && alertsEnabled()) setCard(summarise(data, latest));
  }, [data]);

  useEffect(() => {
    if (!card) return;
    const t = setTimeout(() => setCard(null), SHOW_MS);
    return () => clearTimeout(t);
  }, [card]);

  if (!card) return null;
  const { call, services, statuses, rating } = card;
  return (
    <div className="fixed bottom-5 left-5 z-[75] w-[360px] max-w-[calc(100vw-2.5rem)] md:left-[260px]" role="status">
      <div className="overflow-hidden rounded-card bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-center gap-2 bg-midnight px-4 py-2 text-white">
          {source.mode === 'mock' && <DemoTag />}
          <span className="font-display text-[14px] font-semibold uppercase tracking-[0.14em]">Call ended</span>
          <span className="ml-auto text-xs text-white/70">{fmtDuration(call.duration_secs)}</span>
          <button type="button" onClick={() => setCard(null)} aria-label="Dismiss" className="ml-2 text-lg leading-none opacity-80 hover:opacity-100">
            ×
          </button>
        </div>
        <button type="button" onClick={() => openCall(call.id)} className="block w-full px-4 py-3 text-left hover:bg-mist/50">
          <div className="flex items-center gap-2">
            <ChannelBadge channel={call.channel} />
            <span className="truncate font-semibold text-ink">{services.length ? services.map(serviceLabel).join(' + ') : 'General enquiry'}</span>
          </div>
          {call.caller_name && <div className="mt-0.5 text-sm text-slate-600">{call.caller_name}</div>}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {statuses.length ? statuses.map((s, i) => <StatusPill key={i} status={s} />) : <span className="text-xs text-slate-500">No request logged</span>}
          </div>
          <div className="mt-2 flex items-center gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600">
            <span className="font-display text-[12px] font-semibold uppercase tracking-[0.12em]">Caller felt</span>
            <MoodBadge mood={call.mood} />
            {rating != null && <span className="font-medium text-ink">· rated {rating}/5</span>}
          </div>
        </button>
      </div>
    </div>
  );
}
