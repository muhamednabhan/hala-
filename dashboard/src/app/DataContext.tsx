import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { DataSource } from '../data/source';
import { DEFAULT_FILTERS, type Filters, type RequestStatus } from '../data/types';
import type { PageId } from '../widgets/types';

/** Where a click should land: a page, optionally pre-filtered (e.g. Requests showing only "Open"). */
export interface NavTarget {
  page: PageId;
  status?: 'all' | RequestStatus;
  service?: string;
  tab?: string;
}

interface Ctx {
  source: DataSource;
  filters: Filters;
  setFilters: (f: Filters) => void;
  /** Bumps whenever the source reports a change; queries re-run on it. */
  version: number;
  openCall: (callId: string) => void;
  /** Go to a page (and pre-set its filter). Metric cards and insights use this. */
  navigate: (to: NavTarget) => void;
  /** The last navigation target; list pages read their initial filter from it. */
  nav: (NavTarget & { at: number }) | null;
}

const DataCtx = createContext<Ctx | null>(null);

export function DataProvider({
  source,
  openCall,
  onNavigate,
  children,
}: {
  source: DataSource;
  openCall: (callId: string) => void;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
}) {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [version, setVersion] = useState(0);
  const [nav, setNav] = useState<Ctx['nav']>(null);
  useEffect(() => source.subscribe(() => setVersion((v) => v + 1)), [source]);
  const navigate = (to: NavTarget) => {
    setNav({ ...to, at: Date.now() });
    onNavigate(to.page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  return <DataCtx.Provider value={{ source, filters, setFilters, version, openCall, navigate, nav }}>{children}</DataCtx.Provider>;
}

/** Initial value for a list page's filter: from the click that brought us here, else the default. */
export function useNavPreset<K extends 'status' | 'service' | 'tab'>(page: PageId, key: K, fallback: NonNullable<NavTarget[K]>) {
  const { nav } = useData();
  const want = nav?.page === page ? nav[key] : undefined;
  const [value, setValue] = useState<NonNullable<NavTarget[K]>>((want ?? fallback) as NonNullable<NavTarget[K]>);
  useEffect(() => {
    if (nav?.page === page && nav[key] !== undefined) setValue(nav[key] as NonNullable<NavTarget[K]>);
  }, [nav, page, key]);
  return [value, setValue] as const;
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
