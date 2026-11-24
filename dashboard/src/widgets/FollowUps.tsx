import { useMemo, useState } from 'react';
import { useData, useQuery } from '../app/DataContext';
import { FOLLOWUP_THRESHOLD_MS } from '../data/compute';
import { SERVICE_AR, serviceLabel } from '../data/services';
import type { ServiceRequest } from '../data/types';
import { LangBadge, StatusPill } from '../ui/Badges';
import { Button, Empty, Modal, Tabs, useAction } from '../ui/controls';
import { fmtAge, fmtDateTime, fmtTime } from '../ui/format';
import type { WidgetDef } from './types';

function messages(r: ServiceRequest) {
  const svc = serviceLabel(r.service);
  const svcAr = SERVICE_AR[r.service] ?? svc;
  return {
    en: `Hello, this is HALA from Dubai Silicon Oasis. We're following up on your ${svc} request so we can complete it for you. Reply to this message or call 600 59 55 57 (Mon–Fri, 08:00–15:00).`,
    ar: `مرحباً، معك هالة من واحة دبي للسيليكون. نتابع معك بخصوص طلب ${svcAr} لإكماله. يمكنك الرد على هذه الرسالة أو الاتصال على 600 59 55 57 (الإثنين–الجمعة، 08:00–15:00).`,
  };
}

function SendFollowup({ req, onClose }: { req: ServiceRequest; onClose: () => void }) {
  const { source } = useData();
  const { run, busy, banner } = useAction();
  const [channel, setChannel] = useState<'SMS' | 'WhatsApp'>('WhatsApp');
  const msg = messages(req);
  const send = async () => {
    const ok = await run(() => source.logFollowup(req.id, 'followup_sent', `${channel} follow-up sent`));
    if (ok) onClose();
  };
  return (
    <Modal
      title="Send follow-up"
      subtitle={
        <>
          To <b className="tabular-nums text-ink">{req.contact ?? 'unknown contact'}</b> about {serviceLabel(req.service)}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy} onClick={send}>
            Send {channel}
          </Button>
        </>
      }
    >
      {banner}
      <div className="mb-4 flex gap-2">
        {(['WhatsApp', 'SMS'] as const).map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setChannel(c)}
            className={`rounded-full px-3 py-1 text-sm ring-1 ${channel === c ? 'bg-gold-50 text-gold-800 ring-gold-300' : 'text-stone-500 ring-stone-200'}`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="space-y-3 rounded-xl bg-[#efe9dd] p-4">
        {[msg.en, msg.ar].map((text, i) => (
          <div key={i} className="ml-auto max-w-[88%] rounded-2xl rounded-tr-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed text-ink shadow-card">
            <div dir="auto">{text}</div>
            <div className="mt-1 text-right text-[10px] text-stone-400">{fmtTime(new Date().toISOString())} ✓✓</div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-stone-400">Preview only: the message is logged as a follow-up, nothing is actually sent in the demo.</p>
    </Modal>
  );
}

function FollowUpsView() {
  const { source, openCall } = useData();
  const { data } = useQuery((s, f) => s.getSnapshot(f));
  const { run, busy, banner } = useAction();
  const [tab, setTab] = useState<'due' | 'appointments'>('due');
  const [sending, setSending] = useState<ServiceRequest | null>(null);

  const { due, lastTouch, upcoming } = useMemo(() => {
    const now = Date.now();
    const reqs = data?.requests ?? [];
    const due = reqs
      .filter((r) => r.status === 'needs_followup' || (r.status === 'open' && now - Date.parse(r.created_at) > FOLLOWUP_THRESHOLD_MS))
      .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    const lastTouch = new Map<string, { type: string; at: string }>();
    for (const e of data?.events ?? []) {
      const id = e.payload?.request_id;
      if (id && (e.type === 'followup_sent' || e.type === 'callback_scheduled')) {
        const prev = lastTouch.get(id);
        if (!prev || Date.parse(e.created_at) > Date.parse(prev.at)) lastTouch.set(id, { type: e.type, at: e.created_at });
      }
    }
    const upcoming = (data?.bookings ?? [])
      .filter((b) => {
        const t = Date.parse(b.slot_at);
        return (b.status === 'confirmed' || b.status === 'rescheduled') && t > now && t - now < 24 * 3600e3;
      })
      .sort((a, b) => Date.parse(a.slot_at) - Date.parse(b.slot_at));
    return { due, lastTouch, upcoming };
  }, [data]);

  if (!data) return <div className="text-stone-400">Loading…</div>;

  return (
    <div>
      {banner}
      <div className="mb-4 flex items-end justify-between gap-3">
        <Tabs
          value={tab}
          onChange={setTab}
          options={[
            { value: 'due', label: 'Needs follow-up', count: due.length },
            { value: 'appointments', label: 'Appointments in next 24h', count: upcoming.length },
          ]}
        />
        <span className="text-xs text-stone-400">Open items older than 2 minutes (demo; production: 2 days)</span>
      </div>

      {tab === 'due' &&
        (due.length ? (
          <ul className="divide-y divide-stone-100">
            {due.map((r) => {
              const touch = lastTouch.get(r.id);
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-4 py-3">
                  <button type="button" onClick={() => r.call_id && openCall(r.call_id)} className="min-w-0 flex-1 text-left">
                    <div className="flex items-center gap-2">
                      <LangBadge lang={r.language} />
                      <span className="font-semibold text-ink">{serviceLabel(r.service)}</span>
                      <StatusPill status={r.status} />
                      <span className="text-xs tabular-nums text-stone-400">waiting {fmtAge(r.created_at)}</span>
                    </div>
                    <div className="mt-1 truncate text-sm text-stone-600" dir="auto">
                      “{r.question}”
                    </div>
                    <div className="mt-0.5 text-xs text-stone-400">
                      <span className="tabular-nums">{r.contact ?? 'no contact'}</span>
                      {r.assigned_to && <> · assigned to {r.assigned_to}</>}
                      {touch && (
                        <span className="text-gold-700">
                          {' '}
                          · {touch.type === 'followup_sent' ? 'follow-up sent' : 'callback scheduled'} {fmtAge(touch.at)} ago
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="primary" size="xs" onClick={() => setSending(r)}>
                      Send follow-up
                    </Button>
                    <Button
                      size="xs"
                      disabled={busy}
                      onClick={() => run(() => source.logFollowup(r.id, 'callback_scheduled', 'callback scheduled by staff'), 'Callback scheduled')}
                    >
                      Call back
                    </Button>
                    <Button
                      size="xs"
                      variant="success"
                      disabled={busy}
                      onClick={() => run(() => source.updateRequest(r.id, { status: 'solved' }), 'Marked solved')}
                    >
                      Mark solved
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <Empty>Nothing needs a follow-up right now.</Empty>
        ))}

      {tab === 'appointments' &&
        (upcoming.length ? (
          <ul className="divide-y divide-stone-100">
            {upcoming.map((b) => (
              <li key={b.id} className="flex items-center gap-4 py-3">
                <div className="w-28 shrink-0">
                  <div className="text-lg font-semibold tabular-nums text-ink">{fmtTime(b.slot_at)}</div>
                  <div className="text-xs text-stone-400">in {fmtAge(new Date(Date.now() - (Date.parse(b.slot_at) - Date.now())).toISOString())}</div>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-ink">{serviceLabel(b.service)}</div>
                  <div className="text-sm text-stone-500">
                    {b.customer_name}
                    {b.company && <> · {b.company}</>} · <span className="tabular-nums">{b.contact}</span>
                  </div>
                  <div className="text-xs text-stone-400">Bring: {b.documents.join(', ')}</div>
                </div>
                <span className="text-xs text-stone-500">{fmtDateTime(b.slot_at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>No appointments in the next 24 hours.</Empty>
        ))}

      {sending && <SendFollowup req={sending} onClose={() => setSending(null)} />}
    </div>
  );
}

const FollowUps: WidgetDef = { id: 'followups', title: 'Follow-up queue', size: 'full', Component: FollowUpsView };
export default FollowUps;
