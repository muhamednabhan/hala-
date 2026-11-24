import { useMemo } from 'react';
import { useData, useNavPreset, useQuery } from '../app/DataContext';
import { HANDOVER_REASON_LABEL, serviceLabel } from '../data/services';
import type { Handover } from '../data/types';
import { LangBadge } from '../ui/Badges';
import { Button, Empty, Tabs, useAction } from '../ui/controls';
import { fmtAge, fmtDateTime } from '../ui/format';
import type { WidgetDef } from './types';

const REASON_CLS: Record<string, string> = {
  fee_dispute: 'bg-red-50 text-red-700 ring-red-200',
  emergency: 'bg-red-600 text-white ring-red-600',
  upset_caller: 'bg-red-50 text-red-700 ring-red-200',
  legal_question: 'bg-violet-50 text-violet-700 ring-violet-200',
  out_of_scope: 'bg-slate-100 text-slate-700 ring-slate-200',
  unknown_answer: 'bg-navy-50 text-navy-800 ring-navy-200',
  caller_requested: 'bg-blue-50 text-blue-700 ring-blue-200',
};

function HandoversView() {
  const { source, openCall } = useData();
  const { data } = useQuery((s, f) => s.getSnapshot(f));
  const { run, busy, banner } = useAction();
  const [tabRaw, setTab] = useNavPreset('handovers', 'tab', 'waiting');
  const tab = (['waiting', 'picked_up', 'resolved'].includes(tabRaw) ? tabRaw : 'waiting') as Handover['status'];

  const { by, langByCall } = useMemo(() => {
    const by: Record<Handover['status'], Handover[]> = { waiting: [], picked_up: [], resolved: [] };
    for (const h of data?.handovers ?? []) by[h.status]?.push(h);
    by.waiting.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)); // longest wait first
    by.picked_up.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    by.resolved.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    const langByCall = new Map((data?.calls ?? []).map((c) => [c.id, c.language]));
    return { by, langByCall };
  }, [data]);

  if (!data) return <div className="text-slate-400">Loading…</div>;
  const rows = by[tab];

  return (
    <div>
      {banner}
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'waiting', label: 'Waiting', count: by.waiting.length },
          { value: 'picked_up', label: 'Picked up', count: by.picked_up.length },
          { value: 'resolved', label: 'Resolved', count: by.resolved.length },
        ]}
      />
      {!rows.length ? (
        <Empty>{tab === 'waiting' ? 'No one is waiting for a human right now.' : 'Nothing here.'}</Empty>
      ) : (
        <ul className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {rows.map((h) => {
            const r = {
              label: HANDOVER_REASON_LABEL[h.reason] ?? h.reason.replace(/_/g, ' '),
              cls: REASON_CLS[h.reason] ?? 'bg-slate-100 text-slate-700 ring-slate-200',
            };
            const mins = (Date.now() - Date.parse(h.created_at)) / 60000;
            const urgent = h.status === 'waiting' && mins > 10;
            return (
              <li
                key={h.id}
                className={`rounded-lg border bg-white p-4 ${urgent ? 'border-amber-300 ring-1 ring-amber-100' : 'border-slate-200'}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${r.cls}`}>{r.label}</span>
                      <LangBadge lang={h.call_id ? langByCall.get(h.call_id) : null} />
                      <span className="font-semibold text-ink">{serviceLabel(h.service)}</span>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">{fmtDateTime(h.created_at)}</div>
                  </div>
                  {h.status !== 'resolved' && (
                    <div className="text-right">
                      <div className={`text-xl font-semibold tabular-nums ${urgent ? 'text-amber-700' : 'text-ink'}`}>{fmtAge(h.created_at)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">waiting</div>
                    </div>
                  )}
                </div>
                <div className="mt-3 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wider text-navy-700">HALA already collected</div>
                  <div dir="auto">{h.context || '—'}</div>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => h.call_id && openCall(h.call_id)}
                    className="text-xs font-semibold uppercase tracking-wider text-navy-700 hover:text-navy-900"
                  >
                    Transcript →
                  </button>
                  <div className="flex gap-2">
                    {h.status === 'waiting' && (
                      <Button size="xs" variant="primary" disabled={busy} onClick={() => run(() => source.updateHandover(h.id, 'picked_up'), 'Picked up')}>
                        Pick up
                      </Button>
                    )}
                    {h.status !== 'resolved' && (
                      <Button
                        size="xs"
                        variant="success"
                        disabled={busy}
                        onClick={() => run(() => source.updateHandover(h.id, 'resolved'), 'Resolved: request marked solved')}
                      >
                        Resolve
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const HandoverQueue: WidgetDef = { id: 'handovers', title: 'Handed to a human', size: 'full', Component: HandoversView };
export default HandoverQueue;
