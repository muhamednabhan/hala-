import { timingSafeEqual } from 'node:crypto'
import type { HalaEvent } from '@hala/core'
import { schemaFor, type ToolSpec } from '@hala/tools-api'
import { normalizeSpokenCode } from './codes'
import { maskPhone } from './numbers'
import type { PhoneStore } from './store'

/**
 * Tools that exist only for the phone line. They are kept apart from TOOL_SPECS on purpose: the web
 * and robot agents (and the tests that pin them) stay exactly as they were.
 */
export const PHONE_TOOL_NAMES = { lookupContact: 'lookup_contact_by_code', sendText: 'send_text_message' } as const

export const PHONE_TOOL_SPECS: ToolSpec[] = [
  {
    name: PHONE_TOOL_NAMES.lookupContact,
    description:
      'Find the phone number linked to a HALA link code, so the caller never has to say their number out loud. ' +
      'Call it when the caller reads you a 6-character code (letters and digits) that the robot showed them. ' +
      'The result is a contact you can use for bookings. Never read the full number aloud.',
    params: { code: { type: 'string', description: 'The 6-character code as the caller said it, e.g. K7M2QX. Spaces are fine.' } },
    timeoutSecs: 8, preSpeech: 'off'
  },
  {
    name: PHONE_TOOL_NAMES.sendText,
    description:
      "Send the caller a text message on their phone, for example the documents list or a booking reference they will want to keep. " +
      'Call it only when the caller asks for a text or agrees to receive one. Write the message in the language they are using. Keep it under 300 characters, plain text.',
    params: {
      text: { type: 'string', description: 'The text message to send. Plain text, no markup. Only facts you got from tools.' },
      language: { type: 'string', enum: ['en', 'ar'], description: 'Language of the message.', optional: true }
    },
    timeoutSecs: 8, preSpeech: 'off'
  }
]

export interface PhoneToolsOptions {
  store: PhoneStore
  secret?: string
  /** Appends to the thread so the phone app shows the text. */
  sendText: (phone: string, text: string) => Promise<unknown>
  publish?: (e: Pick<HalaEvent, 'type' | 'data'> & { conversationId?: string }) => Promise<void> | void
  insecureNoAuth?: boolean
}

const safeEqual = (a: string, b: string) => {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

export const isPhoneTool = (name: string) => PHONE_TOOL_SPECS.some((s) => s.name === name)

export function createPhoneTools(o: PhoneToolsOptions) {
  const authorised = (headers: Headers | Record<string, string | undefined>) => {
    if (o.insecureNoAuth) return true
    if (!o.secret) return false
    const given = (headers instanceof Headers ? headers.get('x-hala-secret') : headers['x-hala-secret']) ?? ''
    return safeEqual(given, o.secret)
  }

  async function handle(name: string, headers: Headers | Record<string, string | undefined>, json: unknown) {
    if (!authorised(headers)) return { status: 401, body: { ok: false, error_code: 'unauthorized' } as Record<string, unknown> }
    const spec = PHONE_TOOL_SPECS.find((s) => s.name === name)
    if (!spec) return { status: 404, body: { ok: false, error_code: 'unknown_tool' } as Record<string, unknown> }
    const parsed = schemaFor(spec).safeParse(json)
    if (!parsed.success) {
      return { status: 200, body: { ok: false, error_code: 'invalid_input', message: parsed.error.issues[0]?.message ?? 'invalid input', instruction: 'Ask the caller for the missing item.' } as Record<string, unknown> }
    }
    const a = parsed.data as Record<string, unknown>
    const conversationId = typeof a.conversation_id === 'string' ? a.conversation_id : undefined

    if (name === PHONE_TOOL_NAMES.lookupContact) {
      const code = normalizeSpokenCode(String(a.code ?? ''))
      const contact = code ? await o.store.contactByCode(code) : undefined
      if (!contact) {
        return { status: 200, body: { ok: true, found: false, instruction: 'That code is not linked to a phone. Ask them to read it again, slowly, one character at a time. If it still fails, ask for their phone number instead.' } }
      }
      if (conversationId) await o.store.bindConversation(conversationId, contact.phone)
      await o.publish?.({ type: 'phone_linked', conversationId, data: { code, phone: maskPhone(contact.phone), via: 'spoken_code' } })
      return {
        status: 200,
        body: {
          ok: true, found: true, contact: contact.phone, last_four: contact.phone.replace(/\D/g, '').slice(-4),
          ...(contact.name ? { name: contact.name } : {}),
          instruction: 'Use `contact` as the contact for bookings and requests. Do not read the number aloud. If you must confirm it, say only the last four digits.'
        }
      }
    }

    // send_text_message
    const phone = conversationId ? await o.store.phoneForConversation(conversationId) : undefined
    const text = typeof a.text === 'string' ? a.text.replace(/\s+/g, ' ').trim().slice(0, 600) : ''
    if (!phone) {
      return { status: 200, body: { ok: false, error_code: 'no_phone', message: 'No phone is linked to this conversation', instruction: 'Say you cannot text them right now, and offer to read the information out instead. Do not ask them to say their number.' } }
    }
    if (!text) return { status: 200, body: { ok: false, error_code: 'invalid_input', message: 'text is empty', instruction: 'Write the message first.' } }
    await o.sendText(phone, text)
    await o.publish?.({ type: 'phone_text_sent', conversationId, data: { phone: maskPhone(phone), chars: text.length } })
    return { status: 200, body: { ok: true, sent: true, instruction: 'Tell the caller the text is on its way. Do not read the number.' } }
  }

  return { handle }
}

export type PhoneTools = ReturnType<typeof createPhoneTools>
