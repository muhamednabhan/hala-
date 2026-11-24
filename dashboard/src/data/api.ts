// Browser side of the dashboard server (server/handler.ts). Every live-data request goes through here.

export type Upstream = 'sb' | 'el' | 'hala';

/** URL of a forwarded call: the server adds the keys and checks the allow-list. */
export const apiUrl = (upstream: Upstream, path: string) => `/api/proxy?t=${upstream}&p=${encodeURIComponent(path)}`;

/** Fired when the server says "log in first"; App shows the login screen. */
export const AUTH_EVENT = 'hala:auth-required';

export async function getJson<T>(upstream: Upstream, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(upstream, path), { credentials: 'same-origin', ...init });
  const text = await res.text();
  if (res.status === 401) window.dispatchEvent(new Event(AUTH_EVENT));
  if (!res.ok) {
    let msg = text;
    try {
      msg = JSON.parse(text).error ?? JSON.parse(text).message ?? text;
    } catch {
      /* not JSON */
    }
    throw new Error(`${res.status} ${path.split('?')[0]}: ${String(msg).slice(0, 200) || res.statusText}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export interface ServerStatus {
  auth: 'ok' | 'required' | 'not_configured';
  feeds: { supabase: boolean; elevenlabs: boolean; agent: boolean };
}

export async function serverStatus(): Promise<ServerStatus | null> {
  try {
    const res = await fetch('/api/proxy?t=status', { credentials: 'same-origin' });
    return res.ok ? ((await res.json()) as ServerStatus) : null;
  } catch {
    return null;
  }
}

export async function login(password: string): Promise<string | null> {
  const res = await fetch('/api/proxy?t=login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? 'Login failed';
}

export const logout = () => fetch('/api/proxy?t=logout', { method: 'POST', credentials: 'same-origin' });
