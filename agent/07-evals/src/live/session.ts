import type { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import type { Lang } from '@hala/core'
import { runChecks, type Check, type CheckContext, type ToolCall, type TurnResult } from './checks'
import type { Scenario } from './scenarios'

/**
 * Text-only conversation driver for the ElevenLabs Agents websocket.
 *
 * Message shapes relied on (read from node_modules, nothing guessed):
 *  - @elevenlabs/types dist/generated/types/asyncapi-types.d.ts:
 *      client -> server: conversation_initiation_client_data, user_message {text}, pong {event_id}
 *      server -> client: conversation_initiation_metadata {conversation_id}, agent_response
 *        {agent_response_event.agent_response}, agent_tool_request {agent_tool_request.tool_name},
 *        agent_tool_response, ping {ping_event.event_id}, user_transcript
 *  - @elevenlabs/elevenlabs-js api/resources/conversationalAi/conversation/events.d.ts
 *      (ConversationInitiationClientDataEvent: conversation_config_override is a free-form object)
 *  - Signed URL: client.conversationalAi.conversations.getSignedUrl({ agentId }).
 *  - Tool calls with their parameters come from conversations.get(id).transcript[].toolCalls[]
 *      { toolName, paramsAsJson }, because tool events are only delivered over the socket when the
 *      agent's client events include them.
 */

export interface RawMessage { type?: string; [k: string]: any }

/** Collects websocket messages into an opening message and one segment per user turn. Pure, so it is unit-tested offline. */
export class TurnCollector {
  conversationId?: string
  errors: string[] = []
  /** index -1 is the opening. */
  private segments = new Map<number, { text: string[]; tools: string[] }>([[-1, { text: [], tools: [] }]])
  private current = -1
  inflightTools = 0
  lastEventAt = Date.now()

  beginTurn(index: number): void {
    this.current = index
    this.segments.set(index, { text: [], tools: [] })
    this.lastEventAt = Date.now()
  }

  /** Returns a reply to send back, if the message needs one (ping -> pong). */
  handle(msg: RawMessage): RawMessage | undefined {
    this.lastEventAt = Date.now()
    const seg = this.segments.get(this.current)!
    switch (msg.type) {
      case 'conversation_initiation_metadata':
        this.conversationId = msg.conversation_initiation_metadata_event?.conversation_id
        return undefined
      case 'agent_response': {
        const text = msg.agent_response_event?.agent_response
        if (typeof text === 'string' && text.trim()) seg.text.push(text.trim())
        return undefined
      }
      case 'agent_tool_request':
        this.inflightTools++
        seg.tools.push(String(msg.agent_tool_request?.tool_name ?? 'unknown'))
        return undefined
      case 'agent_tool_response':
        this.inflightTools = Math.max(0, this.inflightTools - 1)
        return undefined
      case 'ping':
        return { type: 'pong', event_id: msg.ping_event?.event_id }
      case 'client_error':
      case 'error':
        this.errors.push(JSON.stringify(msg).slice(0, 300))
        return undefined
      default:
        return undefined
    }
  }

  agentText(index: number): string { return (this.segments.get(index)?.text ?? []).join(' ') }
  socketTools(index: number): string[] { return this.segments.get(index)?.tools ?? [] }
  hasReply(index: number): boolean { return (this.segments.get(index)?.text.length ?? 0) > 0 }
}

/** A turn is settled when the agent replied, no tool is running, and nothing arrived for `quietMs`. */
export function isSettled(c: TurnCollector, index: number, quietMs: number, now = Date.now()): boolean {
  return c.hasReply(index) && c.inflightTools === 0 && now - c.lastEventAt >= quietMs
}

interface TranscriptRow {
  role: string
  message?: string
  toolCalls?: { toolName: string; paramsAsJson: string }[]
}

/** Map transcript rows to tool calls per user turn. Rows before the first user message belong to turn -1. */
export function toolCallsFromTranscript(rows: TranscriptRow[]): ToolCall[] {
  const out: ToolCall[] = []
  let turn = -1
  for (const row of rows) {
    if (row.role === 'user') turn++
    for (const tc of row.toolCalls ?? []) {
      let params: Record<string, unknown> = {}
      try { params = JSON.parse(tc.paramsAsJson || '{}') } catch { /* leave empty */ }
      out.push({ name: tc.toolName, params, turn })
    }
  }
  return out
}

export interface ScenarioOutcome {
  scenarioId: string
  opening: string
  turns: TurnResult[]
  checks: { phase: string; name: string; ok: boolean; detail?: string }[]
  conversationId?: string
  toolSource: 'transcript' | 'socket'
  errors: string[]
  durationMs: number
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface SessionOptions {
  client: Pick<ElevenLabsClient, 'conversationalAi'>
  agentId: string
  quietMs?: number
  turnTimeoutMs?: number
}

async function open(url: string): Promise<WebSocket> {
  return await new Promise((resolve, reject) => {
    const ws = new WebSocket(url)
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', () => reject(new Error('websocket failed to open')), { once: true })
  })
}

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (cond()) return true
    await sleep(150)
  }
  return cond()
}

/** Evaluate a scenario's checks against collected turns. Exported so it can be tested without a network. */
export function evaluate(scenario: Scenario, opening: string, turns: TurnResult[]): ScenarioOutcome['checks'] {
  const results: ScenarioOutcome['checks'] = []
  const all = turns.flatMap((t) => t.toolCalls)
  const push = (phase: string, checks: Check[] | undefined, ctx: CheckContext) => {
    for (const r of runChecks(checks ?? [], ctx)) results.push({ phase, ...r })
  }
  const empty: TurnResult = { index: -1, user: '', agentText: opening, toolCalls: [] }
  push('opening', scenario.opening, { opening, turn: empty, turns, toolCalls: all })
  scenario.turns.forEach((st, i) => {
    const turn = turns[i]
    if (!turn) { results.push({ phase: `turn ${i + 1}`, name: 'turn happened', ok: false, detail: 'no agent reply was collected' }); return }
    const upTo = turns.slice(0, i + 1).flatMap((t) => t.toolCalls)
    push(`turn ${i + 1}`, st.checks, { opening, turn, turns: turns.slice(0, i + 1), toolCalls: upTo })
  })
  push('final', scenario.final, { opening, turn: turns.at(-1) ?? empty, turns, toolCalls: all })
  return results
}

/** Run one scenario against the live agent. Spends ElevenLabs credits (LLM + text-only turns). */
export async function runScenario(scenario: Scenario, o: SessionOptions): Promise<ScenarioOutcome> {
  const started = Date.now()
  const quietMs = o.quietMs ?? 4000
  const turnTimeoutMs = o.turnTimeoutMs ?? 90_000
  const collector = new TurnCollector()
  const { signedUrl } = await o.client.conversationalAi.conversations.getSignedUrl({ agentId: o.agentId })
  const ws = await open(signedUrl)

  ws.addEventListener('message', (ev) => {
    let msg: RawMessage
    try { msg = JSON.parse(String(ev.data)) } catch { return }
    const reply = collector.handle(msg)
    if (reply) ws.send(JSON.stringify(reply))
  })

  const send = (m: RawMessage) => ws.send(JSON.stringify(m))
  send({
    type: 'conversation_initiation_client_data',
    conversation_config_override: { conversation: { text_only: true }, agent: { language: scenario.language as Lang } }
  })

  // The opening message arrives on its own, before the caller says anything.
  await waitFor(() => isSettled(collector, -1, 3000), 25_000)
  const opening = collector.agentText(-1)

  for (let i = 0; i < scenario.turns.length; i++) {
    collector.beginTurn(i)
    send({ type: 'user_message', text: scenario.turns[i]!.user })
    await waitFor(() => isSettled(collector, i, quietMs), turnTimeoutMs)
  }
  await sleep(500)
  ws.close()

  // Authoritative tool calls (with parameters) come from the stored transcript once it is processed.
  let transcriptCalls: ToolCall[] | undefined
  if (collector.conversationId) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const conv = await o.client.conversationalAi.conversations.get(collector.conversationId)
        if (conv.status === 'done' || conv.status === 'failed' || attempt === 19) {
          transcriptCalls = toolCallsFromTranscript(conv.transcript as unknown as TranscriptRow[])
          break
        }
      } catch { /* not available yet */ }
      await sleep(2000)
    }
  }

  const turns: TurnResult[] = scenario.turns.map((st, i) => ({
    index: i,
    user: st.user,
    agentText: collector.agentText(i),
    toolCalls: transcriptCalls
      ? transcriptCalls.filter((c) => c.turn === i)
      : collector.socketTools(i).map((name) => ({ name, params: {}, turn: i }))
  }))

  return {
    scenarioId: scenario.id,
    opening,
    turns,
    checks: evaluate(scenario, opening, turns),
    conversationId: collector.conversationId,
    toolSource: transcriptCalls ? 'transcript' : 'socket',
    errors: collector.errors,
    durationMs: Date.now() - started
  }
}
