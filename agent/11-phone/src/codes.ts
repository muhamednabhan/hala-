import { randomInt } from 'node:crypto'

/** No 0/O/1/I/L: a code that is read out loud or typed from a screen must survive being misheard. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 6

export function generateCode(): string {
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += ALPHABET[randomInt(ALPHABET.length)]
  return out
}

const CODE_RE = new RegExp(`\\b(HALA[\\s-]*)?([${ALPHABET}]{${CODE_LENGTH}})\\b`, 'gi')

export interface CodeCandidate { code: string; prefixed: boolean }

/**
 * Every code-shaped token in a text. The QR pre-fills "HALA K7M2QX", but people edit it, so a bare
 * code counts too. A bare token is only a real code if the store knows it ("ACCESS" fits the
 * alphabet), which is why the caller checks each candidate; a "HALA"-prefixed one is clearly meant.
 */
export function parseCodes(body: string): CodeCandidate[] {
  const out: CodeCandidate[] = []
  for (const m of body.toUpperCase().matchAll(CODE_RE)) out.push({ code: m[2]!, prefixed: Boolean(m[1]) })
  return out
}

/** A code spoken or typed with spaces and dashes ("k 7 m 2 q x", "HALA-K7M2QX"). */
export function normalizeSpokenCode(input: string): string | undefined {
  const compact = input.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^HALA/, '')
  return new RegExp(`^[${ALPHABET}]{${CODE_LENGTH}}$`).test(compact) ? compact : undefined
}

/** What the QR code opens: the iOS app, on its Messages tab, with the SMS pre-filled. */
export function deepLink(code: string, serverUrl?: string): string {
  const q = new URLSearchParams({ code })
  if (serverUrl) q.set('server', serverUrl)
  return `halaphone://link?${q.toString()}`
}

/** The text the app pre-fills. */
export const smsBodyFor = (code: string) => `HALA ${code}`
