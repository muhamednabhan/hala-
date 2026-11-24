// Stateless login: the cookie holds an HMAC of the password, so changing DASHBOARD_PASSWORD logs everyone out.
// HttpOnly cookie: page scripts can never read it.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const COOKIE = 'hala_session';
const MAX_AGE_SECS = 12 * 3600;

const sign = (password: string, expires: number) => createHmac('sha256', password).update(`hala-dashboard:${expires}`).digest('base64url');

export function makeSession(password: string, now = Date.now()): string {
  const expires = Math.floor(now / 1000) + MAX_AGE_SECS;
  return `${expires}.${sign(password, expires)}`;
}

export function checkSession(password: string, token: string | undefined, now = Date.now()): boolean {
  if (!password || !token) return false;
  const [exp, mac] = token.split('.');
  const expires = Number(exp);
  if (!Number.isFinite(expires) || expires * 1000 < now || !mac) return false;
  const want = Buffer.from(sign(password, expires));
  const got = Buffer.from(mac);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function samePassword(expected: string, given: unknown): boolean {
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(createHmac('sha256', 'cmp').update(expected).digest());
  const b = Buffer.from(createHmac('sha256', 'cmp').update(given).digest());
  return timingSafeEqual(a, b);
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SECS}${secure ? '; Secure' : ''}`;
}

export const clearCookie = (secure: boolean) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;

export function readCookie(header: string | undefined, name = COOKIE): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
