import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { handle } from './server/handler.js';
import { envFrom } from './server/rules.js';

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

/** Serves /api/proxy in development with exactly the code Vercel runs in production (api/proxy.ts). */
function dashboardServer(get: (k: string) => string): Plugin {
  return {
    name: 'hala-dashboard-server',
    configureServer(server) {
      server.middlewares.use('/api/proxy', (req, res) => {
        handle(req, res, envFrom(get)).catch((e: Error) => {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: e.message }));
        });
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Settings, first match wins: dashboard/.env.local, the agent's files at the repo root
  // (.env.hala from `agent:sync`, .env.local from ElevenLabs onboarding), then the process (Vercel).
  const root = resolve(__dirname, '..');
  const fromRoot = { ...readEnvFile(resolve(root, '.env.local')), ...readEnvFile(resolve(root, '.env.hala')) };
  const own = loadEnv(mode, __dirname, '');
  const get = (k: string) => own[k] || fromRoot[k] || process.env[k] || '';
  const env = envFrom(get);

  return {
    plugins: [react(), dashboardServer(get)],
    // Only non-secret facts reach the browser bundle: agent ids and which feeds are configured.
    define: {
      __HALA_AGENTS__: JSON.stringify({ web: get('HALA_AGENT_ID'), robot: get('HALA_AGENT_ID_ROBOT') }),
      __HALA_PROXY__: JSON.stringify({
        talk: !!env.adminKey,
        tools: !!env.toolSecret,
        eleven: !!env.elevenKey,
        supabase: !!(env.supabaseUrl && env.supabaseKey),
        talkUrl: env.talkUrl,
      }),
    },
    server: { port: 5173 },
  };
});
