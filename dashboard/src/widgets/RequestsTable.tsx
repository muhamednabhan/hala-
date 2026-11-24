import { useMemo, useState } from 'react';
import { useData, useQuery } from '../app/DataContext';
import { SERVICES, serviceLabel } from '../data/services';
import type { RequestStatus, ServiceRequest } from '../data/types';
import { LangBadge, StatusPill } from '../ui/Badges';
import { Button, Empty, Field, Modal, Tabs, inputCls, useAction } from '../ui/controls';
import { fmtAge, fmtDateTime } from '../ui/format';
import { STATUS_META, STATUS_ORDER } from '../ui/status';
import type { WidgetDef } from './types';

const STAFF = ['Front desk', 'Visa team', 'Licensing team', 'Facilities', 'Customer care'];
const PAGE = 150;

function EditRequest({ req, onClose }: { req: ServiceRequest; onClose: () => void }) {
  const { source } = useData();
  const { run, busy, banner } = useAction();
  const [status, setStatus] = useState<RequestStatus>(req.status);
  const [assigned, setAssigned] = useState(req.assigned_to ?? '');
  const [note, setNote] = useState(req.note ?? '');
  const save = async () => {
    const ok = await run(() =>
      source.updateRequest(req.id, { status, assigned_to: assigned.trim() || null, note: note.trim() || null }),
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
                status === s ? `${STATUS_META[s].bg} ${STATUS_META[s].text} ring-current` : 'text-stone-500 ring-stone-200 hover:bg-stone-50'
              }`}
            >
              {STATUS_META[s].label}
            </button>
          ))}
        </div>
      </Field>
      <Field label="Assigned to">
        <input list="staff-list" className={inputCls} value={assigned} onChange={(e) => setAssigned(e.target.value)} placeholder="Name or team" />
        <datalist id="staff-list">
          {STAFF.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </Field>
      <Field label="Internal note">
        <textarea className={`${inputCls} h-24`} dir="auto" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Visible to staff only" />
      </Field>
    </Modal>
  );
}

function RequestsView() {
  const { source, openCall } = useData();
  const { data } = useQuery((s, f) => s.getSnapshot(f));
  const { run, busy, banner } = useAction();
  const [status, setStatus] = useState<'all' | RequestStatus>('all');
  const [service, setService] = useState('all');
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

  if (!data) return <div className="text-stone-400">Loading…</div>;

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
              <tr className="border-b border-gold-200 text-left text-[11px] uppercase tracking-[0.12em] text-stone-500">
                <th className="py-2 pr-3 font-semibold">Time</th>
                <th className="py-2 pr-3 font-semibold">Caller</th>
                <th className="py-2 pr-3 font-semibold">Service</th>
                <th className="py-2 pr-3 font-semibold">Question</th>
                <th className="py-2 pr-3 font-semibold">Status</th>
                <th className="py-2 pr-3 font-semibold">Resolution</th>
                <th className="py-2 pr-3 font-semibold">Assigned</th>
                <th className="py-2 pr-3 text-right font-semibold">Age</th>
                <th className="py-2 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, PAGE).map((r) => (
                <tr
                  key={r.id}
                  onClick={() => r.call_id && openCall(r.call_id)}
                  className="cursor-pointer border-b border-stone-100 align-top transition hover:bg-gold-50/60"
                >
                  <td className="whitespace-nowrap py-2.5 pr-3 tabular-nums text-stone-600">{fmtDateTime(r.created_at)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-3">
                    <div className="flex items-center gap-2">
                      <LangBadge lang={r.language} />
                      <span className="tabular-nums text-stone-700">{r.contact ?? '—'}</span>
                    </div>
                  </td>
                  <td className="py-2.5 pr-3 font-medium text-ink">{serviceLabel(r.service)}</td>
                  <td className="max-w-[280px] py-2.5 pr-3 text-stone-600">
                    <div className="truncate" dir="auto" title={r.question ?? ''}>
                      {r.question}
                    </div>
                    {r.note && <div className="truncate text-xs text-gold-700">Note: {r.note}</div>}
                  </td>
                  <td className="py-2.5 pr-3">
                    <StatusPill status={r.status} />
                  </td>
                  <td className="py-2.5 pr-3 capitalize text-stone-600">
                    {r.resolution?.replace(/_/g, ' ') ?? '—'}
                    {r.unsolved_reason && <div className="text-xs normal-case text-stone-400">{r.unsolved_reason.replace(/_/g, ' ')}</div>}
                  </td>
                  <td className="py-2.5 pr-3 text-stone-600">{r.assigned_to ?? <span className="text-stone-300">—</span>}</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums text-stone-500">{fmtAge(r.created_at)}</td>
                  <td className="py-2 text-right" onClick={(e) => e.stopPropagation()}>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > PAGE && (
            <div className="pt-3 text-center text-xs text-stone-400">
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
