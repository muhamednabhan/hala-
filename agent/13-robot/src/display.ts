import { z } from 'zod'
import type { HalaEvent } from '@hala/core'

/**
 * The robot's face (emoji), its LED strip and its screen (video playback, used for QR codes).
 * AgiBot docs: 5.2.2 Screen Control, 6.1.26 Emoji Control, 6.1.33 LED Strip Control.
 *
 * The bridge talks to the robot; this file is what the website and the bridge agree on: the emoji table, the LED modes,
 * the named "looks" (face + lights together), the test commands, and what to show for the conversation the robot is in.
 */

// ---------------------------------------------------------------- the face

/** emotion_id for PlayEmoji (AgiBot "emoji mapping table"). */
export const EMOJIS = [
  { id: 1, name: 'Blink' },
  { id: 10, name: 'Calm (eyes 1)' },
  { id: 11, name: 'Calm (eyes 2)' },
  { id: 20, name: 'Calm (game)' },
  { id: 30, name: 'Calm (cute 1)' },
  { id: 31, name: 'Calm (cute 2)' },
  { id: 32, name: 'Calm (cute 3)' },
  { id: 33, name: 'Calm (cute 4)' },
  { id: 40, name: 'Close eyes' },
  { id: 50, name: 'Open eyes' },
  { id: 60, name: 'Bored' },
  { id: 70, name: 'Abnormal' },
  { id: 80, name: 'Sleeping' },
  { id: 90, name: 'Happy' },
  { id: 100, name: 'Extra happy' },
  { id: 101, name: 'Ecstatic' },
  { id: 110, name: 'Sad' },
  { id: 120, name: 'Sympathy' },
  { id: 130, name: 'Confused' },
  { id: 140, name: 'Shocked' },
  { id: 150, name: 'Acting cute' },
  { id: 160, name: 'Serious' },
  { id: 170, name: 'Thinking' },
  { id: 180, name: 'Angry' },
  { id: 190, name: 'Extra angry' },
  { id: 200, name: 'Adoration' },
  { id: 210, name: 'Extra adoring' },
  { id: 220, name: 'Charging' }
] as const

/** AimDK priority: a request not lower than the current one overrides it. System modules use up to 10, so HALA uses 11. */
export const FACE_PRIORITY = 11

// ---------------------------------------------------------------- the lights

/** led_strip_mode for SetPmuLed. */
export const LED_MODES = [
  { id: 0, name: 'Steady' },
  { id: 1, name: 'Breathing (4 s)' },
  { id: 2, name: 'Blinking (1 s)' },
  { id: 3, name: 'Flowing (2 s)' }
] as const

export interface Rgb { r: number; g: number; b: number }
export interface Led { mode: 0 | 1 | 2 | 3; r: number; g: number; b: number }

/** DSO palette and the traffic-light colours people already read without thinking. */
export const COLORS = {
  blue: { r: 47, g: 107, b: 246 },
  cyan: { r: 0, g: 194, b: 255 },
  green: { r: 31, g: 178, b: 107 },
  amber: { r: 255, g: 170, b: 0 },
  red: { r: 255, g: 59, b: 48 },
  white: { r: 255, g: 255, b: 255 },
  off: { r: 0, g: 0, b: 0 }
} as const satisfies Record<string, Rgb>

// ---------------------------------------------------------------- looks: face + lights together

export interface Look {
  /** Emoji to play, and whether it loops (2) or plays once (1). */
  emoji: number
  loop: boolean
  led: Led
  label: string
  /** A moment (plays once, then the base look comes back) rather than a state the robot stays in. */
  moment?: boolean
}

/**
 * The states the robot stays in during a conversation (listening, speaking, thinking; idle once it ends) and the moments it reacts with (happy ...).
 * The bridge picks the state itself from the conversation (instant); the website adds the moments from what was done.
 */
export const LOOKS = {
  // idle plays once and is not repeated: the robot's own system faces (faults, charging) must be able to come back
  idle: { emoji: 10, loop: false, led: { mode: 1, ...COLORS.blue }, label: 'Idle: calm eyes, slow blue breathing' },
  listening: { emoji: 10, loop: true, led: { mode: 1, ...COLORS.cyan }, label: 'Listening: calm eyes, cyan breathing' },
  speaking: { emoji: 11, loop: true, led: { mode: 3, ...COLORS.cyan }, label: 'Speaking: calm eyes, cyan flowing' },
  thinking: { emoji: 170, loop: true, led: { mode: 2, ...COLORS.blue }, label: 'Thinking: thinking face, blue blinking' },
  happy: { emoji: 90, loop: false, led: { mode: 0, ...COLORS.green }, label: 'Happy: green', moment: true },
  delighted: { emoji: 100, loop: false, led: { mode: 3, ...COLORS.green }, label: 'Delighted (booking confirmed): green flowing', moment: true },
  sympathy: { emoji: 120, loop: false, led: { mode: 1, ...COLORS.amber }, label: 'Sympathy: amber breathing', moment: true },
  confused: { emoji: 130, loop: false, led: { mode: 2, ...COLORS.amber }, label: 'Confused: amber blinking', moment: true },
  cute: { emoji: 150, loop: false, led: { mode: 0, ...COLORS.cyan }, label: 'Playful (joke declined): cyan', moment: true },
  serious: { emoji: 160, loop: false, led: { mode: 2, ...COLORS.red }, label: 'Serious (emergency): red blinking', moment: true },
  error: { emoji: 70, loop: false, led: { mode: 2, ...COLORS.red }, label: 'Something is wrong: red blinking', moment: true }
} as const satisfies Record<string, Look>
export type LookName = keyof typeof LOOKS
export const LOOK_NAMES = Object.keys(LOOKS) as LookName[]

// ---------------------------------------------------------------- test commands (from the dashboard)

const byte = z.coerce.number().int().min(0).max(255)
export const displayCommandInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('emoji'), id: z.coerce.number().int().refine((n) => EMOJIS.some((e) => e.id === n), 'not an emoji id'), loop: z.boolean().default(false) }),
  z.object({ type: z.literal('led'), mode: z.coerce.number().int().min(0).max(3), r: byte, g: byte, b: byte }),
  z.object({ type: z.literal('look'), name: z.enum(LOOK_NAMES as [LookName, ...LookName[]]) }),
  /** A QR on the robot's screen, played as a looping video. `text` is what the QR carries. */
  z.object({ type: z.literal('qr'), text: z.string().trim().min(1).max(400), seconds: z.coerce.number().int().min(3).max(120).default(20) }),
  /** A video that is already on the robot's interaction computer (PC3), by absolute path. */
  z.object({ type: z.literal('video'), path: z.string().trim().min(2).max(300).regex(/^\/[\w./ -]+$/, 'an absolute path such as /var/tmp/hala/test.mp4'), loop: z.boolean().default(false) }),
  /** Hand the screen back: stop a looping video and show the calm face again. */
  z.object({ type: z.literal('clear') })
])
export type DisplayCommandInput = z.infer<typeof displayCommandInput>

export interface DisplayCommand {
  id: string
  robotId: string
  command: DisplayCommandInput
  status: 'pending' | 'sent' | 'done' | 'failed'
  result?: string
  createdAt: string
  doneAt?: string
}

// ---------------------------------------------------------------- what to show for a conversation

export interface ScreenDirective {
  /** A QR for the robot's screen. `key` changes when the QR must change; the bridge shows it until it is null. */
  qr: { key: string; kind: 'link' | 'pass'; code?: string; url?: string } | null
  /** A reaction to something that just happened. `id` is the event id: the bridge plays each one once. */
  look: { id: string; name: LookName } | null
}

/** How long the Smart Pass QR stays on the robot's screen before the face comes back. */
export const PASS_QR_SECS = 30
/** A reaction older than this is not played any more (the bridge was busy, or this is old history). */
export const LOOK_FRESH_SECS = 8

const moment = (e: HalaEvent): LookName | undefined => {
  const d = e.data
  switch (e.type) {
    case 'booking_created': return d.duplicate === true ? undefined : 'delighted'
    case 'booking_rescheduled':
    case 'request_logged': return d.duplicate === true ? undefined : 'happy'
    case 'phone_linked': return 'happy'
    case 'pass_sent': return undefined // the booking already got its moment
    case 'booking_cancelled': return 'sympathy'
    case 'handover_requested': return d.reason === 'emergency' ? 'serious' : 'sympathy'
    case 'handover_declined': return 'cute'
    case 'tool_error': return 'confused'
    case 'service_matched': return d.found === false ? 'confused' : undefined
    default: return undefined
  }
}

/**
 * From the events of the conversation the robot is in, what its screen and face should do right now. Stateless: the website
 * works it out again at every sync, so a restart or a missed sync loses nothing.
 */
export function deriveScreen(events: HalaEvent[], now: Date): ScreenDirective {
  const t = now.getTime()
  let qr: ScreenDirective['qr'] = null
  let look: ScreenDirective['look'] = null
  let pass: { ref: string; url: string; at: number } | undefined
  for (const e of events) {
    const d = e.data
    const at = Date.parse(e.ts)
    if (e.type === 'phone_requested' && typeof d.code === 'string') qr = { key: `link:${d.code}`, kind: 'link', code: d.code }
    else if (e.type === 'phone_linked') { if (qr?.kind === 'link') qr = null }
    else if ((e.type === 'booking_created' || e.type === 'booking_rescheduled' || e.type === 'request_logged') && typeof d.pass_url === 'string' && d.duplicate !== true) {
      pass = { ref: String((d.pass as { ref?: string } | undefined)?.ref ?? d.ref ?? ''), url: d.pass_url, at }
    } else if (e.type === 'booking_cancelled' && pass && d.ref === pass.ref) pass = undefined

    const m = moment(e)
    if (m && t - at <= LOOK_FRESH_SECS * 1000) look = { id: e.id, name: m }
  }
  // The phone QR (needed to book) wins over the pass QR; the pass QR is shown for a while after it is made.
  if (!qr && pass && t - pass.at <= PASS_QR_SECS * 1000) qr = { key: `pass:${pass.ref}:${pass.at}`, kind: 'pass', url: pass.url }
  return { qr, look }
}
