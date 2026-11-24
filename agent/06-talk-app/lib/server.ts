import { randomBytes } from 'node:crypto'
import { resolve } from 'node:path'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { createStores } from '@hala/booking'
import { createToolApi, type ToolApi } from '@hala/tools-api'
import { HALA_ENV_FILE, readHalaEnv, setHalaVar } from '@hala/provisioning'

/**
 * One set of stores and one tool API per server process.
 *
 * Pinned on globalThis because Next dev can load each route module as a separate instance and
 * hot-reload resets module state: without this, /api/tools and /api/events would see different
 * bookings. Persisted to .data/hala-store.json so a restart keeps bookings and handovers.
 */
interface Hala { api: ToolApi; stores: ReturnType<typeof createStores>; adminKey: string }
const g = globalThis as unknown as { __hala?: Hala; __halaEleven?: ElevenLabsClient }

// The whole project must not be traced into the server bundle: the data and env paths are runtime-only.
const repoRoot = resolve(/*turbopackIgnore: true*/ process.cwd(), '..', '..')

function adminKey(): string {
  const file = resolve(/*turbopackIgnore: true*/ repoRoot, HALA_ENV_FILE)
  const existing = process.env.HALA_ADMIN_KEY ?? readHalaEnv(file).get('HALA_ADMIN_KEY')
  if (existing) return existing
  const fresh = randomBytes(18).toString('hex')
  setHalaVar('HALA_ADMIN_KEY', fresh, file)
  return fresh
}

export function hala(): Hala {
  if (!g.__hala) {
    const stores = createStores({ file: resolve(/*turbopackIgnore: true*/ repoRoot, '.data', 'hala-store.json') })
    g.__hala = { stores, api: createToolApi({ stores, secret: process.env.HALA_TOOL_SECRET }), adminKey: adminKey() }
  }
  return g.__hala
}

/** Server-side only. The API key never reaches the browser. */
export function elevenlabs(): ElevenLabsClient {
  g.__halaEleven ??= new ElevenLabsClient()
  return g.__halaEleven
}

export const agentId = (channel: 'web' | 'robot' = 'web') =>
  channel === 'robot' ? process.env.HALA_AGENT_ID_ROBOT : process.env.HALA_AGENT_ID

export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } })

/** Admin check for the dashboard endpoints. */
export function isAdmin(req: Request): boolean {
  const given = req.headers.get('x-hala-admin-key') ?? new URL(req.url).searchParams.get('key') ?? ''
  const key = hala().adminKey
  return given.length === key.length && given === key
}
