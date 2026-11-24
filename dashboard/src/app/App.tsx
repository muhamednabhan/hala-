import { useCallback, useEffect, useState } from 'react';
import type { DataSource } from '../data/source';
import { Emblem } from '../ui/Badges';
import { PAGES, type PageId } from '../widgets/registry';
import { CallDrawer } from './CallDrawer';
import { DataProvider } from './DataContext';
import { FilterBar } from './FilterBar';
import { PageView } from './PageView';

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="text-right leading-tight">
      <div className="text-sm font-semibold tabular-nums text-ink">
        {now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
      </div>
      <div className="text-[11px] text-stone-500">
        {now.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      </div>
    </div>
  );
}

export function App({ source }: { source: DataSource }) {
  const [page, setPage] = useState<PageId>('overview');
  const [callId, setCallId] = useState<string | null>(null);
  const closeCall = useCallback(() => setCallId(null), []);
  const current = PAGES.find((p) => p.id === page);

  return (
    <DataProvider source={source} openCall={setCallId}>
      <div className="flex min-h-full flex-col">
        <div className="h-1 bg-gradient-to-r from-gold-700 via-gold-400 to-gold-700" />
        <header className="flex items-center justify-between gap-4 border-b border-stone-200 bg-white px-6 py-3">
          <div className="flex items-center gap-3">
            <Emblem className="h-9 w-9 text-gold-600" />
            <div className="leading-tight">
              <div className="font-display text-[22px] font-bold tracking-wide text-ink">
                HALA <span className="text-gold-600">Concierge</span>
              </div>
              <div className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                Smart Services · Operations Centre
              </div>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <span
              className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ring-1 ${
                source.mode === 'mock'
                  ? 'bg-gold-50 text-gold-800 ring-gold-200'
                  : 'bg-emerald-50 text-emerald-700 ring-emerald-200'
              }`}
            >
              {source.mode === 'mock' ? 'Demo data' : '● Live'}
            </span>
            <Clock />
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-60 shrink-0 flex-col gap-0.5 border-r border-stone-200 bg-white px-3 py-5 md:flex">
            <div className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-400">Menu</div>
            {PAGES.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPage(p.id)}
                className={`flex items-center justify-between border-l-2 px-3 py-2 text-left text-sm font-medium transition ${
                  page === p.id
                    ? 'border-gold-500 bg-gold-50 text-gold-900'
                    : 'border-transparent text-stone-600 hover:bg-stone-50 hover:text-ink'
                }`}
              >
                {p.label}
                {!p.ready && <span className="text-[10px] uppercase tracking-wider text-stone-400">soon</span>}
              </button>
            ))}
            <div className="mt-auto px-3 pt-6 text-[11px] leading-relaxed text-stone-400">
              Fees and processing times shown are <b className="text-gold-700">DEMO</b> estimates.
            </div>
          </nav>

          <main className="min-w-0 flex-1 px-4 py-6 md:px-8">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div>
                <h1 className="font-display text-3xl font-bold text-ink">{current?.label}</h1>
                {current?.subtitle && <p className="mt-0.5 text-sm text-stone-500">{current.subtitle}</p>}
              </div>
              <FilterBar />
            </div>
            <select
              className="mb-4 w-full rounded-lg border border-stone-200 bg-white p-2 md:hidden"
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
      </div>
      {callId && <CallDrawer callId={callId} onClose={closeCall} />}
    </DataProvider>
  );
}
