'use client'
import { useConversation } from '@elevenlabs/react'
import { useCallback, useEffect, useState } from 'react'
import { FIRST_MESSAGE, type HalaEvent } from '@hala/core'

export type LanguagePref = 'auto' | 'en' | 'ar'
export interface Line { id: string; role: 'user' | 'agent'; text: string }

const overridesFor = (pref: LanguagePref) =>
  pref === 'auto' ? undefined : { agent: { language: pref, firstMessage: FIRST_MESSAGE[pref] } }

/** Friendly message for the most common ways starting a call fails. */
function describe(e: unknown): string {
  const name = (e as { name?: string })?.name
  const msg = (e as Error)?.message ?? String(e)
  if (name === 'NotAllowedError' || /permission|denied/i.test(msg)) return 'The microphone is blocked. Allow it in the browser address bar, then press Start again.'
  if (name === 'NotFoundError') return 'No microphone was found. Plug one in and try again.'
  return msg
}

const ADMIN_KEY = 'hala-admin-key' // the Robot tab keeps the access key here once unlocked

/**
 * The conversation the robot is in right now, so this screen can show what the robot is doing (the Smart Pass, the phone QR)
 * even though the visitor is talking to the robot and not to this page. Needs the access key from the Robot tab; without it
 * this stays undefined and the page only follows its own conversation. `/?robot=<id>` pins it to one robot.
 */
function useRobotConversation(enabled: boolean): string | undefined {
  const [id, setId] = useState<string>()
  useEffect(() => {
    if (!enabled) { setId(undefined); return }
    let stop = false
    const tick = async () => {
      let key = ''
      try { key = sessionStorage.getItem(ADMIN_KEY) ?? '' } catch { /* private mode */ }
      if (!key) { if (!stop) setId(undefined); return }
      try {
        const res = await fetch('/api/robots', { headers: { 'x-hala-admin-key': key }, cache: 'no-store' })
        if (!res.ok) return
        const { robots } = (await res.json()) as { robots: { id: string; state?: { phase?: string; conversationId?: string } }[] }
        // /?robot=<id> pins the screen to one robot (when more than one is paired); otherwise the first one in a conversation.
        const only = new URLSearchParams(window.location.search).get('robot')
        const live = robots.find((r) => (!only || r.id === only) && r.state?.phase === 'conversation' && r.state.conversationId)
        if (!stop) setId(live?.state?.conversationId)
      } catch { /* the next tick tries again */ }
    }
    void tick()
    const timer = setInterval(tick, 2500)
    return () => { stop = true; clearInterval(timer) }
  }, [enabled])
  return id
}

/**
 * Everything the talk page needs from one conversation:
 * the voice session (ElevenLabs React SDK), the transcript, and the live feed of what HALA did
 * (server-sent events from our own tools API, keyed by the conversation id).
 * Must be rendered inside <ConversationProvider>.
 */
export function useHala() {
  const [lines, setLines] = useState<Line[]>([])
  const [events, setEvents] = useState<HalaEvent[]>([])
  const [error, setError] = useState<string>()
  const [toolProblem, setToolProblem] = useState(false)
  const [conversationId, setConversationId] = useState<string>()
  const [starting, setStarting] = useState(false)

  const conversation = useConversation({
    onMessage: (m: { message: string; role: 'user' | 'agent'; event_id?: number }) =>
      setLines((prev) => [...prev, { id: `${m.event_id ?? prev.length}-${m.role}`, role: m.role, text: m.message }]),
    onError: (message: string) => setError(message),
    onConnect: (props: { conversationId?: string }) => { if (props?.conversationId) setConversationId(props.conversationId) },
    // A webhook tool that fails (tunnel down, wrong secret) shows up here before anything else does.
    onAgentToolResponse: (e: unknown) => {
      const r = (e as { agent_tool_response?: { is_error?: boolean }; is_error?: boolean })
      if (r?.agent_tool_response?.is_error || r?.is_error) setToolProblem(true)
    }
  } as never)

  const status = conversation.status
  const live = status === 'connected'

  // This page's own conversation wins; otherwise follow the robot's, so the screen works as the robot's screen.
  const robotConversationId = useRobotConversation(!conversationId)
  const feedId = conversationId ?? robotConversationId

  // Poll our own event feed once we know the conversation id. Polling (not a stream) so it also works on serverless hosting.
  useEffect(() => {
    if (!feedId) { setEvents([]); return }
    setEvents([]) // a different conversation (the robot's next visitor): start from a clean screen
    let stop = false
    let after = ''
    const tick = async () => {
      try {
        const res = await fetch(`/api/events?poll=1&conversation_id=${encodeURIComponent(feedId)}&after=${encodeURIComponent(after)}`, { cache: 'no-store' })
        if (!res.ok) return
        const fresh = (await res.json()) as HalaEvent[]
        if (stop || fresh.length === 0) return
        after = fresh[fresh.length - 1]!.ts
        setEvents((prev) => [...prev, ...fresh.filter((e) => !prev.some((p) => p.id === e.id))])
      } catch { /* a missed poll is retried on the next tick */ }
    }
    void tick()
    const timer = setInterval(tick, 1500)
    return () => { stop = true; clearInterval(timer) }
  }, [feedId])

  const start = useCallback(async (pref: LanguagePref) => {
    setError(undefined); setToolProblem(false); setStarting(true)
    try {
      // The microphone must be requested inside the click handler (browser rule).
      await navigator.mediaDevices.getUserMedia({ audio: true })
      const res = await fetch('/api/token?channel=web', { cache: 'no-store' })
      const body = (await res.json()) as { token?: string; error?: string; startProcedureIds?: string[] }
      if (!res.ok || !body.token) throw new Error(body.error ?? `Token request failed (${res.status})`)
      setLines([]); setEvents([]); setConversationId(undefined)
      conversation.startSession({ conversationToken: body.token, connectionType: 'webrtc', overrides: overridesFor(pref), stripAudioTags: true, ...(body.startProcedureIds?.length ? { startProcedureIds: body.startProcedureIds } : {}) } as never)
    } catch (e) {
      setError(describe(e))
    } finally {
      setStarting(false)
    }
  }, [conversation])

  // The id is also available from the session itself, in case onConnect did not carry it.
  useEffect(() => {
    if (live && !conversationId) {
      try { const id = conversation.getId(); if (id) setConversationId(id) } catch { /* not ready */ }
    }
  }, [live, conversationId, conversation])

  return {
    status, live, starting, mode: conversation.mode, isMuted: conversation.isMuted, setMuted: conversation.setMuted,
    getOutputVolume: conversation.getOutputVolume, getInputVolume: conversation.getInputVolume,
    lines, events, error, toolProblem, conversationId, feedId, followingRobot: !conversationId && Boolean(robotConversationId),
    start, stop: conversation.endSession
  }
}
