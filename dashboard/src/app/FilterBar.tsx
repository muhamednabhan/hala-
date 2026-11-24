import type { Filters } from '../data/types';
import { useData } from './DataContext';

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs uppercase tracking-wider text-slate-500">{label}</span>
      <div className="flex rounded-lg bg-slate-900 p-0.5 ring-1 ring-slate-800">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition ${
              value === o.value ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function FilterBar() {
  const { filters, setFilters } = useData();
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Segmented
        label="Range"
        value={filters.range}
        onChange={(v) => set('range', v)}
        options={[
          { value: 'today', label: 'Today' },
          { value: '7d', label: '7 days' },
          { value: 'all', label: 'All' },
        ]}
      />
      <Segmented
        label="Channel"
        value={filters.channel}
        onChange={(v) => set('channel', v)}
        options={[
          { value: 'all', label: 'All' },
          { value: 'robot', label: 'Robot' },
          { value: 'phone', label: 'Phone' },
          { value: 'web', label: 'Web' },
        ]}
      />
      <Segmented
        label="Language"
        value={filters.language}
        onChange={(v) => set('language', v)}
        options={[
          { value: 'all', label: 'All' },
          { value: 'en', label: 'EN' },
          { value: 'ar', label: 'AR' },
        ]}
      />
    </div>
  );
}
