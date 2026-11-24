export const fmtInt = (n: number) => n.toLocaleString('en-US');

export const fmtPct = (part: number, total: number, digits = 0) =>
  total ? `${((100 * part) / total).toFixed(digits)}%` : '—';

export function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtDateTime(iso: string) {
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} ${fmtTime(iso)}`;
}

export function fmtDuration(secs: number | null) {
  if (secs == null) return '—';
  const s = Math.round(secs);
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

export const langCode = (lang: string | null | undefined) =>
  lang === 'ar' ? 'AR' : lang === 'en' ? 'EN' : lang === 'mixed' ? 'MIX' : '—';
