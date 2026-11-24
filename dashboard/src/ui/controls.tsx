import { useCallback, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

const VARIANT: Record<Variant, string> = {
  primary: 'bg-gold-600 text-white hover:bg-gold-700 ring-gold-600',
  secondary: 'bg-white text-ink ring-stone-300 hover:bg-stone-50',
  ghost: 'bg-transparent text-stone-600 ring-transparent hover:bg-stone-100',
  danger: 'bg-white text-red-700 ring-red-200 hover:bg-red-50',
  success: 'bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-700',
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-medium ring-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'xs' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'
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
      <div className="relative w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="h-1 bg-gradient-to-r from-gold-700 via-gold-400 to-gold-700" />
        <div className="px-6 pb-2 pt-5">
          <h3 className="font-display text-2xl font-bold text-ink">{title}</h3>
          {subtitle && <div className="mt-1 text-sm text-stone-500">{subtitle}</div>}
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-6 py-3">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-stone-100 bg-stone-50 px-6 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.12em] text-stone-500">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-stone-400">{hint}</span>}
    </label>
  );
}

export const inputCls =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-ink outline-none focus:border-gold-400 focus:ring-2 focus:ring-gold-100';

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
    <div className="flex flex-wrap gap-1 border-b border-stone-200">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
            value === o.value ? 'border-gold-500 text-ink' : 'border-transparent text-stone-500 hover:text-ink'
          }`}
        >
          {o.label}
          {o.count != null && (
            <span
              className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[11px] tabular-nums ${
                value === o.value ? 'bg-gold-100 text-gold-800' : 'bg-stone-100 text-stone-500'
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
        <div className="fixed bottom-6 right-6 z-[70] rounded-lg bg-ink px-4 py-2.5 text-sm text-white shadow-xl">
          <span className="mr-2 text-gold-300">✓</span>
          {toast}
        </div>
      )}
    </>
  );
  return { run, busy, banner };
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-12 text-center text-sm text-stone-400">{children}</div>;
}
