import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

/** Minimal KEY=VALUE parser for the agent's env files at the repo root. */
function readEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

/**
 * The Supabase key is a service key (full access, bypasses RLS). Only these calls may pass through
 * the dashboard's proxy; everything else is refused before it reaches Supabase.
 */
const SUPABASE_ALLOW: Record<string, RegExp> = {
  GET: /^\/(hala_bookings|hala_requests|hala_handovers|hala_events|hala_knowledge_answers)(\?|$)/,
  PATCH: /^\/(hala_handovers|hala_bookings|hala_knowledge_answers)\?id=eq\.|^\/(hala_bookings|hala_requests)\?ref=eq\./,
  POST: /^\/hala_knowledge_answers(\?|$)/,
};

function supabaseGuard(): Plugin {
  return {
    name: 'hala-supabase-guard',
    configureServer(server) {
      server.middlewares.use('/sb-api', (req, res, next) => {
        const rule = SUPABASE_ALLOW[req.method ?? ''];
        if (rule && rule.test(req.url ?? '')) return next();
        res.statusCode = 403;
        res.end(`Blocked by dashboard: ${req.method} ${req.url?.split('?')[0]}`);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Order of precedence: dashboard/.env.local, then the agent's files at the repo root
  // (.env.hala written by `agent:sync`, .env.local written by ElevenLabs onboarding).
  const root = resolve(__dirname, '..');
  const fromRoot = { ...readEnvFile(resolve(root, '.env.local')), ...readEnvFile(resolve(root, '.env.hala')) };
  const own = loadEnv(mode, __dirname, '');
  const get = (k: string) => own[k] || fromRoot[k] || process.env[k] || '';

  const talkUrl = get('TALK_APP_URL') || 'http://localhost:3005';
  const adminKey = get('HALA_ADMIN_KEY');
  const toolSecret = get('HALA_TOOL_SECRET');
  const elevenKey = get('ELEVENLABS_API_KEY');
  const supabaseUrl = get('SUPABASE_URL').replace(/\/$/, '');
  const supabaseKey = get('SUPABASE_SERVICE_KEY');
  const supabase = !!(supabaseUrl && supabaseKey);

  return {
    plugins: [react(), supabaseGuard()],
    // Only non-secret values reach the browser bundle.
    define: {
      __HALA_AGENTS__: JSON.stringify({ web: get('HALA_AGENT_ID'), robot: get('HALA_AGENT_ID_ROBOT') }),
      __HALA_PROXY__: JSON.stringify({ talk: !!adminKey, tools: !!toolSecret, eleven: !!elevenKey, supabase, talkUrl }),
    },
    server: {
      port: 5173,
      // Keys are added here, in the dev server, so they never appear in the browser.
      proxy: {
        '/hala-api': {
          target: talkUrl,
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/hala-api/, ''),
          headers: { ...(adminKey ? { 'x-hala-admin-key': adminKey } : {}), ...(toolSecret ? { 'x-hala-secret': toolSecret } : {}) },
        },
        ...(supabase
          ? {
              '/sb-api': {
                target: `${supabaseUrl}/rest/v1`,
                changeOrigin: true,
                secure: true,
                rewrite: (p: string) => p.replace(/^\/sb-api/, ''),
                headers: { apikey: supabaseKey, authorization: `Bearer ${supabaseKey}` },
                // Server-to-server call: drop everything that identifies the browser (Supabase refuses
                // secret keys on browser requests, and cookies have no business going to Supabase).
                configure: (proxy) => {
                  proxy.on('proxyReq', (proxyReq) => {
                    for (const h of proxyReq.getHeaderNames())
                      if (/^(origin|referer|cookie|sec-|user-agent)/.test(h)) proxyReq.removeHeader(h);
                    proxyReq.setHeader('user-agent', 'hala-dashboard-devserver');
                  });
                },
              },
            }
          : {}),
        '/el-api': {
          target: 'https://api.elevenlabs.io',
          changeOrigin: true,
          secure: true,
          rewrite: (p) => p.replace(/^\/el-api/, ''),
          headers: elevenKey ? { 'xi-api-key': elevenKey } : {},
        },
      },
    },
  };
});
