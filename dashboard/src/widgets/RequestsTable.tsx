import { useMemo, useState } from 'react';
import { useData, useNavPreset, useQuery } from '../app/DataContext';
import { SERVICES, serviceLabel } from '../data/services';
import type { RequestStatus, ServiceRequest } from '../data/types';
import { LangBadge, StatusPill } from '../ui/Badges';
import { Button, Empty, Field, Modal, Tabs, inputCls, useAction } from '../ui/controls';
import { fmtAge, fmtDateTime } from '../ui/format';
import { editable } from '../ui/editable';
import { STATUS_META, STATUS_ORDER } from '../ui/status';
import type { WidgetDef } from './types';

const PAGE = 150;

function EditRequest({ req, onClose }: { req: ServiceRequest; onClose: () => void }) {
  const { source } = useData();
  const { run, busy, banner } = useAction();
  const [status, setStatus] = useState<RequestStatus>(req.status);
  const [note, setNote] = useState(req.note ?? '');
  const save = async () => {
    const ok = await run(() =>
      source.updateRequest(req.id, { status, note: note.trim() || null }),
    );
    if (ok) onClose();
  };
  return (
    <Modal
      title={serviceLabel(req.service)}
      subtitle={
        <span dir="auto" className="italic">
          “{req.question ?? 'No question recorded'}”
        </span>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={save}>
            Save changes
          </Button>
        </>
      }
    >
      {banner}
      <Field label="Status">
        <div className="flex flex-wrap gap-2">
          {STATUS_ORDER.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-sm ring-1 transition ${
                status === s ? `${STATUS_META[s].bg} ${STATUS_META[s].text} ring-current` : 'text-slate-500 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="What staff did" hint="Saved on the request. Staff only.">
        <textarea
          className={`${inputCls} h-24`}
          dir="auto"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Technician fixed the AC on 25 Nov"
        />
      </Field>
    </Modal>
  );
}

function RequestsView() {
  const { source, openCall } = useData();
  const { data } = useQuery((s, f) => s.getSnapshot(f));
  const { run, busy, banner } = useAction();
  const [status, setStatus] = useNavPreset('requests', 'status', 'all');
  const [service, setService] = useNavPreset('requests', 'service', 'all');
  const [editing, setEditing] = useState<ServiceRequest | null>(null);

  const all = useMemo(
    () => [...(data?.requests ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)),
    [data],
  );
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: all.length };
    for (const r of all) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [all]);
  const rows = all.filter((r) => (status === 'all' || r.status === status) && (service === 'all' || r.service === service));

  if (!data) return <div className="text-slate-400">Loading…</div>;

  return (
    <div>
      {banner}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={status}
          onChange={setStatus}
          options={[
            { value: 'all', label: 'All', count: counts.all },
            ...STATUS_ORDER.map((s) => ({ value: s, label: STATUS_META[s].label, count: counts[s] ?? 0 })),
          ]}
        />
        <select className={`${inputCls} w-56`} value={service} onChange={(e) => setService(e.target.value)}>
          <option value="all">All services</option>
          {SERVICES.map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {!rows.length ? (
        <Empty>No requests match these filters.</Empty>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-sm">
            <thead>
              <tr className="border-b border-navy-200 text-left text-[11px] uppercase tracking-[0.12em] text-slate-500">
                <th className="py-2 pr-3 font-semibold">Time</th>
                <th className="py-2 pr-3 font-semibold">Caller</th>
                <th className="py-2 pr-3 font-semibold">Service</th>
                <th className="py-2 pr-3 font-semibold">Question</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Resolution</th>
                <th className="py-2 pr-3 text-right font-semibold">Age</th>
                <th className="py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PAGE).map((r) => (
                <tr
                  key={r.id}
                  onClick={() => r.call_id && openCall(r.call_id)}
                  className="cursor-pointer border-b border-slate-100 align-top transition hover:bg-navy-50/60"
                >
                  <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-slate-600">{fmtDateTime(r.created_at)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <LangBadge lang={r.language} />
                      <span className="tabular-nums text-slate-700">{r.contact ?? '—'}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-medium text-ink">
                    {serviceLabel(r.service)}
                    {r.thread && r.thread.calls.length > 1 && (
                      <div className="mt-0.5 w-fit rounded bg-navy-50 px-1.5 py-0.5 text-[11px] font-medium text-navy-800 ring-1 ring-navy-200" title={r.thread.steps.map((s) => s.label).join(' → ')}>
                        ↻ {r.thread.calls.length} calls · {r.thread.key}
                      </div>
                    )}
                  </td>
                  <td className="max-w-[280px] py-2.5 pr-3 text-slate-600">
                    <div className="truncate" dir="auto" title={r.question ?? ''}>
                      {r.question}
                    </div>
                    {r.note && <div className="truncate text-xs text-navy-700">Note: {r.note}</div>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="py-2.5 pr-3 capitalize text-slate-600">
                    {r.resolution?.replace(/_/g, ' ') ?? '—'}
                    {r.unsolved_reason && <div className="text-xs normal-case text-slate-400">{r.unsolved_reason.replace(/_/g, ' ')}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-slate-500">{fmtAge(r.created_at)}</td>
                  <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {editable(source.mode, r).any ? (
                    <div className="flex justify-end gap-1.5">
                      {r.status !== 'solved' && (
                        <Button
                          size="xs"
                          variant="success"
                          disabled={busy}
                          onClick={() => run(() => source.updateRequest(r.id, { status: 'solved' }), 'Marked solved')}
                        >
                          Mark solved
                        </Button>
                      )}
                      <Button size="xs" onClick={() => setEditing(r)}>
                        Edit
                      </Button>
                    </div>
                    ) : (
                      <span className="text-xs text-slate-400" title={editable(source.mode, r).why}>
                        —
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > PAGE && (
            <div className="pt-3 text-center text-xs text-slate-400">
              Showing the newest {PAGE} of {rows.length}. Narrow with the filters above.
            </div>
          )}
        </div>
      )}
      {editing && <EditRequest req={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const RequestsTable: WidgetDef = { id: 'requests', title: 'All requests', size: 'full', Component: RequestsView };
export default RequestsTable;
