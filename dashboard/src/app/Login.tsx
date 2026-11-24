import { useState, type FormEvent } from 'react';
import { login } from '../data/api';
import { DsoLockup } from '../ui/Badges';
import { Button, inputCls } from '../ui/controls';

/** Full-screen gate shown when the server asks for the dashboard password (live data only). */
export function Login({ notConfigured, onDemo }: { notConfigured?: boolean; onDemo: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const err = await login(password);
    setBusy(false);
    if (err) setError(err);
    else window.location.reload();
  };

  return (
    <div className="flex min-h-full items-center justify-center bg-cloud p-4">
      <div className="w-full max-w-sm overflow-hidden rounded-card border border-slate-200 bg-white shadow-card">
        <div className="bg-midnight px-7 py-6">
          <DsoLockup />
        </div>
        <form onSubmit={submit} className="p-7">
          <div className="mb-5">
            <div className="font-display text-[15px] font-semibold uppercase tracking-[0.14em] text-slate-600">HALA Concierge</div>
            <div className="font-display text-[32px] font-bold leading-tight text-ink">Staff sign in</div>
          </div>
          {notConfigured ? (
            <p className="text-sm text-slate-600">
              Live data is switched off on this deployment until an administrator sets <code className="rounded bg-slate-100 px-1">DASHBOARD_PASSWORD</code>.
            </p>
          ) : (
            <>
              <label className="mb-1 block font-display text-[13px] font-semibold uppercase tracking-[0.12em] text-slate-600" htmlFor="pw">
                Staff password
              </label>
              <input
                id="pw"
                type="password"
                autoFocus
                autoComplete="current-password"
                className={inputCls}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              {error && <div className="mt-2 text-sm text-red-700">{error}</div>}
              <Button type="submit" variant="primary" className="mt-4 w-full" disabled={busy || !password}>
                {busy ? 'Checking…' : 'Sign in'}
              </Button>
            </>
          )}
          <button type="button" onClick={onDemo} className="mt-4 w-full text-center text-xs text-slate-500 hover:text-navy-700">
            Continue with demo data instead
          </button>
        </form>
      </div>
    </div>
  );
}
