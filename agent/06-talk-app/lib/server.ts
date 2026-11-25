import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { createStores } from '@hala/booking'
import type { Stores } from '@hala/core'
import { createSupabaseStores, robotTablesReady, supabaseReady } from '@hala/supabase'
import { createRobotService, type RobotService } from '@hala/robot'
import { createToolApi, type ToolApi } from '@hala/tools-api'
import { HALA_ENV_FILE, ensureToolSecret, readHalaEnv, setHalaVar } from '@hala/provisioning'

/**
 * One set of stores and one tool API per server process.
 *
 * Pinned on globalThis because Next dev can load each route module as a separate instance and
 * hot-reload resets module state: without this, /api/tools and /api/events would see different
 * bookings. Persisted to .data/hala-store.json so a restart keeps bookings and handovers.
 */
interface Hala { api: ToolApi; stores: Stores; robots: RobotService; adminKey: string; secret: string; storeKind: 'supabase' | 'file'; storeNote?: string; robotsNote?: string }
const g = globalThis as unknown as { __hala?: Promise<Hala> }

// The whole project must not be traced into the server bundle: the data and env paths are runtime-only.
export const repoRoot = resolve(/*turbopackIgnore: true*/ process.cwd(), '..', '..')

const halaFile = () => resolve(/*turbopackIgnore: true*/ repoRoot, HALA_ENV_FILE)

/**
 * Settings can change while the app runs (agent:sync writes the agent id, the tunnel URL changes), so read
 * them from process.env first and fall back to the files at request time instead of freezing them at boot.
 */
export const setting = (key: string): string | undefined =>
  // The file wins over the process environment: it is what agent:sync and a new tunnel URL write, and the
  // process environment was only a copy taken at boot, so it goes stale.
  readHalaEnv(halaFile()).get(key) ?? process.env[key] ?? readHalaEnv(resolve(/*turbopackIgnore: true*/ repoRoot, '.env.local')).get(key)

function adminKey(): string {
  const file = halaFile()
  const existing = process.env.HALA_ADMIN_KEY ?? readHalaEnv(file).get('HALA_ADMIN_KEY')
  if (existing) return existing
  const fresh = randomBytes(18).toString('hex')
  setHalaVar('HALA_ADMIN_KEY', fresh, file)
  return fresh
}

/**
 * Supabase when it is configured and the hala_* tables exist; otherwise the local JSON file, with the reason
 * kept in `storeNote` (shown by /api/health). Never fails the app because a database is missing.
 */
async function build(): Promise<Hala> {
  const url = setting('SUPABASE_URL')
  const serviceKey = setting('SUPABASE_SERVICE_KEY')
  let stores: Stores
  let storeKind: Hala['storeKind'] = 'file'
  let storeNote: string | undefined
  let robotTables = false
  if (setting('HALA_STORE') === 'file') {
    storeNote = 'HALA_STORE=file'
  } else if (url && serviceKey && setting('HALA_STORE') === 'supabase') {
    // Trusted: skip the readiness probes (about eight database round trips on EVERY cold start).
    storeKind = 'supabase'
    robotTables = true
  } else if (url && serviceKey) {
    // Both checks at once: a cold start pays for them, and each one is a network trip to the database.
    const [ready, robotsOk] = await Promise.all([supabaseReady({ url, serviceKey }), robotTablesReady({ url, serviceKey })])
    robotTables = robotsOk
    if (ready.ok) storeKind = 'supabase'
    else storeNote = `Supabase not used: ${ready.reason}`
  } else {
    storeNote = 'Supabase is not configured'
  }
  let robotsNote: string | undefined
  const local = () => createStores({ file: resolve(/*turbopackIgnore: true*/ repoRoot, '.data', 'hala-store.json') })
  if (storeKind === 'supabase') {
    const opts = { url: url!, serviceKey: serviceKey! }
    stores = createSupabaseStores(opts)
    if (!robotTables) {
      // Bookings keep using Supabase; robots fall back to the local file until migration 002 is run.
      stores = { ...stores, robots: local().robots }
      robotsNote = 'Robot tables are missing in Supabase: run agent/09-supabase/migrations/002_hala_robots.sql. Robots are kept in a local file until then.'
    }
  } else stores = local()
  if (storeNote) console.warn(`hala: using the local file store. ${storeNote}`)
  const secret = ensureToolSecret(process.env, halaFile())
  const api = createToolApi({
    stores, deferEvents: true, secret,
    // The Smart Pass QR must open on a phone, so it points at the public tunnel, read at request time because the URL changes.
    passBaseUrl: () => setting('PUBLIC_BASE_URL'),
    // A booking or logged request is texted to the caller's linked phone (loaded lazily: the phone module builds on top of this one).
    onFulfilled: async (f, conversationId) => (await import('@/lib/phone')).deliverPass(f, conversationId)
  })
  // Build the phone side now, in the background, so the first booking does not pay for it. Same for the score timer.
  queueMicrotask(() => {
    void import('@/lib/phone').then((m) => m.phone()).catch(() => undefined)
    void import('@/lib/scoring').then((m) => m.startScoringTimer()).catch(() => undefined)
  })
  return { stores, storeKind, storeNote, robotsNote, robots: createRobotService({ robots: stores.robots }), api, adminKey: adminKey(), secret }
}

export const hala = (): Promise<Hala> => (g.__hala ??= build())

export const hasApiKey = () => Boolean(setting('ELEVENLABS_API_KEY'))
export const hasToolSecret = () => Boolean(setting('HALA_TOOL_SECRET'))
export const hasPublicUrl = () => Boolean(setting('PUBLIC_BASE_URL'))

/** Server-side settings lookup for routes that need one (voice id etc.). */
export const setting_ = setting

export type Channel = 'web' | 'robot' | 'phone'
export const agentId = (channel: Channel = 'web') =>
  setting(channel === 'robot' ? 'HALA_AGENT_ID_ROBOT' : channel === 'phone' ? 'HALA_AGENT_ID_PHONE' : 'HALA_AGENT_ID')

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })

/** Admin check for the dashboard endpoints. */
export async function isAdmin(req: Request): Promise<boolean> {
  const given = req.headers.get('x-hala-admin-key') ?? new URL(req.url).searchParams.get('key') ?? ''
  const key = (await hala()).adminKey
  return given.length === key.length && given === key
}
