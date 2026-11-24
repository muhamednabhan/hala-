import { useCallback, useEffect, useState } from 'react';
import { AUTH_EVENT, logout, serverStatus, type ServerStatus } from '../data/api';
import { liveAvailable, switchMode } from '../data/index';
import type { DataSource } from '../data/source';
import { DsoLockup } from '../ui/Badges';
import { Button } from '../ui/controls';
import { PAGES, type PageId } from '../widgets/registry';
import { CallDrawer } from './CallDrawer';
import { DataProvider, useQuery } from './DataContext';
import { FilterBar } from './FilterBar';
import { alertsEnabled, HandoverAlerts, setAlertsEnabled } from './HandoverAlert';
import { CallEndedCards } from './CallEnded';
import { Login } from './Login';
import { PageView } from './PageView';

function Clock({ dark = false }: { dark?: boolean }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="leading-tight">
      <div className={`font-display text-2xl font-semibold tabular-nums ${dark ? 'text-white' : 'text-ink'}`}>
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className={`text-[11px] ${dark ? 'text-white/60' : 'text-slate-600'}`}>
        {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
    </div>
  );
}

/** Live mode: which feeds are connected. Hover for details. */
function Health() {
  const { data } = useQuery(async (s) => (s.getHealth ? s.getHealth() : []));
  if (!data?.length) return null;
  return (
    <div className="hidden items-center gap-3 lg:flex">
      {data.map((h) => (
        <span key={h.label} title={h.detail} className="flex items-center gap-1.5 text-xs text-slate-600">
          <span className={`h-2 w-2 rounded-full ${h.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
          {h.label}
        </span>
      ))}
    </div>
  );
}

/** Demo / Live switch. Demo never needs the network, so it is the safe choice on a projector. */
function ModeSwitch({ mode, auth }: { mode: 'mock' | 'live'; auth?: ServerStatus['auth'] }) {
  if (!liveAvailable())
    return <span className="rounded-full bg-navy-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-navy-800 ring-1 ring-navy-200">Demo data</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-full bg-slate-100 p-0.5 text-[11px] font-semibold uppercase tracking-wider ring-1 ring-slate-200">
        {(['live', 'mock'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => m !== mode && switchMode(m)}
            className={`whitespace-nowrap rounded-full px-3 py-1 transition ${
              m === mode ? (m === 'live' ? 'bg-emerald-600 text-white' : 'bg-navy-600 text-white') : 'text-slate-500 hover:text-ink'
            }`}
          >
            {m === 'live' ? '● Live' : 'Demo'}
          </button>
        ))}
      </div>
      {mode === 'live' && auth === 'ok' && (
        <button type="button" onClick={() => logout().then(() => window.location.reload())} className="whitespace-nowrap text-[11px] text-slate-400 hover:text-ink">
          Sign out
        </button>
      )}
    </div>
  );
}

/** Turns the handover pop-up (and its chime) on or off for this browser. */
function AlertToggle() {
  const [on, setOn] = useState(alertsEnabled);
  return (
    <button
      type="button"
      title={on ? 'Handover pop-ups are on' : 'Handover pop-ups are off'}
      onClick={() => {
        setAlertsEnabled(!on);
        setOn(!on);
      }}
      className={`flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 transition ${
        on ? 'bg-amber-50 text-amber-800 ring-amber-200' : 'bg-slate-100 text-slate-400 ring-slate-200'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10 21a2 2 0 0 0 4 0" />
        {!on && <path d="M3 3l18 18" />}
      </svg>
      Alerts
    </button>
  );
}

export function App({ source }: { source: DataSource }) {
  const [page, setPage] = useState<PageId>('overview');
  const [callId, setCallId] = useState<string | null>(null);
  const closeCall = useCallback(() => setCallId(null), []);
  const current = PAGES.find((p) => p.id === page);
  // Live data is behind the staff password (checked by the server); demo data is open.
  const [status, setStatus] = useState<ServerStatus | null | undefined>(source.mode === 'live' ? undefined : null);
  useEffect(() => {
    if (source.mode !== 'live') return;
    serverStatus().then(setStatus);
    const onAuth = () => setStatus((s) => (s ? { ...s, auth: 'required' } : s));
    window.addEventListener(AUTH_EVENT, onAuth);
    return () => window.removeEventListener(AUTH_EVENT, onAuth);
  }, [source.mode]);
  useEffect(() => {
    document.title = `${current?.label ?? 'Dashboard'} · HALA Concierge`;
  }, [current]);

  if (source.mode === 'live' && status === undefined) return <div className="p-10 text-center text-slate-400">Connecting…</div>;
  if (source.mode === 'live' && status && status.auth !== 'ok')
    return <Login notConfigured={status.auth === 'not_configured'} onDemo={() => switchMode('mock')} />;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <DataProvider source={source} openCall={setCallId} onNavigate={setPage}>
      <div className="flex min-h-full">
        {/* DSO design system: Midnight sidebar, lockup on top, active item in Oasis Navy */}
        <nav className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col bg-midnight px-4 py-6 text-white md:flex">
          <div className="mb-8 px-1">
            <DsoLockup />
            <div className="mt-4 border-t border-white/10 pt-3 font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-cyan">
              HALA Concierge
            </div>
          </div>
          <div className="flex flex-col gap-1">
            {PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPage(p.id)}
                className={`rounded-control px-3.5 py-2.5 text-left text-[15px] transition ${
                  page === p.id ? 'bg-navy-600 text-white' : 'text-white/75 hover:bg-white/5 hover:text-white'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="mt-auto space-y-3 px-1 pt-6">
            <Clock dark />
            <div className="text-[11px] leading-relaxed text-white/50">
              Fees and processing times shown are <b className="text-white/80">DEMO</b> estimates.
            </div>
          </div>
        </nav>

        <main className="min-w-0 flex-1 px-4 py-6 md:px-10 md:py-8">
          <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="font-display text-[15px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                {page === 'overview' ? 'HALA Concierge · Operations' : current?.label}
              </div>
              <h1 className="font-display text-[40px] font-bold leading-tight text-ink">
                {page === 'overview' ? `${greeting}` : current?.label}
              </h1>
              {current?.subtitle && <p className="mt-0.5 text-sm text-slate-600">{current.subtitle}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Health />
              <AlertToggle />
              <ModeSwitch mode={source.mode} auth={status?.auth} />
            </div>
          </div>
          {source.mode === 'mock' && (
            <div role="note" className="mb-5 flex flex-wrap items-center gap-3 rounded-card border-2 border-amber-400 bg-amber-50 px-4 py-3 text-amber-900">
              <span className="rounded-full bg-amber-500 px-2.5 py-0.5 font-display text-[13px] font-bold uppercase tracking-[0.12em] text-white">Demo data</span>
              <span className="text-sm">
                Simulated calls with <b>made-up callers</b>. Nothing on this screen is real.
              </span>
              {liveAvailable() && (
                <Button size="xs" variant="primary" className="ml-auto" onClick={() => switchMode('live')}>
                  Switch to live data
                </Button>
              )}
            </div>
          )}
          <div className="mb-6">
            <FilterBar />
          </div>
          <select
            className="mb-4 w-full rounded-control border border-slate-200 bg-white p-2 md:hidden"
            value={page}
            onChange={(e) => setPage(e.target.value as PageId)}
          >
            {PAGES.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <PageView page={page} />
        </main>
      </div>
      {callId && <CallDrawer callId={callId} onClose={closeCall} />}
      <HandoverAlerts />
      <CallEndedCards />
    </DataProvider>
  );
}
