import { useMemo, useState } from 'react';
import { useData, useQuery } from '../app/DataContext';
import { SERVICES, serviceLabel } from '../data/services';
import type { Booking } from '../data/types';
import { Button, Empty, Field, Modal, Tabs, inputCls, useAction } from '../ui/controls';
import { fmtTime, toLocalInput } from '../ui/format';
import type { WidgetDef } from './types';

const BOOKING_STATUS: Record<Booking['status'], { label: string; cls: string }> = {
  confirmed: { label: 'Confirmed', cls: 'bg-emerald-50 text-emerald-700' },
  rescheduled: { label: 'Rescheduled', cls: 'bg-amber-50 text-amber-800' },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-700' },
  completed: { label: 'Completed', cls: 'bg-stone-100 text-stone-600' },
};

const dayKey = (iso: string) => {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const dayLabel = (ms: number) => {
  const today = dayKey(new Date().toISOString());
  const diff = Math.round((ms - today) / 86400000);
  const date = new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
  return diff === 0 ? `Today · ${date}` : diff === 1 ? `Tomorrow · ${date}` : diff === -1 ? `Yesterday · ${date}` : date;
};

function Reschedule({ booking, onClose }: { booking: Booking; onClose: () => void }) {
  const { source } = useData();
  const { run, busy, banner } = useAction();
  const [slot, setSlot] = useState(toLocalInput(booking.slot_at));
  const save = async () => {
    const ok = await run(() => source.updateBooking(booking.id, { status: 'rescheduled', slot_at: new Date(slot).toISOString() }));
    if (ok) onClose();
  };
  return (
    <Modal
      title="Reschedule booking"
      subtitle={`${serviceLabel(booking.service)} · ${booking.customer_name}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || !slot} onClick={save}>
            Save new time
          </Button>
        </>
      }
    >
      {banner}
      <Field label="New date and time">
        <input type="datetime-local" className={inputCls} value={slot} onChange={(e) => setSlot(e.target.value)} />
      </Field>
    </Modal>
  );
}

function BookingsView() {
  const { source, openCall } = useData();
  const { data } = useQuery((s, f) => s.getSnapshot(f));
  const { run, busy, banner } = useAction();
  const [view, setView] = useState<'upcoming' | 'past'>('upcoming');
  const [service, setService] = useState('all');
  const [moving, setMoving] = useState<Booking | null>(null);

  const { upcoming, past } = useMemo(() => {
    const start = dayKey(new Date().toISOString());
    const list = (data?.bookings ?? []).filter((b) => service === 'all' || b.service === service);
    const upcoming = list.filter((b) => Date.parse(b.slot_at) >= start).sort((a, b) => Date.parse(a.slot_at) - Date.parse(b.slot_at));
    const past = list.filter((b) => Date.parse(b.slot_at) < start).sort((a, b) => Date.parse(b.slot_at) - Date.parse(a.slot_at));
    return { upcoming, past };
  }, [data, service]);

  if (!data) return <div className="text-stone-400">Loading…</div>;

  const rows = view === 'upcoming' ? upcoming : past;
  const days = new Map<number, Booking[]>();
  for (const b of rows) {
    const k = dayKey(b.slot_at);
    days.set(k, [...(days.get(k) ?? []), b]);
  }

  return (
    <div>
      {banner}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <Tabs
          value={view}
          onChange={setView}
          options={[
            { value: 'upcoming', label: 'Upcoming', count: upcoming.length },
            { value: 'past', label: 'Past', count: past.length },
          ]}
        />
        <select className={`${inputCls} w-56`} value={service} onChange={(e) => setService(e.target.value)}>
          <option value="all">All services</option>
          {SERVICES.filter((s) => s.bookable).map((s) => (
            <option key={s.key} value={s.key}>
              {s.label}
            </option>
          ))}
        </select>
      </div>

      {!rows.length ? (
        <Empty>No bookings.</Empty>
      ) : (
        <div className="space-y-6">
          {[...days].map(([day, list]) => (
            <section key={day}>
              <h3 className="mb-2 flex items-center gap-3 font-display text-lg font-semibold text-ink">
                {dayLabel(day)}
                <span className="h-px flex-1 bg-gold-200" />
                <span className="font-sans text-xs font-normal text-stone-400">{list.length} appointments</span>
              </h3>
              <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                {list.map((b) => {
                  const st = BOOKING_STATUS[b.status];
                  const active = b.status === 'confirmed' || b.status === 'rescheduled';
                  return (
                    <li key={b.id} className={`flex flex-wrap items-center gap-4 px-4 py-3 ${b.status === 'cancelled' ? 'opacity-60' : ''}`}>
                      <div className="w-14 text-lg font-semibold tabular-nums text-ink">{fmtTime(b.slot_at)}</div>
                      <button type="button" onClick={() => b.call_id && openCall(b.call_id)} className="min-w-0 flex-1 text-left">
                        <div className="font-semibold text-ink">{serviceLabel(b.service)}</div>
                        <div className="text-sm text-stone-500">
                          {b.customer_name}
                          {b.company && <> · {b.company}</>} · <span className="tabular-nums">{b.contact}</span>
                        </div>
                        {b.documents.length > 0 && <div className="text-xs text-stone-400">Bring: {b.documents.join(', ')}</div>}
                      </button>
                      {b.demo_fee_aed != null && (
                        <div className="text-right text-sm tabular-nums text-stone-600">
                          AED {b.demo_fee_aed.toLocaleString()}
                          <span className="ml-1 rounded bg-gold-100 px-1 py-0.5 text-[9px] font-bold tracking-wider text-gold-800">DEMO</span>
                        </div>
                      )}
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>
                      <div className="flex gap-1.5">
                        {active && (
                          <>
                            <Button size="xs" onClick={() => setMoving(b)}>
                              Reschedule
                            </Button>
                            <Button
                              size="xs"
                              variant="success"
                              disabled={busy}
                              onClick={() => run(() => source.updateBooking(b.id, { status: 'completed' }), 'Marked completed')}
                            >
                              Complete
                            </Button>
                            <Button
                              size="xs"
                              variant="danger"
                              disabled={busy}
                              onClick={() => run(() => source.updateBooking(b.id, { status: 'cancelled' }), 'Booking cancelled')}
                            >
                              Cancel
                            </Button>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      {moving && <Reschedule booking={moving} onClose={() => setMoving(null)} />}
    </div>
  );
}

const BookingsCalendar: WidgetDef = { id: 'bookings', title: 'Appointment calendar', size: 'full', Component: BookingsView };
export default BookingsCalendar;
