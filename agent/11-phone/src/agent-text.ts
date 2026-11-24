import type { Lang } from '@hala/core'

/**
 * Text conversation with the ElevenLabs agent over its websocket, one live session per phone number.
 *
 * Why the server does this and not the app: the server knows the sender (the "from" number), it can
 * run the same webhook tools as a voice call, and the iOS app stays a thin client.
 *
 * Message shapes are the ones the live eval harness already relies on (07-evals/src/live/session.ts):
 *   client -> server  conversation_initiation_client_data, user_message {text}, pong, contextual_update
 *   server -> client  conversation_initiation_metadata, agent_response, agent_tool_request/response, ping
 */

export interface WebSocketLike {
  send(data: string): void
  close(): void
  addEventListener(type: string, listener: (ev: { data?: unknown }) => void, opts?: { once?: boolean }): void
}

export interface TextTurnContext {
  phone: string
  name?: string
  language: Lang
  /** Earlier messages, used to brief a fresh session so a restart does not lose the thread. */
  history: { from: 'user' | 'agent'; text: string }[]
  /** Sent as the agent's first message. Says it is an AI. */
  firstMessage: string
}

export interface TextAgent {
  reply(ctx: TextTurnContext, userText: string): Promise<{ texts: string[]; conversationId?: string }>
  close(phone: string): void
}

export interface TextAgentOptions {
  getSignedUrl: () => Promise<string>
  createSocket?: (url: string) => WebSocketLike
  /** Quiet time after the last event before a reply counts as complete. */
  settleMs?: number
  /** Longer quiet time right after a tool result, because the model is still writing its answer. */
  afterToolMs?: number
  turnTimeoutMs?: number
  /** How long to let the agent finish its opening line before the first text is sent. Sending during it derails the turn. */
  openingWaitMs?: number
  idleMs?: number
  now?: () => number
}

interface Session {
  ws: WebSocketLike
  conversationId?: string
  closed: boolean
  active: boolean
  chunks: string[]
  inflight: number
  lastEventAt: number
  lastType: string
  lastUsed: number
  openingSeen: boolean
  firstMessage: string
  /** Serialises turns: two quick texts must not interleave. */
  chain: Promise<unknown>
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export function createElevenTextAgent(o: TextAgentOptions): TextAgent & { sessions: () => number } {
  const now = o.now ?? Date.now
  const settleMs = o.settleMs ?? 2500
  const afterToolMs = o.afterToolMs ?? 7000
  const turnTimeoutMs = o.turnTimeoutMs ?? 40_000
  const idleMs = o.idleMs ?? 10 * 60_000
  const openingWaitMs = o.openingWaitMs ?? 5000
  const make = o.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike)
  const sessions = new Map<string, Session>()

  const sweep = setInterval(() => {
    for (const [key, s] of sessions) if (now() - s.lastUsed > idleMs) { s.ws.close(); sessions.delete(key) }
  }, 60_000)
  sweep.unref?.()

  async function openSession(ctx: TextTurnContext): Promise<Session> {
    const ws = make(await o.getSignedUrl())
    await new Promise<void>((resolve, reject) => {
      ws.addEventListener('open', () => resolve(), { once: true })
      ws.addEventListener('error', () => reject(new Error('could not open the agent connection')), { once: true })
    })
    const s: Session = {
      ws, closed: false, active: false, chunks: [], inflight: 0, lastEventAt: now(), lastType: '', lastUsed: now(), openingSeen: false,
      firstMessage: ctx.firstMessage, chain: Promise.resolve()
    }
    ws.addEventListener('close', () => { s.closed = true })
    ws.addEventListener('message', (ev) => {
      let msg: Record<string, any>
      try { msg = JSON.parse(String(ev.data)) } catch { return }
      s.lastEventAt = now()
      s.lastType = String(msg.type ?? '')
      switch (msg.type) {
        case 'conversation_initiation_metadata':
          s.conversationId = msg.conversation_initiation_metadata_event?.conversation_id
          break
        case 'agent_response': {
          const text = msg.agent_response_event?.agent_response
          if (!s.active) s.openingSeen = true
          // The opening line arrives on its own; the thread already shows our own copy of it.
          if (typeof text === 'string' && text.trim() && s.active && norm(text) !== norm(s.firstMessage)) s.chunks.push(text.trim())
          break
        }
        case 'agent_tool_request': s.inflight++; break
        case 'agent_tool_response': s.inflight = Math.max(0, s.inflight - 1); break
        case 'ping': ws.send(JSON.stringify({ type: 'pong', event_id: msg.ping_event?.event_id })); break
      }
    })

    ws.send(JSON.stringify({
      type: 'conversation_initiation_client_data',
      conversation_config_override: {
        conversation: { text_only: true },
        agent: { language: ctx.language, first_message: ctx.firstMessage }
      },
      dynamic_variables: {
        caller_number: ctx.phone,
        caller_name: ctx.name ?? 'unknown',
        contact_mode: 'text message',
        call_reason: 'none'
      }
    }))

    const until = now() + 10_000
    while (!s.conversationId && !s.closed && now() < until) await sleep(100)
    // Let the opening line finish first: a user message sent while it is still being produced derails the turn.
    const openingUntil = now() + openingWaitMs
    while (!s.openingSeen && !s.closed && now() < openingUntil) await sleep(100)
    if (s.closed) throw new Error('the agent closed the connection')

    if (ctx.history.length) {
      const recap = ctx.history.slice(-8).map((m) => `${m.from === 'user' ? 'Caller' : 'HALA'}: ${m.text}`).join('\n')
      ws.send(JSON.stringify({ type: 'contextual_update', text: `Earlier in this text thread (the session was restarted):\n${recap}` }))
    }
    return s
  }

  async function turn(s: Session, text: string): Promise<string[]> {
    s.chunks = []
    s.inflight = 0
    s.active = true
    s.lastEventAt = now()
    s.ws.send(JSON.stringify({ type: 'user_message', text }))
    const deadline = now() + turnTimeoutMs
    while (now() < deadline && !s.closed) {
      const quiet = s.lastType === 'agent_tool_response' ? afterToolMs : settleMs
      if (s.chunks.length > 0 && s.inflight === 0 && now() - s.lastEventAt >= quiet) break
      await sleep(150)
    }
    s.active = false
    s.lastUsed = now()
    if (s.chunks.length === 0) throw new Error(s.closed ? 'the agent closed the connection' : 'the agent did not answer in time')
    return [...s.chunks]
  }

  return {
    sessions: () => sessions.size,

    async reply(ctx, userText) {
      let s = sessions.get(ctx.phone)
      if (!s || s.closed) {
        s = await openSession(ctx)
        sessions.set(ctx.phone, s)
      }
      const session = s
      const run = session.chain.then(() => turn(session, userText))
      session.chain = run.catch(() => undefined)
      try {
        return { texts: await run, conversationId: session.conversationId }
      } catch (e) {
        // A broken session is dropped so the next text starts clean.
        session.ws.close()
        sessions.delete(ctx.phone)
        throw e
      }
    },

    close(phone) {
      sessions.get(phone)?.ws.close()
      sessions.delete(phone)
    }
  }
}
