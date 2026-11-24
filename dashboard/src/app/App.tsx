import { useCallback, useState } from 'react';
import type { DataSource } from '../data/source';
import { PAGES, type PageId } from '../widgets/registry';
import { CallDrawer } from './CallDrawer';
import { DataProvider } from './DataContext';
import { FilterBar } from './FilterBar';
import { PageView } from './PageView';

export function App({ source }: { source: DataSource }) {
  const [page, setPage] = useState<PageId>('overview');
  const [callId, setCallId] = useState<string | null>(null);
  const closeCall = useCallback(() => setCallId(null), []);

  return (
    <DataProvider source={source} openCall={setCallId}>
      <div className="flex min-h-full">
        <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-slate-800 bg-slate-950 p-4 md:flex">
          <div className="mb-6 px-2">
            <div className="text-lg font-extrabold tracking-tight">
              HALA <span className="text-emerald-400">Concierge</span>
            </div>
            <div className="text-xs text-slate-500">DSO voice agent · Admin</div>
          </div>
          {PAGES.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPage(p.id)}
              className={`rounded-lg px-3 py-2 text-left text-sm font-medium transition ${
                page === p.id ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
              }`}
            >
              {p.label}
            </button>
          ))}
        </nav>

        <main className="min-w-0 flex-1 p-4 md:p-6">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold">{PAGES.find((p) => p.id === page)?.label}</h1>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  source.mode === 'mock' ? 'bg-amber-500/20 text-amber-300' : 'bg-emerald-500/20 text-emerald-300'
                }`}
              >
                {source.mode === 'mock' ? 'MOCK DATA' : 'LIVE'}
              </span>
            </div>
            <FilterBar />
          </header>
          {/* Mobile page switcher */}
          <select
            className="mb-4 w-full rounded-lg bg-slate-900 p-2 md:hidden"
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
    </DataProvider>
  );
}
