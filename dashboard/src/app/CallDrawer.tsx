// Call detail: summary, requests, ElevenLabs transcript. Events timeline comes in build step 7.

import { useEffect, useState } from 'react';
import { serviceLabel } from '../data/services';
import type { CallDetail } from '../data/types';
import { ChannelBadge, LangBadge, MoodBadge, OutboundBadge, StatusPill } from '../ui/Badges';
import { fmtDateTime, fmtDuration } from '../ui/format';
import { Transcript } from '../ui/Transcript';
import { useData } from './DataContext';

/** The ElevenLabs conversation id, out of the way: only needed to look the call up in ElevenLabs. */
function CopyId({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={id}
      onClick={() => {
        navigator.clipboard?.writeText(id).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => undefined,
        );
      }}
      className="mt-2 text-[11px] font-medium text-slate-400 underline-offset-2 hover:text-navy-700 hover:underline"
    >
      {copied ? '✓ Copied' : 'Copy call ID'}
    </button>
  );
}

export function CallDrawer({ callId, onClose }: { callId: string; onClose: () => void }) {
  const { source, version, openCall } = useData();
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
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 rounded-full p-1 text-2xl leading-none text-slate-400 hover:bg-slate-100 hover:text-ink"
        >
          ×
        </button>
        <div className="scroll-quiet flex-1 overflow-y-auto p-6">
          {detail === undefined && <div className="text-slate-400">Loading…</div>}
          {detail === null && <div className="text-slate-500">Call not found.</div>}
          {detail && (
            <div className="space-y-6">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-navy-700">Conversation</div>
                <h2 className="mt-1 pr-8 font-display text-[30px] font-bold leading-tight text-ink">{detail.call.summary ??
                    (detail.requests.length
                      ? [...new Set(detail.requests.map((r) => serviceLabel(r.service)))].join(' + ')
                      : detail.call.status === 'in_progress'
                        ? 'Call in progress'
                        : 'Conversation')}</h2>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                  <ChannelBadge channel={detail.call.channel} />
                  {detail.call.direction === 'outbound' && <OutboundBadge reason={detail.call.outbound_reason} />}
                  <LangBadge lang={detail.call.language} />
                  {detail.call.caller_name && <span className="font-medium text-ink">{detail.call.caller_name}</span>}
                  <span>{fmtDateTime(detail.call.started_at)}</span>
                  <span>· {fmtDuration(detail.call.duration_secs)}</span>
                  {rating != null && <span className="text-navy-600">· {'★'.repeat(rating)}</span>}
                </div>
                <CopyId id={detail.call.id} />
              </div>

              <section className="rounded-card bg-mist/60 px-4 py-3">
                <h3 className="mb-1.5 font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-slate-600">How the caller felt</h3>
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <MoodBadge mood={detail.call.mood} />
                  {rating != null && <span className="font-medium text-ink">Rated {rating}/5</span>}
                  <span className="text-xs text-slate-600">
                    {detail.call.mood
                      ? detail.call.mood.detail
                      : 'HALA doesn’t ask for a rating yet. ElevenLabs sentiment shows here once its key is connected.'}
                  </span>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Requests in this call ({detail.requests.length})
                </h3>
                <ul className="space-y-2">
                  {detail.requests.map((r) => (
                    <li key={r.id} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{serviceLabel(r.service)}</span>
                        <StatusPill status={r.status} />
                      </div>
                      {r.question && (
                        <div className="mt-1 text-sm text-slate-600" dir="auto">
                          “{r.question}”
                        </div>
                      )}
                      <div className="mt-1 text-xs capitalize text-slate-400">
                        {r.resolution?.replace(/_/g, ' ')}
                        {r.unsolved_reason ? ` · ${r.unsolved_reason.replace(/_/g, ' ')}` : ''}
                      </div>
                      {r.thread && r.thread.calls.length > 1 && (
                        <div className="mt-2 rounded-md bg-navy-50/70 px-3 py-2 ring-1 ring-navy-200">
                          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-navy-800">
                            Same case across {r.thread.calls.length} calls · {r.thread.key}
                          </div>
                          <ol className="space-y-1">
                            {r.thread.steps.map((s, i) => (
                              <li key={i} className="flex items-center gap-2 text-xs text-slate-600">
                                <span className="tabular-nums text-slate-400">{fmtDateTime(s.at)}</span>
                                <span className="font-medium text-ink">{s.label}</span>
                                {s.call_id && s.call_id !== callId ? (
                                  <button type="button" onClick={() => openCall(s.call_id!)} className="ml-auto font-semibold text-navy-700 hover:text-navy-900">
                                    open call →
                                  </button>
                                ) : (
                                  <span className="ml-auto text-slate-400">this call</span>
                                )}
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                    </li>
                  ))}
                  {!detail.requests.length && <li className="text-sm text-slate-400">No requests logged yet.</li>}
                </ul>
              </section>

              {detail.call.analysis && detail.call.analysis.evaluation.length > 0 && (
                <section>
                  <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                    ElevenLabs evaluation
                  </h3>
                  <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {detail.call.analysis.evaluation.map((e) => (
                      <li key={e.id} title={e.rationale} className="flex items-center gap-2 rounded-md border border-slate-200 px-2.5 py-1.5 text-sm">
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                            e.result === 'success' ? 'bg-emerald-50 text-emerald-700' : e.result === 'failure' ? 'bg-red-50 text-red-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {e.result === 'success' ? '✓' : e.result === 'failure' ? '✗' : '?'}
                        </span>
                        <span className="text-slate-700">{e.name}</span>
                      </li>
                    ))}
                  </ul>
                  {Object.keys(detail.call.analysis.data).length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                      {Object.entries(detail.call.analysis.data).map(([k, v]) => (
                        <span key={k} className="rounded bg-slate-100 px-2 py-0.5">
                          {k.replace(/_/g, ' ')}: <b className="text-ink">{v || '—'}</b>
                        </span>
                      ))}
                    </div>
                  )}
                </section>
              )}

              <section>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Transcript
                </h3>
                <Transcript
                  turns={detail.call.transcript ?? []}
                  emptyText={detail.call.status === 'in_progress' ? undefined : 'No transcript for this call yet. Phone and web transcripts appear once the ElevenLabs key is connected.'}
                />
              </section>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
