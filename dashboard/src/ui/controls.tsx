import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

// DSO design system: Signal Blue for actions, outlined Oasis Navy for secondary; condensed uppercase labels.
const VARIANT: Record<Variant, string> = {
  primary: 'bg-signal text-white hover:bg-signal-600 ring-signal',
  secondary: 'bg-white text-navy-700 ring-navy-600/40 hover:bg-mist',
  ghost: 'bg-transparent text-signal ring-transparent hover:bg-signal-50',
  danger: 'bg-white text-red-700 ring-red-300 hover:bg-red-50',
  success: 'bg-emerald-700 text-white ring-emerald-700 hover:bg-emerald-800',
};

export function Button({
  variant = 'secondary',
  size = 'sm',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: 'xs' | 'sm' }) {
  return (
    <button
      type="button"
      {...rest}
      className={`inline-flex items-center justify-center gap-1.5 rounded-control font-display font-semibold uppercase tracking-[0.06em] ring-1 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-signal disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'xs' ? 'px-2.5 py-1 text-[13px]' : 'px-4 py-2 text-[15px]'
      } ${VARIANT[variant]} ${className}`}
    />
  );
}

export function Modal({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-full max-w-lg overflow-hidden rounded-card bg-white shadow-2xl">
        <div className="px-6 pb-2 pt-5">
          <h3 className="font-display text-[28px] font-bold leading-tight text-ink">{title}</h3>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-6 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-control border border-slate-300 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-signal focus:ring-2 focus:ring-signal-50';

/** Tabs / segmented filter used on list pages. */
export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`-mb-px border-b-2 px-3 py-2 font-display text-[16px] font-semibold tracking-wide transition ${
            value === o.value ? 'border-signal text-ink' : 'border-transparent text-slate-600 hover:text-ink'
          }`}
        >
          {o.label}
          {o.count != null && (
            <span
              className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                value === o.value ? 'bg-signal-50 text-signal-600' : 'bg-slate-100 text-slate-600'
              }`}
            >
              {o.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

/** Wraps an async DataSource action: tracks busy state and shows the error instead of crashing. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);
  const run = useCallback(async (fn: () => Promise<void>, success?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (success) setToast(success);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, []);
  const banner = (
    <>
      {error && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 ring-1 ring-red-200">{error}</div>}
      {toast && (
        <div className="fixed bottom-6 right-6 z-[70] rounded-control bg-midnight px-4 py-2.5 text-sm text-white shadow-xl">
          <span className="mr-2 text-cyan">✓</span>
          {toast}
        </div>
      )}
    </>
  );
  return { run, busy, banner };
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-slate-400">{children}</div>;
}
