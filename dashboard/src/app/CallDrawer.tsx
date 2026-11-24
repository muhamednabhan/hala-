// Call detail: summary, requests, ElevenLabs transcript. Events timeline comes in build step 7.

import { useEffect, useState } from 'react';
import { serviceLabel } from '../data/services';
import type { CallDetail } from '../data/types';
import { LangBadge, StatusPill } from '../ui/Badges';
import { fmtDateTime, fmtDuration } from '../ui/format';
import { Transcript } from '../ui/Transcript';
import { useData } from './DataContext';

export function CallDrawer({ callId, onClose }: { callId: string; onClose: () => void }) {
  const { source, version } = useData();
  const [detail, setDetail] = useState<CallDetail | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    source.getCall(callId).then((d) => alive && setDetail(d));
    return () => {
      alive = false;
    };
  }, [source, callId, version]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rating = detail?.feedback[0]?.rating;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]" onClick={onClose} />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-2xl">
        <div className="h-1 bg-gradient-to-r from-gold-700 via-gold-400 to-gold-700" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1 text-2xl leading-none text-stone-400 hover:bg-stone-100 hover:text-ink"
        >
          ×
        </button>
        <div className="scroll-quiet flex-1 overflow-y-auto p-6">
          {detail === undefined && <div className="text-stone-400">Loading…</div>}
          {detail === null && <div className="text-stone-500">Call not found.</div>}
          {detail && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gold-700">Conversation</div>
                <h2 className="mt-1 pr-8 font-display text-2xl font-bold text-ink">{detail.call.summary ?? 'Call in progress'}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-stone-500">
                  <LangBadge lang={detail.call.language} />
                  <span>{fmtDateTime(detail.call.started_at)}</span>
                  <span>· {fmtDuration(detail.call.duration_secs)}</span>
                  <span className="capitalize">· {detail.call.channel}</span>
                  {rating != null && <span className="text-gold-600">· {'★'.repeat(rating)}</span>}
                </div>
                <div className="mt-1 font-mono text-[11px] text-stone-400">{detail.call.id}</div>
              </div>

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  Requests in this call ({detail.requests.length})
                </h3>
                <ul className="space-y-2">
                  {detail.requests.map((r) => (
                    <li key={r.id} className="rounded-lg border border-stone-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{serviceLabel(r.service)}</span>
                        <StatusPill status={r.status} />
                      </div>
                      {r.question && (
                        <div className="mt-1 text-sm text-stone-600" dir="auto">
                          “{r.question}”
                        </div>
                      )}
                      <div className="mt-1 text-xs capitalize text-stone-400">
                        {r.resolution?.replace(/_/g, ' ')}
                        {r.unsolved_reason ? ` · ${r.unsolved_reason.replace(/_/g, ' ')}` : ''}
                      </div>
                    </li>
                  ))}
                  {!detail.requests.length && <li className="text-sm text-stone-400">No requests logged yet.</li>}
                </ul>
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                  Transcript (ElevenLabs)
                </h3>
                <Transcript turns={detail.call.transcript ?? []} />
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
