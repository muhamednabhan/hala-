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
  // DSO dashboard style (WEEK / MONTH / QUARTER): separate outlined buttons, active one filled Oasis Navy.
  return (
    <div className="flex items-center gap-2">
      <span className="font-display text-[13px] font-semibold uppercase tracking-[0.14em] text-slate-600">{label}</span>
      <div className="flex gap-1.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={`rounded-control border px-3 py-1.5 font-display text-[14px] font-semibold uppercase tracking-[0.08em] transition ${
              value === o.value ? 'border-navy-600 bg-navy-600 text-white' : 'border-slate-300 bg-white text-navy-700 hover:border-navy-400'
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
  const { filters, setFilters, source } = useData();
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters({ ...filters, [k]: v });
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <Segmented
        label="Period"
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
      {source.mode === 'live' && (
        <label className="flex cursor-pointer items-center gap-1.5 text-sm text-slate-600">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[#194176]"
            checked={filters.hideTests}
            onChange={(e) => set('hideTests', e.target.checked)}
          />
          Hide test calls
        </label>
      )}
    </div>
  );
}
