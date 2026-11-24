import type { RequestStatus } from '../data/types';
import { langCode } from './format';
import { STATUS_META } from './status';

export function LangBadge({ lang }: { lang: string | null | undefined }) {
  const code = langCode(lang);
  const cls =
    code === 'AR'
      ? 'bg-teal-50 text-teal-800 ring-teal-200'
      : code === 'EN'
        ? 'bg-indigo-50 text-indigo-800 ring-indigo-200'
        : 'bg-stone-100 text-stone-600 ring-stone-200';
  return (
    <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ${cls}`}>
      {code}
    </span>
  );
}

export function StatusPill({ status }: { status: RequestStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${m.bg} ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}

/** Eight-point star mark used for the brand and section accents. */
export function Emblem({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="9" y="9" width="22" height="22" />
        <rect x="9" y="9" width="22" height="22" transform="rotate(45 20 20)" />
        <circle cx="20" cy="20" r="5" />
      </g>
    </svg>
  );
}
