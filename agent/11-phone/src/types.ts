import type { Lang } from '@hala/core'

export interface CodeRecord {
  code: string
  createdAt: string
  /** Set once somebody texted it. A code links exactly one phone. */
  phone?: string
  linkedAt?: string
  /** Robot conversation that displayed the QR, when known. */
  conversationId?: string
}

export interface Contact {
  phone: string
  name?: string
  language: Lang
  /** Every code this phone has linked with. A person can be repeated to the robot by any of them. */
  codes: string[]
  firstSeenAt: string
  lastSeenAt: string
}

export type MessageFrom = 'user' | 'agent'

export interface PhoneMessage {
  id: string
  /** Monotonic cursor so the app can ask "anything after 42?". */
  seq: number
  phone: string
  from: MessageFrom
  kind: 'text' | 'voice'
  /** For a voice message this is the transcript. */
  text: string
  audioUrl?: string
  durationSec?: number
  ts: string
}

export type RingStatus = 'pending' | 'delivered' | 'answered' | 'declined' | 'missed'

/** A proactive call from HALA to a phone. The app turns it into an incoming-call screen. */
export interface Ring {
  id: string
  seq: number
  phone: string
  /** Why HALA is calling, in plain words. Always derived from store data, never invented. */
  reason: string
  /** What HALA says first. Starts with the AI disclosure. */
  opening: string
  language: Lang
  kind: 'manual' | 'appointment_reminder'
  /** Dedupe key so one booking does not ring the same phone every minute. */
  nudgeKey?: string
  status: RingStatus
  createdAt: string
}

export interface PhoneSnapshot {
  seq: number
  codes: Record<string, CodeRecord>
  contacts: Record<string, Contact>
  messages: PhoneMessage[]
  rings: Ring[]
  /** ElevenLabs conversation id -> phone, so a tool call knows who it is talking to. */
  conversations: Record<string, string>
  nudged: Record<string, string>
}
