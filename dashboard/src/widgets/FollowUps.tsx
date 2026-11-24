import { useMemo } from 'react';
import { useData, useNavPreset, useQuery } from '../app/DataContext';
import { FOLLOWUP_THRESHOLD_MS } from '../data/compute';
import { serviceLabel } from '../data/services';
import type { ServiceRequest } from '../data/types';
import { LangBadge, StatusPill } from '../ui/Badges';
import { Button, Empty, Tabs, useAction } from '../ui/controls';
import { editable } from '../ui/editable';
import { fmtAge, fmtDateTime, fmtTime } from '../ui/format';
import type { WidgetDef } from './types';

/** Where staff actually deal with this item. Only real actions: nothing here sends messages. */
function nextStep(r: ServiceRequest): { label: string; page: 'handovers' | 'teach' | 'bookings' } | null {
  if (r.resolution === 'handed_over') return { label: 'Take over', page: 'handovers' };
  if (r.unsolved_reason === 'unknown_answer') return { label: 'Answer it', page: 'teach' };
  if (['booked', 'rescheduled', 'cancelled'].includes(r.resolution ?? '')) return { label: 'Open booking', page: 'bookings' };
  return null;
}

function FollowUpsView() {
  const { source, openCall, navigate } = useData();
  const { data } = useQuery((s, f) => s.getSnapshot(f));
  const { run, busy, banner } = useAction();
  const [tabRaw, setTab] = useNavPreset('followups', 'tab', 'due');
  const tab = tabRaw === 'appointments' ? 'appointments' : 'due';

  const { due, calledBack, upcoming } = useMemo(() => {
    const now = Date.now();
    const due = (data?.requests ?? [])
      .filter((r) => r.status === 'needs_followup' || (r.status === 'open' && now - Date.parse(r.created_at) > FOLLOWUP_THRESHOLD_MS))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    // HALA's own outbound calls (reminders / callbacks from the phone line), linked to the case.
    const calledBack = new Map<string, string>();
    for (const e of data?.events ?? []) {
      const id = e.payload?.request_id;
      if (id && e.type === 'callback_scheduled' && (!calledBack.has(id) || e.created_at > calledBack.get(id)!)) calledBack.set(id, e.created_at);
    }
    const upcoming = (data?.bookings ?? [])
      .filter((b) => {
        const t = Date.parse(b.slot_at);
        return (b.status === 'confirmed' || b.status === 'rescheduled') && t > now && t - now < 24 * 3600e3;
      })
      .sort((a, b) => Date.parse(a.slot_at) - Date.parse(b.slot_at));
    return { due, calledBack, upcoming };
  }, [data]);

  if (!data) return <div className="text-slate-400">Loading…</div>;

  return (
    <div>
      {banner}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'due', label: 'Waiting on DSO', count: due.length },
            { value: 'appointments', label: 'Appointments in the next 24h', count: upcoming.length },
          ]}
        />
        <span className="text-xs text-slate-400">
          Promised a person, or open longer than {source.mode === 'mock' ? '2 minutes (demo)' : '2 minutes'}
        </span>
      </div>

      {tab === 'due' &&
        (due.length ? (
          <ul className="divide-y divide-slate-100">
            {due.map((r) => {
              const step = nextStep(r);
              const called = calledBack.get(r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-4 py-3">
                  <button type="button" onClick={() => r.call_id && openCall(r.call_id)} className="min-w-0 flex-1 text-left">
                    <div className="flex flex-wrap items-center gap-2">
                      <LangBadge lang={r.language} />
                      <span className="font-semibold text-ink">{serviceLabel(r.service)}</span>
                      <StatusPill status={r.status} />
                      <span className="text-xs tabular-nums text-slate-400">waiting {fmtAge(r.created_at)}</span>
                    </div>
                    {r.question && (
                      <div className="mt-1 truncate text-sm text-slate-600" dir="auto">
                        “{r.question}”
                      </div>
                    )}
                    <div className="mt-0.5 text-xs text-slate-400">
                      <span className="tabular-nums">{r.contact ?? 'no contact collected'}</span>
                      {called && <span className="text-violet-700"> · HALA called them {fmtAge(called)} ago</span>}
                    </div>
                  </button>
                  <div className="flex shrink-0 gap-2">
                    {step && (
                      <Button size="xs" variant="primary" onClick={() => navigate({ page: step.page, tab: step.page === 'handovers' ? 'waiting' : step.page === 'teach' ? 'waiting' : 'upcoming' })}>
                        {step.label} →
                      </Button>
                    )}
                    {editable(source.mode, r).any && (
                      <Button
                        size="xs"
                        variant="success"
                        disabled={busy}
                        onClick={() => run(() => source.updateRequest(r.id, { status: 'solved' }), 'Marked solved')}
                      >
                        Mark solved
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Nobody is waiting on DSO right now.</Empty>
        ))}

      {tab === 'appointments' &&
        (upcoming.length ? (
          <ul className="divide-y divide-slate-100">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center gap-4 py-3">
                <div className="w-20 shrink-0 text-lg font-semibold tabular-nums text-ink">{fmtTime(b.slot_at)}</div>
                <button type="button" onClick={() => b.call_id && openCall(b.call_id)} className="min-w-0 flex-1 text-left">
                  <div className="font-semibold text-ink">
                    {serviceLabel(b.service)} <span className="font-normal text-slate-400">· {b.id}</span>
                  </div>
                  <div className="text-sm text-slate-500">
                    {b.customer_name} · <span className="tabular-nums">{b.contact}</span>
                  </div>
                  {b.reminder ? (
                    <div className="mt-0.5 text-xs font-medium text-violet-700">
                      ↗ HALA reminder call {fmtAge(b.reminder.at)} ago · {b.reminder.status}
                    </div>
                  ) : (
                    <div className="mt-0.5 text-xs text-slate-400">No reminder call yet</div>
                  )}
                </button>
                <span className="text-xs text-slate-500">{fmtDateTime(b.slot_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No appointments in the next 24 hours.</Empty>
        ))}
    </div>
  );
}

const FollowUps: WidgetDef = { id: 'followups', title: 'Follow-ups', size: 'full', Component: FollowUpsView };
export default FollowUps;
