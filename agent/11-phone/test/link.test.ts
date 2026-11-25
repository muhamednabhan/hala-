import { describe, expect, it, vi } from 'vitest'
import { createPhoneStore, createPhoneTools, createSmsService, deepLink, stripAudioTags, LINK_TOOL_SPECS, isPhoneTool, type TextAgent } from '../src'

const SECRET = 'phone-secret'
const headers = { 'x-hala-secret': SECRET }
const PHONE = '+971501234567'

function setup() {
  const store = createPhoneStore()
  const events: { type: string; conversationId?: string; data: Record<string, unknown> }[] = []
  const tools = createPhoneTools({ store, secret: SECRET, sendText: async () => undefined, publish: (e) => { events.push(e as never) } })
  const call = async (name: string, body: Record<string, unknown> = {}, conv: string | undefined = 'conv_robot') =>
    (await tools.handle(name, headers, { ...(conv ? { conversation_id: conv } : {}), ...body })).body as Record<string, any>
  const agent: TextAgent = { reply: vi.fn(async () => ({ texts: ['ok'] })), close: vi.fn() }
  const sms = createSmsService({ store, agent, publish: (e) => { events.push(e as never) } })
  return { store, events, call, sms }
}

describe('the QR link tools', () => {
  it('are served by the phone tools and listed for the agents', () => {
    expect(LINK_TOOL_SPECS.map((s) => s.name)).toEqual(['request_phone_link', 'get_linked_phone'])
    expect(isPhoneTool('request_phone_link')).toBe(true)
    expect(isPhoneTool('get_linked_phone')).toBe(true)
    expect(isPhoneTool('book_appointment')).toBe(false)
  })

  it('request_phone_link puts a QR for THIS conversation on the screen (an event) and answers at once', async () => {
    const { call, events, store } = setup()
    const r = await call('request_phone_link')
    expect(r.ok).toBe(true)
    expect(r.qr_on_screen).toBe(true)
    const ev = events.find((e) => e.type === 'phone_requested')!
    expect(ev.conversationId).toBe('conv_robot')
    const code = String(ev.data.code)
    expect(code).toMatch(/^[A-Z2-9]{6}$/)
    expect(ev.data.qr).toBe(`/api/phone/qr?code=${code}`)
    expect(ev.data.sms_body).toBe(`HALA ${code}`)
    expect((await store.getCode(code))?.conversationId).toBe('conv_robot')
  })

  it('asking twice shows the same code (the visitor may already be scanning)', async () => {
    const { call, events } = setup()
    await call('request_phone_link')
    await call('request_phone_link')
    const codes = events.filter((e) => e.type === 'phone_requested').map((e) => e.data.code)
    expect(codes).toHaveLength(2)
    expect(codes[0]).toBe(codes[1])
  })

  it('needs a conversation to attach the QR to', async () => {
    const { call } = setup()
    const r = await call('request_phone_link', {}, '') // no conversation id
    expect(r.ok).toBe(false)
    expect(r.error_code).toBe('no_conversation')
  })

  it('get_linked_phone says "not yet" until the visitor has texted the code, then returns the contact', async () => {
    const { call, events, sms } = setup()
    await call('request_phone_link')
    const before = await call('get_linked_phone')
    expect(before.found).toBe(false)
    expect(before.instruction).toMatch(/Not linked yet/)

    const code = String(events.find((e) => e.type === 'phone_requested')!.data.code)
    const res = await sms.receive({ from: PHONE, body: `HALA ${code}` }) // what the QR pre-fills in the app
    expect(res.linked?.phone).toBe(PHONE)

    const after = await call('get_linked_phone')
    expect(after.found).toBe(true)
    expect(after.contact).toBe(PHONE)
    expect(after.last_four).toBe('4567')
    expect(after.instruction).toMatch(/Do not read the number aloud/)
    // the screen is told too, on the same conversation
    expect(events.find((e) => e.type === 'phone_linked')?.conversationId).toBe('conv_robot')
  })

  it('a phone linked in one conversation is not handed to another', async () => {
    const { call, events, sms } = setup()
    await call('request_phone_link')
    await sms.receive({ from: PHONE, body: `HALA ${String(events.find((e) => e.type === 'phone_requested')!.data.code)}` })
    expect((await call('get_linked_phone', {}, 'conv_someone_else')).found).toBe(false)
  })

  it('does not show the QR again once the phone is linked', async () => {
    const { call, events, sms } = setup()
    await call('request_phone_link')
    await sms.receive({ from: PHONE, body: `HALA ${String(events.find((e) => e.type === 'phone_requested')!.data.code)}` })
    const again = await call('request_phone_link')
    expect(again.already_linked).toBe(true)
    expect(events.filter((e) => e.type === 'phone_requested')).toHaveLength(1)
  })

  it('refuses without the secret', async () => {
    const tools = createPhoneTools({ store: createPhoneStore(), secret: SECRET, sendText: async () => undefined })
    expect((await tools.handle('get_linked_phone', {}, { conversation_id: 'c' })).status).toBe(401)
  })

  it('the QR deep link carries the code and the server', () => {
    expect(deepLink('K7M2QX', 'https://x.trycloudflare.com')).toBe('halaphone://link?code=K7M2QX&server=https%3A%2F%2Fx.trycloudflare.com')
  })
})

describe('audio tags never reach a text thread', () => {
  it('strips tags of any case and keeps ordinary brackets', () => {
    expect(stripAudioTags('[warmly] Welcome to HALA')).toBe('Welcome to HALA')
    expect(stripAudioTags('[Cheerfully] Booked! [chuckles] See you Thursday.')).toBe('Booked! See you Thursday.')
    expect(stripAudioTags('The fee is AED 2,800 [DEMO]')).toBe('The fee is AED 2,800 [DEMO]') // an all-caps label is not a voice direction
  })
  it('the sms service strips them from the agent answer before the phone sees it', async () => {
    const store = createPhoneStore()
    const agent: TextAgent = { reply: async () => ({ texts: ['[warmly] The fee is a demo value.'] }), close: () => undefined }
    const sms = createSmsService({ store, agent })
    const res = await sms.receive({ from: PHONE, body: 'How much is an access card?' })
    const answers = res.replies.map((r) => r.text)
    expect(answers.some((t) => t === 'The fee is a demo value.')).toBe(true)
    expect(answers.join(' ')).not.toMatch(/\[/)
  })
  it('a late answer is cleaned too', async () => {
    const store = createPhoneStore()
    const sms = createSmsService({ store, agent: { reply: async () => ({ texts: [] }), close: () => undefined } })
    const m = await sms.sendFromAgent(PHONE, '[softly]  Sorry for the wait')
    expect(m.text).toBe('Sorry for the wait')
  })
})
