import { BILINGUAL_GREETING, type HalaEvent, type Lang } from '@hala/core'
import { maskContact } from '@hala/tools-api'
import type { TextAgent } from './agent-text'
import { parseCodes } from './codes'
import { maskPhone, normalizePhone } from './numbers'
import type { PhoneStore } from './store'
import type { Contact, PhoneMessage } from './types'

export type PublishEvent = (e: Pick<HalaEvent, 'type' | 'data'> & { conversationId?: string }) => Promise<void> | void

/** Turns reply text into a voice message. Returns undefined when speech is not available. */
export type Synthesize = (text: string, lang: Lang) => Promise<{ audioUrl: string; durationSec: number } | undefined>

export interface SmsServiceOptions {
  store: PhoneStore
  agent: TextAgent
  synthesize?: Synthesize
  publish?: PublishEvent
}

export interface IncomingText {
  from: string
  body: string
  /** The sender asked for a spoken reply (voice message) instead of text. */
  voice?: boolean
}

export interface SmsResult {
  message: PhoneMessage
  replies: PhoneMessage[]
  linked?: Contact
}

export class SmsError extends Error {
  constructor(readonly code: 'invalid_phone' | 'empty') { super(code) }
}

const hasArabic = (s: string) => /[؀-ۿ]/.test(s)

export const LINKED_TEXT = {
  en: "You're connected. I'm HALA, an AI assistant for Dubai Silicon Oasis, not a person. Text me anything, in English or Arabic, and I can find a service, book a slot or pass you to the DSO team.",
  ar: 'تم الربط. أنا هلا، مساعدة ذكاء اصطناعي من واحة دبي للسيليكون، ولست إنساناً. اكتب لي أي شيء بالعربي أو الإنجليزي وأقدر أدلّك على الخدمة أو أحجز لك موعد أو أحوّلك لفريق واحة دبي للسيليكون.'
}
export const BAD_CODE_TEXT = {
  en: "I couldn't match that code. It may have expired or been used already. Scan the QR code on the robot's screen again for a fresh one.",
  ar: 'ما قدرت أتعرّف على هذا الرمز. ممكن انتهت صلاحيته أو استُخدم من قبل. امسح رمز الاستجابة السريعة على شاشة الروبوت مرة ثانية للحصول على رمز جديد.'
}
export const AGENT_DOWN_TEXT = {
  en: "Sorry, I couldn't process that just now. Please send it again in a moment, or ask for a person at the DSO reception.",
  ar: 'عذراً، ما قدرت أعالج رسالتك الآن. أرسلها مرة ثانية بعد لحظة، أو اطلب موظفاً من استقبال واحة دبي للسيليكون.'
}

export function createSmsService(o: SmsServiceOptions) {
  const { store } = o
  const publish = async (e: Parameters<PublishEvent>[0]) => { try { await o.publish?.(e) } catch { /* the feed must never break a text */ } }

  async function reply(phone: string, text: string, lang: Lang, wantVoice: boolean): Promise<PhoneMessage> {
    if (wantVoice && o.synthesize) {
      try {
        const audio = await o.synthesize(text, lang)
        if (audio) return await store.addMessage({ phone, from: 'agent', kind: 'voice', text, audioUrl: audio.audioUrl, durationSec: audio.durationSec })
      } catch { /* fall through to a plain text reply */ }
    }
    return store.addMessage({ phone, from: 'agent', kind: 'text', text })
  }

  /** A text arrived from `from`. Stores it, links codes, asks the agent, stores the answer. */
  async function receive(input: IncomingText): Promise<SmsResult> {
    const phone = normalizePhone(input.from)
    if (!phone) throw new SmsError('invalid_phone')
    const text = input.body.replace(/\s+/g, ' ').trim().slice(0, 600)
    if (!text) throw new SmsError('empty')

    const language: Lang = hasArabic(text) ? 'ar' : 'en'
    const earlier = await store.messagesFor(phone)
    const message = await store.addMessage({ phone, from: 'user', kind: 'text', text })
    const contact = await store.touchContact(phone, { language })
    const replies: PhoneMessage[] = []

    // 1. A link code from the robot's QR: this is how the server learns "this phone is that person".
    const candidates = parseCodes(text)
    for (const c of candidates) {
      const known = await store.getCode(c.code)
      if (!known) continue
      const res = await store.linkCode(c.code, phone)
      if (res.ok) {
        replies.push(await reply(phone, LINKED_TEXT[language], language, false))
        await publish({
          type: 'phone_linked', conversationId: res.record.conversationId,
          data: { code: c.code, phone: maskPhone(phone), language }
        })
        return { message, replies, linked: res.contact }
      }
      replies.push(await reply(phone, BAD_CODE_TEXT[language], language, false))
      return { message, replies }
    }
    if (candidates.some((c) => c.prefixed)) {
      replies.push(await reply(phone, BAD_CODE_TEXT[language], language, false))
      return { message, replies }
    }

    // 2. Anything else goes to the agent. The first text of a thread gets the AI disclosure up front.
    if (earlier.length === 0) replies.push(await store.addMessage({ phone, from: 'agent', kind: 'text', text: BILINGUAL_GREETING }))

    try {
      const history = earlier.slice(-8).map((m) => ({ from: m.from, text: m.text }))
      const answer = await o.agent.reply(
        { phone, name: contact.name, language, history, firstMessage: BILINGUAL_GREETING },
        text
      )
      if (answer.conversationId) await store.bindConversation(answer.conversationId, phone)
      const joined = answer.texts.join(' ')
      if (input.voice && o.synthesize) {
        replies.push(await reply(phone, joined, hasArabic(joined) ? 'ar' : language, true))
      } else {
        for (const t of answer.texts) replies.push(await reply(phone, t, language, false))
      }
    } catch (e) {
      await publish({ type: 'tool_error', data: { channel: 'sms', phone: maskContact(phone), message: (e as Error).message.slice(0, 160) } })
      replies.push(await reply(phone, AGENT_DOWN_TEXT[language], language, false))
    }
    return { message, replies }
  }

  /** The app opened a thread: get the agent session ready so the first text is answered at full speed. */
  async function warm(rawPhone: string): Promise<void> {
    const phone = normalizePhone(rawPhone)
    if (!phone || !o.agent.warm) return
    const contact = await store.contactByPhone(phone)
    const history = (await store.messagesFor(phone)).slice(-8).map((m) => ({ from: m.from, text: m.text }))
    await o.agent.warm({ phone, name: contact?.name, language: contact?.language ?? 'en', history, firstMessage: BILINGUAL_GREETING })
  }

  /** HALA texts a phone on its own (a follow-up the agent asked for, or a proactive notice). */
  async function sendFromAgent(phone: string, text: string): Promise<PhoneMessage> {
    return store.addMessage({ phone, from: 'agent', kind: 'text', text: text.replace(/\s+/g, ' ').trim().slice(0, 600) })
  }

  return { receive, sendFromAgent, warm }
}

export type SmsService = ReturnType<typeof createSmsService>
