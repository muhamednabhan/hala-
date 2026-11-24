// The dashboard's only server code. Same handler runs in the Vite dev server (vite.config.ts) and as a
// Vercel function (api/proxy.ts), so local and deployed behave identically.
//
//   GET  /api/proxy?t=status                       → { auth: 'ok' | 'required' | 'not_configured', feeds }
//   POST /api/proxy?t=login   { password }          → sets the session cookie
//   POST /api/proxy?t=logout
//   ANY  /api/proxy?t=sb|el|hala&p=<path?query>    → forwarded with keys, if server/rules.ts allows it

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import { checkSession, clearCookie, makeSession, readCookie, samePassword, sessionCookie } from './auth.js';
import { isAllowed, upstreamRequest, type ProxyEnv, type Upstream } from './rules.js';

type Req = IncomingMessage & { body?: unknown };

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

async function readBody(req: Req): Promise<string | undefined> {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  // Vercel pre-parses JSON bodies; the Vite dev server doesn't.
  if (req.body !== undefined) return typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 64 * 1024) throw new Error('body too large');
    chunks.push(c as Buffer);
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : undefined;
}

const isHttps = (req: Req) => req.headers['x-forwarded-proto'] === 'https' || !!(req.socket as { encrypted?: boolean }).encrypted;

export async function handle(req: Req, res: ServerResponse, env: ProxyEnv): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://local');
  const t = url.searchParams.get('t') ?? '';
  const method = (req.method ?? 'GET').toUpperCase();
  const secure = isHttps(req);

  // ---- login ----
  const loginRequired = !!env.password || env.deployed;
  const loggedIn = !loginRequired || checkSession(env.password, readCookie(req.headers.cookie));

  if (t === 'status') {
    return send(res, 200, {
      auth: env.deployed && !env.password ? 'not_configured' : loggedIn ? 'ok' : 'required',
      feeds: { supabase: !!(env.supabaseUrl && env.supabaseKey), elevenlabs: !!env.elevenKey, agent: !!(env.adminKey || env.toolSecret) },
    });
  }
  if (t === 'login' && method === 'POST') {
    if (!env.password) return send(res, 400, { error: 'No DASHBOARD_PASSWORD is set on the server.' });
    let given: unknown;
    try {
      given = JSON.parse((await readBody(req)) ?? '{}').password;
    } catch {
      given = undefined;
    }
    if (!samePassword(env.password, given)) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      return send(res, 401, { error: 'Wrong password' });
    }
    return send(res, 200, { ok: true }, { 'set-cookie': sessionCookie(makeSession(env.password), secure) });
  }
  if (t === 'logout') return send(res, 200, { ok: true }, { 'set-cookie': clearCookie(secure) });

  // ---- data ----
  if (env.deployed && !env.password) return send(res, 503, { error: 'Set DASHBOARD_PASSWORD on the server before using live data.' });
  if (!loggedIn) return send(res, 401, { error: 'Login required' });

  const path = url.searchParams.get('p') ?? '';
  if (!['sb', 'el', 'hala'].includes(t) || !isAllowed(t, method, path))
    return send(res, 403, { error: `Blocked by dashboard: ${method} ${t}:${path.split('?')[0]}` });

  const up = upstreamRequest(env, t as Upstream, path, req.headers.prefer as string | undefined);
  if (!up) return send(res, 503, { error: `${t === 'sb' ? 'Supabase' : t === 'el' ? 'ElevenLabs' : 'Agent server'} keys are not set on the server.` });

  let upstream: Response;
  try {
    upstream = await fetch(up.url, { method, headers: up.headers, body: await readBody(req) });
  } catch (e) {
    return send(res, 502, { error: `Could not reach ${new URL(up.url).host}: ${(e as Error).message}` });
  }
  res.statusCode = upstream.status;
  for (const h of ['content-type', 'content-range']) {
    const v = upstream.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  res.setHeader('cache-control', 'no-store');
  if (!upstream.body) return void res.end();
  // Streams too (the agent's live event feed is server-sent events).
  Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
}
