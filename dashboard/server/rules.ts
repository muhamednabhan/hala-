// What the dashboard's server is allowed to forward. Pure functions, no I/O: unit-tested in server/rules.test.ts.
//
// The Supabase key is a SERVICE key (bypasses row-level security), so the allow-list is the real security
// boundary: anything not listed here is refused before it reaches Supabase, ElevenLabs or the agent server.

export type Upstream = 'sb' | 'el' | 'hala';

const SB_TABLES_READ = [
  'hala_bookings',
  'hala_requests',
  'hala_handovers',
  'hala_events',
  'hala_knowledge_answers',
  'hala_robot_logs',
  'hala_phone_conversations',
  'hala_phone_messages',
  'hala_phone_rings',
  'hala_phone_contacts',
];

const RULES: Record<Upstream, Record<string, RegExp>> = {
  // path is relative to <SUPABASE_URL>/rest/v1
  sb: {
    GET: new RegExp(`^/(${SB_TABLES_READ.join('|')})(\\?|$)`),
    // one row at a time, by primary key: no bulk updates
    PATCH: /^\/(hala_handovers|hala_knowledge_answers)\?id=eq\.[^&]+$|^\/(hala_bookings|hala_requests)\?ref=eq\.[^&]+$/,
    POST: /^\/hala_knowledge_answers(\?on_conflict=question_norm)?$/,
  },
  // path is relative to https://api.elevenlabs.io
  el: {
    GET: /^\/v1\/convai\/conversations(\/[A-Za-z0-9_-]+)?(\?|$)/,
  },
  // path is relative to the agent server (agent/06-talk-app)
  hala: {
    GET: /^\/api\/(admin\/(bookings|requests|handovers|events)|events|health)(\?|$)/,
    POST: /^\/api\/tools\/(cancel_appointment|reschedule_appointment)$/,
  },
};

export function isAllowed(upstream: string, method: string, path: string): boolean {
  if (!path.startsWith('/') || path.includes('..') || /[\r\n]/.test(path)) return false;
  const rule = RULES[upstream as Upstream]?.[method.toUpperCase()];
  return !!rule && rule.test(path);
}

export interface ProxyEnv {
  supabaseUrl: string;
  supabaseKey: string;
  elevenKey: string;
  talkUrl: string;
  adminKey: string;
  toolSecret: string;
  /** Shared admin password. Empty = no login (only allowed when running locally). */
  password: string;
  /** True on a public deployment: then a password is mandatory. */
  deployed: boolean;
}

export function envFrom(get: (k: string) => string | undefined): ProxyEnv {
  const v = (k: string) => (get(k) ?? '').trim();
  return {
    supabaseUrl: v('SUPABASE_URL').replace(/\/$/, ''),
    supabaseKey: v('SUPABASE_SERVICE_KEY'),
    elevenKey: v('ELEVENLABS_API_KEY'),
    talkUrl: (v('TALK_APP_URL') || 'http://localhost:3005').replace(/\/$/, ''),
    adminKey: v('HALA_ADMIN_KEY'),
    toolSecret: v('HALA_TOOL_SECRET'),
    password: v('DASHBOARD_PASSWORD'),
    deployed: !!v('VERCEL') || v('NODE_ENV') === 'production',
  };
}

/** Upstream URL + headers for an allowed request. Only these headers are sent: nothing from the browser leaks. */
export function upstreamRequest(env: ProxyEnv, upstream: Upstream, path: string, prefer?: string) {
  if (upstream === 'sb') {
    if (!env.supabaseUrl || !env.supabaseKey) return null;
    return {
      url: `${env.supabaseUrl}/rest/v1${path}`,
      headers: {
        apikey: env.supabaseKey,
        authorization: `Bearer ${env.supabaseKey}`,
        'content-type': 'application/json',
        'user-agent': 'hala-dashboard-server',
        ...(prefer && /^[a-z=,\-\s]+$/i.test(prefer) ? { prefer } : {}),
      } as Record<string, string>,
    };
  }
  if (upstream === 'el') {
    if (!env.elevenKey) return null;
    return { url: `https://api.elevenlabs.io${path}`, headers: { 'xi-api-key': env.elevenKey } as Record<string, string> };
  }
  if (!env.adminKey && !env.toolSecret) return null;
  return {
    url: `${env.talkUrl}${path}`,
    headers: {
      'content-type': 'application/json',
      ...(env.adminKey ? { 'x-hala-admin-key': env.adminKey } : {}),
      ...(env.toolSecret ? { 'x-hala-secret': env.toolSecret } : {}),
    } as Record<string, string>,
  };
}
