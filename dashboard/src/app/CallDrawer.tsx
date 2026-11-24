// Minimal call detail so the live feed click works now. Full drawer (events timeline etc.) is build step 7.

import { useEffect, useState } from 'react';
import { serviceLabel } from '../data/services';
import type { CallDetail } from '../data/types';
import { LangBadge, StatusPill } from '../ui/Badges';
import { fmtDateTime, fmtDuration } from '../ui/format';
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
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto bg-slate-900 p-6 shadow-2xl ring-1 ring-slate-800">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 text-2xl text-slate-400 hover:text-white">
          ×
        </button>
        {detail === undefined && <div className="text-slate-500">Loading…</div>}
        {detail === null && <div className="text-slate-400">Call not found.</div>}
        {detail && (
          <div className="space-y-6">
            <div>
              <div className="font-mono text-xs text-slate-500">{detail.call.id}</div>
              <h2 className="mt-1 text-xl font-bold">{detail.call.summary ?? 'Call'}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-slate-400">
                <LangBadge lang={detail.call.language} />
                <span>{fmtDateTime(detail.call.started_at)}</span>
                <span>· {fmtDuration(detail.call.duration_secs)}</span>
                <span>· {detail.call.channel}</span>
                {rating != null && <span className="text-yellow-300">· {rating} ★</span>}
              </div>
            </div>

            <section>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Requests in this call ({detail.requests.length})
              </h3>
              <ul className="space-y-2">
                {detail.requests.map((r) => (
                  <li key={r.id} className="rounded-lg bg-slate-800/60 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{serviceLabel(r.service)}</span>
                      <StatusPill status={r.status} />
                    </div>
                    <div className="mt-1 text-sm text-slate-300" dir="auto">
                      “{r.question}”
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      {r.resolution?.replace(/_/g, ' ')}
                      {r.unsolved_reason ? ` · ${r.unsolved_reason.replace(/_/g, ' ')}` : ''}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            {detail.call.transcript && (
              <section>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">Transcript</h3>
                <div className="space-y-2">
                  {detail.call.transcript.map((t, i) => (
                    <div
                      key={i}
                      dir="auto"
                      className={`rounded-lg px-3 py-2 text-sm ${
                        t.role === 'agent' ? 'bg-slate-800 text-slate-200' : 'ml-8 bg-indigo-500/15 text-indigo-100'
                      }`}
                    >
                      <span className="mr-2 text-xs font-bold uppercase text-slate-500">{t.role === 'agent' ? 'HALA' : 'Caller'}</span>
                      {t.text}
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </aside>
    </div>
  );
}
