// Appointment calendar: every appointment HALA booked, on the date and time it is booked FOR, tagged by service.
// Week view (by hour) and month view (by day). Service tags double as filters.

import { useMemo, useState } from 'react';
import { useData, useQuery } from '../app/DataContext';
import { serviceLabel, serviceTag } from '../data/services';
import type { Db } from '../data/types';
import { Button, Empty } from '../ui/controls';
import { fmtTime } from '../ui/format';
import type { WidgetDef } from './types';

interface Item {
  id: string; // booking reference, e.g. HALA-1004
  at: number; // the appointment's date and time
  services: string[];
  title: string;
  sub: string;
  callId: string | null; // the call it was booked in
  status: 'confirmed' | 'rescheduled' | 'cancelled' | 'completed';
}

const DAY = 86400000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const startOfWeek = (t: number) => {
  const d = new Date(startOfDay(t));
  return d.getTime() - ((d.getDay() + 6) % 7) * DAY; // Monday
};
const startOfMonth = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
};
const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);

function buildItems(db: Db): Item[] {
  return db.bookings
    .map((b) => ({
      id: b.id,
      at: Date.parse(b.slot_at),
      services: [b.service],
      title: serviceLabel(b.service),
      sub: `${b.id} · ${b.customer_name}${b.contact ? ` · ${b.contact}` : ''}`,
      callId: b.call_id,
      status: b.status,
    }))
    .sort((a, b) => a.at - b.at);
}

function Chip({ item, compact = false }: { item: Item; compact?: boolean }) {
  const { openCall } = useData();
  const tag = serviceTag(item.services[0]);
  const cancelled = item.status === 'cancelled';
  return (
    <button
      type="button"
      onClick={() => item.callId && openCall(item.callId)}
      title={`${fmtTime(new Date(item.at).toISOString())} · ${item.title} · ${item.sub}${cancelled ? ' · cancelled' : ''}`}
      className={`block w-full rounded-control border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight ring-1 transition hover:brightness-95 ${tag.chip} ${tag.bar} ${
        cancelled ? 'line-through opacity-50' : ''
      }`}
    >
      <span className="block truncate font-semibold">
        <span className="tabular-nums opacity-70">{fmtTime(new Date(item.at).toISOString())}</span> {item.title}
      </span>
      {!compact && <span className="block truncate opacity-75">{item.sub}</span>}
    </button>
  );
}

function CalendarViewInner() {
  const { data } = useQuery((s, f) => s.getSnapshot({ ...f, range: 'all' })); // the calendar picks its own dates
  const [view, setView] = useState<'week' | 'month'>('week');
  const [anchor, setAnchor] = useState(() => Date.now());
  const [showCancelled, setShowCancelled] = useState(false);
  const [only, setOnly] = useState<Set<string>>(new Set()); // empty = all services

  const items = useMemo(() => (data ? buildItems(data) : []), [data]);
  const visible = items.filter(
    (i) =>
      (showCancelled || i.status !== 'cancelled') && (only.size === 0 || i.services.some((s) => only.has(s))),
  );
  // Tags: services that actually occur, with counts.
  const counts = new Map<string, number>();
  for (const i of items) if (showCancelled || i.status !== 'cancelled') for (const s of i.services) counts.set(s, (counts.get(s) ?? 0) + 1);
  const tags = [...counts].sort((a, b) => b[1] - a[1]);

  if (!data) return <div className="text-slate-400">Loading…</div>;

  const step = view === 'week' ? 7 * DAY : 0;
  const move = (dir: -1 | 1) =>
    setAnchor((a) => {
      if (view === 'week') return a + dir * step;
      const d = new Date(a);
      return new Date(d.getFullYear(), d.getMonth() + dir, 1).getTime();
    });
  const weekStart = startOfWeek(anchor);
  const monthStart = startOfMonth(anchor);
  const title =
    view === 'week'
      ? `${new Date(weekStart).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} – ${new Date(weekStart + 6 * DAY).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : new Date(monthStart).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
  const today = Date.now();
  const inRange = visible.filter((i) =>
    view === 'week' ? i.at >= weekStart && i.at < weekStart + 7 * DAY : new Date(i.at).getMonth() === new Date(monthStart).getMonth() && new Date(i.at).getFullYear() === new Date(monthStart).getFullYear(),
  );

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          <Button size="xs" onClick={() => move(-1)} aria-label="Previous">
            ←
          </Button>
          <Button size="xs" onClick={() => setAnchor(Date.now())}>
            Today
          </Button>
          <Button size="xs" onClick={() => move(1)} aria-label="Next">
            →
          </Button>
        </div>
        <div className="font-display text-[22px] font-bold text-ink">{title}</div>
        <div className="ml-auto flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" className="h-4 w-4 accent-[#194176]" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            Show cancelled
          </label>
          <div className="flex gap-1.5">
            {(['week', 'month'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setView(v)}
                className={`rounded-control border px-3 py-1.5 font-display text-[14px] font-semibold uppercase tracking-[0.08em] ${
                  view === v ? 'border-navy-600 bg-navy-600 text-white' : 'border-slate-300 bg-white text-navy-700 hover:border-navy-400'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Service tags = legend + filter */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <span className="mr-1 font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-slate-600">Services</span>
        {tags.map(([s, n]) => {
          const tag = serviceTag(s);
          const on = only.size === 0 || only.has(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() =>
                setOnly((prev) => {
                  const next = new Set(prev);
                  if (next.has(s)) next.delete(s);
                  else next.add(s);
                  return next;
                })
              }
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 transition ${tag.chip} ${on ? '' : 'opacity-35'}`}
            >
              <span className={`h-2 w-2 rounded-full ${tag.dot}`} />
              {serviceLabel(s)}
              <span className="opacity-60">{n}</span>
            </button>
          );
        })}
        {only.size > 0 && (
          <button type="button" onClick={() => setOnly(new Set())} className="ml-1 text-xs text-signal hover:underline">
            Show all
          </button>
        )}
      </div>

      {view === 'week' ? (
        <WeekGrid weekStart={weekStart} items={inRange} today={today} />
      ) : (
        <MonthGrid monthStart={monthStart} items={inRange} today={today} onPickDay={(t) => { setAnchor(t); setView('week'); }} />
      )}

      {!inRange.length && <Empty>No appointments in this {view}{only.size ? ' for the selected services' : ''}. Try ← / → or Today.</Empty>}

      {/* Summary of the period by service */}
      {inRange.length > 0 && (
        <div className="mt-4 text-xs text-slate-600">
          {inRange.length} appointment{inRange.length === 1 ? '' : 's'} in this {view}
        </div>
      )}
    </div>
  );
}

function WeekGrid({ weekStart, items, today }: { weekStart: number; items: Item[]; today: number }) {
  const days = Array.from({ length: 7 }, (_, i) => weekStart + i * DAY);
  // Office hours by default (08:00–18:00), stretched to whatever hours actually have calls (e.g. evening tests).
  const hoursUsed = items.map((i) => new Date(i.at).getHours());
  const first = Math.min(8, ...hoursUsed);
  const last = Math.max(18, ...hoursUsed);
  const HOURS = Array.from({ length: last - first + 1 }, (_, i) => first + i);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[900px] grid-cols-[56px_repeat(7,minmax(0,1fr))] overflow-hidden rounded-card border border-slate-200">
        <div className="border-b border-slate-200 bg-cloud" />
        {days.map((d, i) => (
          <div key={d} className={`border-b border-l border-slate-200 px-2 py-2 text-center ${sameDay(d, today) ? 'bg-navy-600 text-white' : 'bg-cloud'}`}>
            <div className="font-display text-[13px] font-semibold uppercase tracking-[0.12em] opacity-80">{WEEKDAYS[i]}</div>
            <div className="font-display text-[22px] font-bold leading-none">{new Date(d).getDate()}</div>
          </div>
        ))}
        {HOURS.map((h) => {
          const label = `${String(h).padStart(2, '0')}:00`;
          const pick = (d: number) => items.filter((i) => sameDay(i.at, d) && new Date(i.at).getHours() === h);
          return [
            <div key={`h${h}`} className="border-b border-slate-100 px-2 py-1.5 text-right text-[11px] tabular-nums text-slate-500">
              {label}
            </div>,
            ...days.map((d) => (
              <div key={`${h}-${d}`} className={`min-h-[44px] space-y-1 border-b border-l border-slate-100 p-1 ${sameDay(d, today) ? 'bg-mist/50' : ''}`}>
                {pick(d).map((i) => (
                  <Chip key={i.id} item={i} />
                ))}
              </div>
            )),
          ];
        })}
      </div>
    </div>
  );
}

function MonthGrid({ monthStart, items, today, onPickDay }: { monthStart: number; items: Item[]; today: number; onPickDay: (t: number) => void }) {
  const gridStart = startOfWeek(monthStart);
  const month = new Date(monthStart).getMonth();
  const cells = Array.from({ length: 42 }, (_, i) => gridStart + i * DAY);
  return (
    <div className="overflow-x-auto">
      <div className="grid min-w-[760px] grid-cols-7 overflow-hidden rounded-card border border-slate-200">
        {WEEKDAYS.map((w) => (
          <div key={w} className="border-b border-slate-200 bg-cloud px-2 py-2 text-center font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-600">
            {w}
          </div>
        ))}
        {cells.map((d) => {
          const dayItems = items.filter((i) => sameDay(i.at, d));
          const out = new Date(d).getMonth() !== month;
          return (
            <div key={d} className={`min-h-[108px] border-b border-l border-slate-100 p-1.5 ${out ? 'bg-cloud/60 text-slate-400' : ''}`}>
              <button
                type="button"
                onClick={() => onPickDay(d)}
                className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full font-display text-[14px] font-bold ${
                  sameDay(d, today) ? 'bg-navy-600 text-white' : 'hover:bg-mist'
                }`}
                title="Open this week"
              >
                {new Date(d).getDate()}
              </button>
              <div className="space-y-1">
                {dayItems.slice(0, 3).map((i) => (
                  <Chip key={i.id} item={i} compact />
                ))}
                {dayItems.length > 3 && (
                  <button type="button" onClick={() => onPickDay(d)} className="text-[11px] font-medium text-signal hover:underline">
                    +{dayItems.length - 3} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CalendarView: WidgetDef = { id: 'calendar', title: 'Appointments by service', size: 'full', Component: CalendarViewInner };
export default CalendarView;
