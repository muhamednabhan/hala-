// Pops up the moment HALA hands a caller over to a person: who it is, why, the live conversation, and what
// happened with this caller before. Staff can pick it up straight from the pop-up.

import { useEffect, useRef, useState } from 'react';
import { turnText } from '../data/compute';
import { HANDOVER_REASON_LABEL, serviceLabel } from '../data/services';
import type { HandoverAlert as Alert } from '../data/types';
import { ChannelBadge, LangBadge, StatusPill } from '../ui/Badges';
import { Button, useAction } from '../ui/controls';
import { fmtAge, fmtDateTime } from '../ui/format';
import { useData, useQuery } from './DataContext';

const ALL = { range: 'all', channel: 'all', language: 'all', hideTests: false } as const;
const KEY = 'hala:handover-alerts';

export function alertsEnabled() {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAlertsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(KEY));
}

/** DSO sonic logo: three rising soft tones, one per node of the mark. Plays on handoff only.
 *  Browsers only allow sound after someone has clicked the page once. */
function chime() {
  try {
    const ctx = new AudioContext();
    [523.25, 659.25, 783.99].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.16;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.4);
    });
  } catch {
    /* no audio: the pop-up is enough */
  }
}

/** Watches for new handovers and shows them one at a time. */
export function HandoverAlerts() {
  const [enabled, setEnabled] = useState(alertsEnabled);
  const { data } = useQuery((s) => s.getSnapshot(ALL));
  const seen = useRef<Set<string> | null>(null);
  const [queue, setQueue] = useState<string[]>([]);

  useEffect(() => {
    const on = () => setEnabled(alertsEnabled());
    window.addEventListener(KEY, on);
    return () => window.removeEventListener(KEY, on);
  }, []);

  useEffect(() => {
    if (!data) return;
    const waiting = data.handovers.filter((h) => h.status === 'waiting');
    // Handovers already waiting when the page opened are on the Handovers page; only NEW ones pop up.
    if (!seen.current) {
      seen.current = new Set(data.handovers.map((h) => h.id));
      return;
    }
    const fresh = waiting.filter((h) => !seen.current!.has(h.id)).map((h) => h.id);
    data.handovers.forEach((h) => seen.current!.add(h.id));
    if (fresh.length && enabled) {
      setQueue((q) => [...q, ...fresh]);
      chime();
    }
  }, [data, enabled]);

  if (!enabled || !queue.length) return null;
  const current = queue[0];
  // Remove THIS handover only: "picked up" closes it twice (button + data refresh), which must not skip the next caller.
  return <AlertCard key={current} id={current} more={queue.length - 1} onClose={() => setQueue((q) => q.filter((x) => x !== current))} />;
}

function AlertCard({ id, more, onClose }: { id: string; more: number; onClose: () => void }) {
  const { source, openCall } = useData();
  const { data } = useQuery<Alert | null>((s) => s.getHandoverAlert(id));
  const { run, busy, banner } = useAction();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000); // live "waiting 0:42"
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Someone else picked it up (or it was resolved): nothing left to alert about.
  useEffect(() => {
    if (data && data.handover.status !== 'waiting') onClose();
  }, [data, onClose]);

  if (!data) return null;
  const { handover: h, call, history } = data;
  const live = call?.status === 'in_progress';
  const lastLines = (call?.transcript ?? []).slice(-4);
  const complaints = history.items.filter((i) => i.complaint).length;
  const openItems = history.items.filter((i) => i.status && i.status !== 'solved').length;

  return (
    <div className="fixed bottom-5 right-5 z-[80] w-[440px] max-w-[calc(100vw-2.5rem)]" role="alertdialog" aria-labelledby="ho-title">
      <div className="overflow-hidden rounded-card bg-white shadow-2xl ring-1 ring-slate-200">
        <div className="flex items-center gap-2 bg-midnight px-4 py-2.5 text-white">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-400" />
          </span>
          <span className="font-display text-[15px] font-semibold uppercase tracking-[0.14em]">Handover requested</span>
          <span className="ml-auto text-xs tabular-nums opacity-90">waiting {fmtAge(h.created_at)}</span>
          <button type="button" onClick={onClose} aria-label="Dismiss" className="ml-2 text-lg leading-none opacity-80 hover:opacity-100">
            ×
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          {banner}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div id="ho-title" className="font-display text-[30px] font-bold leading-tight text-ink">
                {history.name ?? 'Name not given in this call'}
              </div>
              <div className="mt-0.5 text-sm tabular-nums text-slate-500">{history.contact ?? 'no contact collected'}</div>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {call && <ChannelBadge channel={call.channel} />}
              <LangBadge lang={h.language ?? call?.language} />
            </div>
          </div>

          <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-800">
              {HANDOVER_REASON_LABEL[h.reason] ?? h.reason.replace(/_/g, ' ')}
              {h.service && h.service !== 'none' && <span className="font-normal normal-case"> · {serviceLabel(h.service)}</span>}
            </div>
            <div className="mt-0.5 text-sm text-slate-700" dir="auto">
              {h.context?.replace(/^[^—]+—\s*/, '') || 'No summary from HALA.'}
            </div>
          </div>

          {lastLines.length > 0 && (
            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-600" />}
                {live ? 'On the call now' : 'End of the conversation'}
              </div>
              <div className="space-y-1 rounded-lg bg-slate-50 p-2">
                {lastLines.map((t, i) => (
                  <div key={i} className="text-[13px] leading-snug" dir="auto">
                    <span className={`mr-1.5 text-[10px] font-bold uppercase ${t.role === 'agent' ? 'text-navy-700' : 'text-slate-500'}`}>
                      {t.role === 'agent' ? 'HALA' : 'Caller'}
                    </span>
                    {turnText(t)}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">History</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">{history.calls.length} earlier calls from this {history.contact ? 'number' : 'name'}</span>
              {complaints > 0 && <span className="rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-medium text-red-700">{complaints} complaints / disputes</span>}
              {openItems > 0 && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">{openItems} still open</span>}
            </div>
            {history.items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-3 text-center text-xs text-slate-400">
                No earlier calls from this {history.contact ? 'number' : 'name'}.
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {history.items.slice(0, 8).map((it, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      onClick={() => it.call_id && openCall(it.call_id)}
                      className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-navy-50/60"
                    >
                      <span className="w-[76px] shrink-0 text-[11px] tabular-nums text-slate-400">{fmtDateTime(it.at).replace(/^\w+ /, '')}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block text-[13px] font-medium ${it.complaint ? 'text-red-700' : 'text-ink'}`}>{it.title}</span>
                        {it.detail && (
                          <span className="block truncate text-xs text-slate-500" dir="auto">
                            {it.detail}
                          </span>
                        )}
                      </span>
                      {it.status && <StatusPill status={it.status} />}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-slate-100 bg-slate-50 px-4 py-3">
          {more > 0 && <span className="text-xs text-slate-500">+{more} more waiting</span>}
          <Button size="xs" variant="ghost" className="ml-auto" onClick={() => h.call_id && openCall(h.call_id)} disabled={!h.call_id}>
            Full call
          </Button>
          <Button
            size="xs"
            variant="primary"
            disabled={busy}
            onClick={async () => {
              if (await run(() => source.updateHandover(h.id, 'picked_up'), 'Picked up: the caller is yours')) onClose();
            }}
          >
            Pick up
          </Button>
        </div>
      </div>
    </div>
  );
}
