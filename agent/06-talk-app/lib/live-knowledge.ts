import { syncLiveAnswers, type LiveSyncResult } from '@hala/live-knowledge'
import { elevenlabs } from './eleven'
import { setting } from './server'

/**
 * Pull the staff answers from Supabase into the agents' ElevenLabs knowledge base.
 *  - runSync(): do it now (the cron job and the admin endpoint).
 *  - maybeSync(): do it at most every 15 minutes per server instance, in the background after a conversation starts.
 * The document name carries a content hash, so overlapping runs on different instances are harmless: the second one finds
 * the document already there.
 */
const g = globalThis as unknown as { __lk?: { last: number; running?: Promise<unknown>; result?: LiveSyncResult | { status: 'error'; message: string }; at?: string } }
const state = () => (g.__lk ??= { last: 0 })

function deps() {
  const url = setting('SUPABASE_URL')
  const serviceKey = setting('SUPABASE_SERVICE_KEY')
  const agentIds = [setting('HALA_AGENT_ID'), setting('HALA_AGENT_ID_ROBOT')].filter((x): x is string => Boolean(x))
  if (!url || !serviceKey || agentIds.length === 0 || !setting('ELEVENLABS_API_KEY')) return undefined
  return { supabase: { url, serviceKey }, eleven: elevenlabs(), agentIds }
}

export async function runSync(): Promise<LiveSyncResult | { status: 'error'; message: string } | { status: 'skipped'; reason: string }> {
  const s = state()
  if (s.running) return (await s.running, s.result ?? { status: 'skipped', reason: 'another run finished' }) as never
  const d = deps()
  if (!d) return { status: 'skipped', reason: 'Supabase, the agents or the ElevenLabs key are not configured' }
  s.running = syncLiveAnswers(d).then((r) => { s.result = r }).catch((e) => { s.result = { status: 'error', message: (e as Error).message.slice(0, 200) } })
    .finally(() => { s.last = Date.now(); s.at = new Date().toISOString(); s.running = undefined })
  await s.running
  return s.result!
}

export async function maybeSync(minMinutes = 15): Promise<void> {
  const s = state()
  if (s.running || Date.now() - s.last < minMinutes * 60_000) return
  s.last = Date.now() // claim the slot first: concurrent conversations must not all start a run
  await runSync()
}

export const lastSync = () => ({ at: state().at, result: state().result })
