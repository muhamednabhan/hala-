import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  AI_INTRO, createElevenTextAgent, createHackClubAi, createPhoneStore, createPhoneTools, createSmsService, createSupabasePhoneStore,
  phoneTablesReady, queueNudges, type ChatPort, type PhoneStore, type PhoneTools, type SmsService, type Synthesize
} from '@hala/phone'
import { DEFAULT_VOICE_ID } from '@hala/provisioning'
import { elevenlabs } from '@/lib/eleven'
import { agentId, hala, repoRoot, setting } from '@/lib/server'

/**
 * Everything the HALA Phone iOS app talks to, one set per server process (pinned on globalThis for the
 * same reason as hala(): Next can load each route as its own module instance).
 */
export interface Phone {
  store: PhoneStore
  sms: SmsService
  tools: PhoneTools
  /** Scan bookings for people with something coming up and queue a call for each. */
  runNudges: (phone?: string) => Promise<Awaited<ReturnType<typeof queueNudges>>>
  audioDir: string
  /** The small model that words proactive calls, when a Hack Club AI key is set. */
  ai?: ChatPort
  storeKind: 'supabase' | 'file'
  storeNote?: string
}
const g = globalThis as unknown as { __halaPhone?: Promise<Phone>; __halaNudgeTimer?: ReturnType<typeof setInterval> }

const dataDir = () => resolve(/*turbopackIgnore: true*/ repoRoot, '.data')

async function build(): Promise<Phone> {
  const h = await hala()
  // Supabase when the booking store is on Supabase AND the phone tables exist; otherwise the local JSON file.
  let store: PhoneStore = createPhoneStore({ file: resolve(/*turbopackIgnore: true*/ dataDir(), 'phone-store.json') })
  let storeKind: Phone['storeKind'] = 'file'
  let storeNote: string | undefined
  const sbUrl = setting('SUPABASE_URL')
  const sbKey = setting('SUPABASE_SERVICE_KEY')
  if (h.storeKind === 'supabase' && sbUrl && sbKey && setting('HALA_STORE') !== 'file') {
    const ready = await phoneTablesReady({ url: sbUrl, serviceKey: sbKey })
    if (ready.ok) { store = createSupabasePhoneStore({ url: sbUrl, serviceKey: sbKey }); storeKind = 'supabase' }
    else { storeNote = `Phone data is in the local file: ${ready.reason}`; console.warn(`hala phone: ${storeNote}`) }
  }
  const audioDir = resolve(/*turbopackIgnore: true*/ dataDir(), 'voice')

  const publish = async (e: { type: never | string; data: Record<string, unknown>; conversationId?: string }) =>
    h.stores.events.publish({ id: randomUUID(), ts: new Date().toISOString(), conversationId: e.conversationId, type: e.type as never, data: e.data })

  // eslint-disable-next-line prefer-const
  let sms: SmsService
  const agent = createElevenTextAgent({
    // An answer that arrives after its turn was returned (a slow tool) still reaches the phone, via the next poll.
    onLate: (to, text) => { void sms.sendFromAgent(to, text) },
    getSignedUrl: async () => {
      const id = agentId('phone')
      if (!id) throw new Error('the phone agent is not set up (run: npm run agent:sync -- --channel phone)')
      return (await elevenlabs().conversationalAi.conversations.getSignedUrl({ agentId: id })).signedUrl
    }
  })

  // Voice-message replies: the same ElevenLabs voice as the calls, as a small mp3 the app plays inline.
  const synthesize: Synthesize = async (text, _lang) => {
    const stream = await elevenlabs().textToSpeech.convert(setting('HALA_VOICE_ID') ?? DEFAULT_VOICE_ID, {
      text, modelId: 'eleven_flash_v2_5', outputFormat: 'mp3_44100_64'
    })
    const bytes = Buffer.from(await new Response(stream as unknown as ReadableStream).arrayBuffer())
    if (bytes.length < 200) return undefined
    mkdirSync(audioDir, { recursive: true })
    const id = randomUUID()
    writeFileSync(resolve(/*turbopackIgnore: true*/ audioDir, `${id}.mp3`), bytes)
    return { audioUrl: `/api/phone/audio/${id}`, durationSec: Math.max(1, Math.round(bytes.length / 8000)) } // 64 kbps = 8000 B/s
  }

  sms = createSmsService({ store, agent, synthesize, publish })
  const tools = createPhoneTools({
    store, secret: h.secret, publish,
    sendText: (phone, text) => sms.sendFromAgent(phone, text)
  })

  const ai = createHackClubAi({ apiKey: setting('HACKCLUB_AI_KEY'), model: setting('HACKCLUB_AI_MODEL') })
  const runNudges = (phone?: string) => queueNudges({ bookings: h.stores.bookings, store, ai, phone })

  // Look for appointments coming up every minute, so calls happen on their own. HALA_NUDGE_AUTO=0 turns it off.
  if (setting('HALA_NUDGE_AUTO') !== '0' && !g.__halaNudgeTimer) {
    g.__halaNudgeTimer = setInterval(() => { runNudges().catch((e) => console.warn('nudge scan failed', (e as Error).message)) }, 60_000)
    g.__halaNudgeTimer.unref?.()
  }
  return { store, sms, tools, runNudges, audioDir, ai, storeKind, storeNote }
}

export const phone = (): Promise<Phone> => (g.__halaPhone ??= build())

/** Where the app should point: the public tunnel URL if there is one, else wherever this request came from. */
export function publicBase(req: Request): string {
  return (setting('PUBLIC_BASE_URL') ?? new URL(req.url).origin).replace(/\/$/, '')
}

export const manualOpening = (lang: 'en' | 'ar', text?: string): string => {
  const intro = AI_INTRO[lang]
  if (text) return text.startsWith(intro) ? text : `${intro} ${text}`
  return lang === 'ar'
    ? `${intro} أتصل لأتأكد أن خط هلا يعمل عندك. هل تحتاج أي مساعدة؟`
    : `${intro} I'm calling to check that your HALA line works. Is there anything I can help with?`
}

export const readAudio = (dir: string, id: string): Buffer | undefined => {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined
  const file = resolve(/*turbopackIgnore: true*/ dir, `${id}.mp3`)
  return existsSync(file) ? readFileSync(file) : undefined
}
