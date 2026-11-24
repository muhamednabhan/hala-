import { describe, expect, it } from 'vitest';
import { checkSession, makeSession, readCookie, samePassword } from './auth.js';
import { envFrom, isAllowed, upstreamRequest } from './rules.js';

describe('allow-list (the security boundary for the service key)', () => {
  it.each([
    ['sb', 'GET', '/hala_bookings?select=*&order=created_at.desc&limit=1000'],
    ['sb', 'GET', '/hala_phone_rings?select=*'],
    ['sb', 'PATCH', '/hala_handovers?id=eq.HO-25f74afb'],
    ['sb', 'PATCH', '/hala_requests?ref=eq.REQ-1001'],
    ['sb', 'PATCH', '/hala_bookings?ref=eq.HALA-1004'],
    ['sb', 'POST', '/hala_knowledge_answers?on_conflict=question_norm'],
    ['el', 'GET', '/v1/convai/conversations?agent_id=a&page_size=100'],
    ['el', 'GET', '/v1/convai/conversations/conv_6401m876p0hpfpgtr5wz99q38p5r'],
    ['hala', 'GET', '/api/admin/events'],
    ['hala', 'GET', '/api/events'],
    ['hala', 'POST', '/api/tools/cancel_appointment'],
  ])('allows %s %s %s', (up, method, path) => expect(isAllowed(up, method, path)).toBe(true));

  it.each([
    ['sb', 'GET', '/bookings?select=*'], // the older table the agent never touches
    ['sb', 'GET', '/hala_idempotency'],
    ['sb', 'GET', '/hala_robots'], // holds robot tokens
    ['sb', 'GET', '/rpc/anything'],
    ['sb', 'DELETE', '/hala_bookings?ref=eq.HALA-1001'],
    ['sb', 'PATCH', '/hala_bookings'], // bulk update
    ['sb', 'PATCH', '/hala_bookings?status=eq.confirmed'], // bulk by filter
    ['sb', 'PATCH', '/hala_bookings?ref=eq.HALA-1&or=(ref.neq.x)'], // filter smuggling
    ['sb', 'POST', '/hala_events'],
    ['sb', 'GET', '/../auth/v1/admin/users'],
    ['el', 'DELETE', '/v1/convai/conversations/conv_1'],
    ['el', 'GET', '/v1/user'],
    ['el', 'POST', '/v1/convai/agents/create'],
    ['hala', 'POST', '/api/tools/book_appointment'],
    ['hala', 'GET', '/api/token'],
    ['zz', 'GET', '/hala_bookings'],
  ])('blocks %s %s %s', (up, method, path) => expect(isAllowed(up, method, path)).toBe(false));

  it('sends only server-made headers upstream', () => {
    const env = envFrom((k) => ({ SUPABASE_URL: 'https://x.supabase.co/', SUPABASE_SERVICE_KEY: 'sk' })[k]);
    const up = upstreamRequest(env, 'sb', '/hala_events', 'return=minimal')!;
    expect(up.url).toBe('https://x.supabase.co/rest/v1/hala_events');
    expect(Object.keys(up.headers).sort()).toEqual(['apikey', 'authorization', 'content-type', 'prefer', 'user-agent']);
    expect(upstreamRequest(env, 'sb', '/x', 'evil\r\nheader: 1')!.headers.prefer).toBeUndefined();
    expect(upstreamRequest(env, 'el', '/v1/convai/conversations')).toBeNull(); // no key configured
  });

  it('requires a password on a deployment', () => {
    expect(envFrom((k) => ({ VERCEL: '1' })[k]).deployed).toBe(true);
    expect(envFrom(() => undefined).deployed).toBe(false);
  });
});

describe('login', () => {
  it('accepts a fresh session and rejects tampered, expired or wrong-password ones', () => {
    const token = makeSession('pw');
    expect(checkSession('pw', token)).toBe(true);
    expect(checkSession('other', token)).toBe(false);
    expect(checkSession('pw', token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')))).toBe(false);
    expect(checkSession('pw', makeSession('pw', Date.now() - 13 * 3600e3))).toBe(false);
    expect(checkSession('pw', undefined)).toBe(false);
    expect(checkSession('', token)).toBe(false);
  });

  it('compares passwords safely', () => {
    expect(samePassword('secret', 'secret')).toBe(true);
    expect(samePassword('secret', 'Secret')).toBe(false);
    expect(samePassword('secret', undefined)).toBe(false);
    expect(samePassword('', '')).toBe(false);
  });

  it('reads the session cookie', () => {
    expect(readCookie('a=1; hala_session=abc.def; b=2')).toBe('abc.def');
    expect(readCookie(undefined)).toBeUndefined();
  });
});
