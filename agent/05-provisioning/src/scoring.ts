import { randomUUID } from 'node:crypto'
import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import type { EventBus, HalaEvent } from '@hala/core'

/**
 * Conversation scores from ElevenLabs, written into hala_events when they are ready.
 *
 * ElevenLabs analyses every finished conversation (sentiment and frustration of the caller's turns) a little after the
 * call ends. This asks its conversation list for the finished ones, and for each that has a real score and has not been
 * written yet it:
 *   1. adds one `conversation_scored` event (so a conversation with no booking or hand-over still has a row), and
 *   2. puts the same two numbers on the conversation's other event rows that have none yet.
 *
 * The numbers are stored exactly as ElevenLabs gives them:
 *   average_sentiment    overall_sentiment_score    -1 (negative) .. +1 (positive)
 *   average_frustration  overall_frustration_score   0 (calm) .. 1 (very frustrated)
 * To average per conversation, average over type = 'conversation_scored' only (the other rows repeat the same value).
 */
type Client = Pick<ElevenLabsClient, 'conversationalAi'>

export interface ScoringOptions {
  client: Client
  /** Agent ids to watch, by channel. Missing ones are skipped. A function, because agent:sync changes them while the app runs. */
  agents: Record<string, string | undefined> | (() => Record<string, string | undefined>)
  events: EventBus
  now?: () => Date
  /** How far back to look. A conversation older than this and still unscored is given up on. */
  lookbackHours?: number
  /** Conversations to ask for, per agent. */
  pageSize?: number
}

export interface ScoringRun {
  /** Conversations written this run. */
  scored: string[]
  /** Finished conversations that ElevenLabs has not analysed yet (looked at again next run). */
  waiting: number
  /** Conversations looked at. */
  checked: number
}

/** The slice of a conversation summary this needs. Matches ElevenLabs' ConversationSummaryResponseModel. */
export interface ConversationSummary {
  conversationId: string
  agentId: string
  status: string
  startTimeUnixSecs: number
  sentimentAnalysis?: {
    overallLabel: string
    overallSentimentScore: number
    overallFrustrationScore: number
    minUserSentimentScore: number
    maxUserFrustrationScore: number
    numScoredUserTurns: number
  } | null
}

export interface Score {
  sentiment: number
  frustration: number
  label: string
  turns: number
  minSentiment: number
  maxFrustration: number
}

/** A usable score, or undefined while the analysis is missing or covers no caller turn (all zeros then mean "nothing", not "calm"). */
export function toScore(c: ConversationSummary): Score | undefined {
  const a = c.sentimentAnalysis
  if (c.status !== 'done' || !a || !(a.numScoredUserTurns > 0)) return undefined
  if (![a.overallSentimentScore, a.overallFrustrationScore].every(Number.isFinite)) return undefined
  return {
    sentiment: a.overallSentimentScore, frustration: a.overallFrustrationScore, label: a.overallLabel,
    turns: a.numScoredUserTurns, minSentiment: a.minUserSentimentScore, maxFrustration: a.maxUserFrustrationScore
  }
}

export function createScorer(o: ScoringOptions) {
  const now = o.now ?? (() => new Date())
  /** Conversations already written (this process). The history check below covers a restart. */
  const done = new Set<string>()
  let running: Promise<ScoringRun> | undefined

  async function alreadyScored(conversationId: string): Promise<boolean> {
    if (done.has(conversationId)) return true
    const history = await o.events.history(conversationId)
    const yes = history.some((e) => e.type === 'conversation_scored')
    if (yes) done.add(conversationId)
    return yes
  }

  async function once(): Promise<ScoringRun> {
    const run: ScoringRun = { scored: [], waiting: 0, checked: 0 }
    const since = Math.floor(now().getTime() / 1000) - (o.lookbackHours ?? 24) * 3600
    for (const [channel, agentId] of Object.entries(typeof o.agents === 'function' ? o.agents() : o.agents)) {
      if (!agentId) continue
      const page = await o.client.conversationalAi.conversations.list({ agentId, pageSize: o.pageSize ?? 40, callStartAfterUnix: since })
      for (const c of page.conversations as unknown as ConversationSummary[]) {
        if (c.status !== 'done' && c.status !== 'failed') continue // still talking, or still being processed
        run.checked++
        if (done.has(c.conversationId)) continue
        const s = toScore(c)
        if (!s) { if (c.status === 'done' && !c.sentimentAnalysis) run.waiting++; continue }
        if (await alreadyScored(c.conversationId)) continue
        const event: HalaEvent = {
          id: randomUUID(), ts: now().toISOString(), conversationId: c.conversationId, type: 'conversation_scored',
          averageSentiment: s.sentiment, averageFrustration: s.frustration,
          data: {
            channel, label: s.label, caller_turns_scored: s.turns, lowest_sentiment: s.minSentiment, highest_frustration: s.maxFrustration,
            // also here, so the numbers survive a database that does not have the columns yet
            average_sentiment: s.sentiment, average_frustration: s.frustration, source: 'elevenlabs'
          }
        }
        await o.events.publish(event)
        // the conversation's other rows (a booking, a hand-over ...) carry the same two numbers
        try { await o.events.annotate?.(c.conversationId, { averageSentiment: s.sentiment, averageFrustration: s.frustration }) } catch { /* the scored row above is the one that matters */ }
        done.add(c.conversationId)
        run.scored.push(c.conversationId)
      }
    }
    return run
  }

  return {
    /** Look for newly analysed conversations. Overlapping calls share one run. */
    run(): Promise<ScoringRun> {
      running ??= once().finally(() => { running = undefined })
      return running
    }
  }
}

export type Scorer = ReturnType<typeof createScorer>
