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

/** "45s", "12m", "3h 05m", "2d" — how long ago. */
export function fmtAge(iso: string, now = Date.now()) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${String(m % 60).padStart(2, '0')}m`;
  return `${Math.floor(h / 24)}d`;
}

/** Value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string) {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
