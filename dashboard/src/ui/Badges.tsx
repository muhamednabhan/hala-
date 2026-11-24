import type { RequestStatus } from '../data/types';
import { langCode } from './format';
import { STATUS_META } from './status';

export function LangBadge({ lang }: { lang: string | null | undefined }) {
  const code = langCode(lang);
  const cls =
    code === 'AR'
      ? 'bg-teal-500/20 text-teal-300 ring-teal-500/40'
      : code === 'EN'
        ? 'bg-indigo-500/20 text-indigo-300 ring-indigo-500/40'
        : 'bg-slate-500/20 text-slate-300 ring-slate-500/40';
  return <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-bold ring-1 ${cls}`}>{code}</span>;
}

export function StatusPill({ status }: { status: RequestStatus }) {
  const m = STATUS_META[status];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${m.bg} ${m.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot}`} />
      {m.label}
    </span>
  );
}
