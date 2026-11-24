import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataSource } from '../data/source';
import { DEFAULT_FILTERS, type Filters } from '../data/types';

interface Ctx {
  source: DataSource;
  filters: Filters;
  setFilters: (f: Filters) => void;
  /** Bumps whenever the source reports a change; queries re-run on it. */
  version: number;
  openCall: (callId: string) => void;
}

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({
  source,
  openCall,
  children,
}: {
  source: DataSource;
  openCall: (callId: string) => void;
  children: ReactNode;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [version, setVersion] = useState(0);
  useEffect(() => source.subscribe(() => setVersion((v) => v + 1)), [source]);
  return <DataCtx.Provider value={{ source, filters, setFilters, version, openCall }}>{children}</DataCtx.Provider>;
}

export function useData(): Ctx {
  const ctx = useContext(DataCtx);
  if (!ctx) throw new Error('useData must be used inside <DataProvider>');
  return ctx;
}

/** Run a DataSource read; re-runs on filter change and on every data change. */
export function useQuery<T>(fn: (source: DataSource, filters: Filters) => Promise<T>) {
  const { source, filters, version } = useData();
  const [state, setState] = useState<{ data?: T; error: string | null }>({ error: null });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    let alive = true;
    fnRef
      .current(source, filters)
      .then((data) => alive && setState({ data, error: null }))
      .catch((e: unknown) => alive && setState((s) => ({ ...s, error: e instanceof Error ? e.message : String(e) })));
    return () => {
      alive = false;
    };
  }, [source, filters, version]);
  return state;
}
