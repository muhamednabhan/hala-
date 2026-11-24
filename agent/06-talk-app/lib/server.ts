import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
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
interface Hala { api: ToolApi; stores: Stores; robots: RobotService; adminKey: string; storeKind: 'supabase' | 'file'; storeNote?: string; robotsNote?: string }
const g = globalThis as unknown as { __hala?: Promise<Hala>; __halaEleven?: ElevenLabsClient }

// The whole project must not be traced into the server bundle: the data and env paths are runtime-only.
const repoRoot = resolve(/*turbopackIgnore: true*/ process.cwd(), '..', '..')

const halaFile = () => resolve(/*turbopackIgnore: true*/ repoRoot, HALA_ENV_FILE)

/**
 * Settings can change while the app runs (agent:sync writes the agent id, the tunnel URL changes), so read
 * them from process.env first and fall back to the files at request time instead of freezing them at boot.
 */
const setting = (key: string): string | undefined =>
  process.env[key] ?? readHalaEnv(halaFile()).get(key) ?? readHalaEnv(resolve(/*turbopackIgnore: true*/ repoRoot, '.env.local')).get(key)

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
  if (setting('HALA_STORE') === 'file') {
    storeNote = 'HALA_STORE=file'
  } else if (url && serviceKey) {
    const ready = await supabaseReady({ url, serviceKey })
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
    if (!(await robotTablesReady(opts))) {
      // Bookings keep using Supabase; robots fall back to the local file until migration 002 is run.
      stores = { ...stores, robots: local().robots }
      robotsNote = 'Robot tables are missing in Supabase: run agent/09-supabase/migrations/002_hala_robots.sql. Robots are kept in a local file until then.'
    }
  } else stores = local()
  if (storeNote) console.warn(`hala: using the local file store. ${storeNote}`)
  return { stores, storeKind, storeNote, robotsNote, robots: createRobotService({ robots: stores.robots }), api: createToolApi({ stores, secret: ensureToolSecret(process.env, halaFile()) }), adminKey: adminKey() }
}

export const hala = (): Promise<Hala> => (g.__hala ??= build())

/** Server-side only. The API key never reaches the browser. */
export function elevenlabs(): ElevenLabsClient {
  g.__halaEleven ??= new ElevenLabsClient({ apiKey: setting('ELEVENLABS_API_KEY') })
  return g.__halaEleven
}

export const hasApiKey = () => Boolean(setting('ELEVENLABS_API_KEY'))
export const hasToolSecret = () => Boolean(setting('HALA_TOOL_SECRET'))
export const hasPublicUrl = () => Boolean(setting('PUBLIC_BASE_URL'))

/** Server-side settings lookup for routes that need one (voice id etc.). */
export const setting_ = setting

export const agentId = (channel: 'web' | 'robot' = 'web') =>
  setting(channel === 'robot' ? 'HALA_AGENT_ID_ROBOT' : 'HALA_AGENT_ID')

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })

/** Admin check for the dashboard endpoints. */
export async function isAdmin(req: Request): Promise<boolean> {
  const given = req.headers.get('x-hala-admin-key') ?? new URL(req.url).searchParams.get('key') ?? ''
  const key = (await hala()).adminKey
  return given.length === key.length && given === key
}
