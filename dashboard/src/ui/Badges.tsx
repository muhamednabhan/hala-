import type { RequestStatus } from '../data/types';
import { langCode } from './format';
import { STATUS_META } from './status';

export function LangBadge({ lang }: { lang: string | null | undefined }) {
  const code = langCode(lang);
  const cls =
    code === 'AR'
      ? 'bg-signal-50 text-signal-600 ring-signal/30'
      : code === 'EN'
        ? 'bg-mist text-navy-700 ring-navy-200'
        : 'bg-slate-100 text-slate-600 ring-slate-200';
  return (
    <span className={`inline-flex shrink-0 rounded-full px-2 py-0.5 font-display text-[12px] font-semibold tracking-wider ring-1 ${cls}`}>
      {code}
    </span>
  );
}

const ICON: Record<string, string> = {
  // robot head, handset, monitor (24px line icons)
  robot: 'M12 2v3M8 9h.01M16 9h.01M5 7h14a1 1 0 0 1 1 1v8a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V8a1 1 0 0 1 1-1zM9 14h6',
  phone: 'M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z',
  web: 'M3 5h18v11H3zM8 20h8M12 16v4',
};
const CHANNEL: Record<string, { label: string; icon: string; cls: string }> = {
  robot: { label: 'Robot', icon: ICON.robot, cls: 'bg-navy-50 text-navy-800 ring-navy-200' },
  phone: { label: 'Phone', icon: ICON.phone, cls: 'bg-sky-50 text-sky-800 ring-sky-200' },
  web: { label: 'Web', icon: ICON.web, cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
};

/** Where the conversation happened: the robot at HALA reception, a phone call, or the web talk page. */
export function ChannelBadge({ channel }: { channel: string | null | undefined }) {
  const c = CHANNEL[channel ?? ''] ?? CHANNEL.web;
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold ring-1 ${c.cls}`}>
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d={c.icon} />
      </svg>
      {c.label}
    </span>
  );
}

/** Marks a call HALA made itself (reminder / callback). */
export function OutboundBadge({ reason }: { reason?: string | null }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-semibold text-violet-800 ring-1 ring-violet-200">
      ↗ HALA called{reason ? ` · ${reason}` : ''}
    </span>
  );
}

const MOOD: Record<string, { label: string; cls: string; face: string }> = {
  positive: { label: 'Positive', cls: 'bg-emerald-50 text-emerald-800 ring-emerald-200', face: 'M8 14s1.5 2 4 2 4-2 4-2' },
  neutral: { label: 'Neutral', cls: 'bg-slate-100 text-slate-700 ring-slate-200', face: 'M8 15h8' },
  negative: { label: 'Negative', cls: 'bg-red-50 text-red-700 ring-red-200', face: 'M16 16s-1.5-2-4-2-4 2-4 2' },
};

/** Caller sentiment, only when a real source measured it (title says which). */
export function MoodBadge({ mood }: { mood: { label: string; detail: string } | null | undefined }) {
  if (!mood) return <span className="text-xs text-slate-500">Not measured</span>;
  const m = MOOD[mood.label] ?? MOOD.neutral;
  return (
    <span title={mood.detail} className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${m.cls}`}>
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d={m.face} />
        <path d="M9 9.5h.01M15 9.5h.01" />
      </svg>
      {m.label}
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

/**
 * The DSO mark: linked nodes ("Connected": people, ideas and industries joined up).
 * Drawn from the design system for the dashboard only; use the official artwork for anything printed.
 */
export function Emblem({ className = 'h-6 w-auto' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 30" className={className} fill="currentColor" aria-hidden="true">
      <rect x="18" y="5.6" width="26" height="2.4" rx="1.2" />
      <rect x="4" y="13.8" width="56" height="2.4" rx="1.2" />
      <rect x="20" y="22" width="24" height="2.4" rx="1.2" />
      <ellipse cx="20" cy="6.8" rx="5.6" ry="4" />
      <ellipse cx="42" cy="6.8" rx="5.6" ry="4" />
      <ellipse cx="7" cy="15" rx="5.6" ry="4" />
      <ellipse cx="32" cy="15" rx="5.6" ry="4" />
      <ellipse cx="57" cy="15" rx="5.6" ry="4" />
      <ellipse cx="22" cy="23.2" rx="5.6" ry="4" />
      <ellipse cx="42" cy="23.2" rx="5.6" ry="4" />
    </svg>
  );
}

/** Reversed lockup (white on Midnight / Navy), as in the design system's dashboard. */
export function DsoLockup() {
  return (
    <div className="text-white">
      <Emblem className="h-9 w-auto" />
      <div className="mt-1.5 text-right text-[11px] leading-none text-white/80" dir="rtl" lang="ar">
        واحة دبي للسيليكون
      </div>
      <div className="font-display text-[15px] font-medium leading-tight tracking-wide">Dubai Silicon Oasis</div>
    </div>
  );
}
