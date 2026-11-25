import { createScorer, type Scorer, type ScoringRun } from '@hala/provisioning'
import { elevenlabs } from './eleven'
import { hala, hasApiKey, setting } from './server'

/**
 * Sentiment and frustration from ElevenLabs into hala_events, once a conversation has been analysed (see
 * agent/05-provisioning/src/scoring.ts for what is written).
 *
 *  - A timer asks every minute, so every channel (browser, robot, phone calls, texts) is covered with no webhook.
 *  - A conversation starting also asks (maybeScore), and the admin endpoint can force a run.
 *  - Only on Supabase: the two columns exist there. Skipped with a reason otherwise.
 *  - HALA_SCORE_AUTO=0 turns the timer off.
 */
interface State { scorer?: Promise<Scorer | { skipped: string }>; timer?: ReturnType<typeof setInterval>; last?: ScoringRun | { error: string }; at?: string; lastRunMs: number }
const g = globalThis as unknown as { __halaScoring?: State }
const state = () => (g.__halaScoring ??= { lastRunMs: 0 })

const agents = () => ({ web: setting('HALA_AGENT_ID'), robot: setting('HALA_AGENT_ID_ROBOT'), phone: setting('HALA_AGENT_ID_PHONE') })

async function scorer(): Promise<Scorer | { skipped: string }> {
  const s = state()
  s.scorer ??= (async () => {
    const h = await hala()
    if (h.storeKind !== 'supabase') return { skipped: 'scores are only stored in Supabase (hala_events.average_sentiment / average_frustration); the app is using the local file' }
    if (!hasApiKey()) return { skipped: 'ELEVENLABS_API_KEY is missing' }
    return createScorer({ client: elevenlabs(), agents, events: h.stores.events })
  })()
  return s.scorer
}

/** Look for newly analysed conversations now. Never throws. */
export async function runScoring(): Promise<ScoringRun | { skipped: string } | { error: string }> {
  const s = state()
  const sc = await scorer()
  if ('skipped' in sc) return sc
  try {
    const r = await sc.run()
    s.last = r
    s.at = new Date().toISOString()
    if (r.scored.length) console.log(`hala: scored ${r.scored.length} conversation(s) from ElevenLabs`)
    return r
  } catch (e) {
    const message = (e as Error).message.slice(0, 200)
    s.last = { error: message }
    s.at = new Date().toISOString()
    return { error: message }
  } finally {
    s.lastRunMs = Date.now()
  }
}

/** Start the one-minute timer (once per server process). Called when the server first builds. */
export function startScoringTimer(): void {
  const s = state()
  if (s.timer || setting('HALA_SCORE_AUTO') === '0') return
  s.timer = setInterval(() => { void runScoring() }, 60_000)
  s.timer.unref?.()
  setTimeout(() => { void runScoring() }, 8_000).unref?.() // and once shortly after boot, to catch up on what ended while the app was down
}

/** A conversation is starting: if the last look was over 30 s ago, look again (the previous visitor's call has been analysed by now). */
export async function maybeScore(): Promise<void> {
  const s = state()
  if (Date.now() - s.lastRunMs < 30_000) return
  s.lastRunMs = Date.now()
  await runScoring()
}

export const lastScoring = () => ({ at: state().at ?? null, result: state().last ?? null })
