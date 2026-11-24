import { describe, expect, it, vi } from 'vitest'
import { BILINGUAL_GREETING, type Booking } from '@hala/core'
import { createStores } from '@hala/booking'
import {
  AI_INTRO, PHONE_TOOL_SPECS, composeOpening, createHackClubAi, createElevenTextAgent, createPhoneStore, createPhoneTools, createSmsService,
  deepLink, maskPhone, normalizePhone, normalizeSpokenCode, parseCodes, planNudges, queueNudges, samePhone, smsBodyFor,
  type ChatPort, type TextAgent, type WebSocketLike
} from '../src'

const PHONE = '+971501234567'

describe('numbers', () => {
  it('normalises dummy numbers and rejects junk', () => {
    expect(normalizePhone('+971 50 123 4567')).toBe(PHONE)
    expect(normalizePhone('00971501234567')).toBe(PHONE)
    expect(normalizePhone('12')).toBeUndefined()
    expect(normalizePhone(42)).toBeUndefined()
  })
  it('matches a booking contact written a different way', () => {
    expect(samePhone('050 123 4567', PHONE)).toBe(true)
    expect(samePhone('050 123 4568', PHONE)).toBe(false)
  })
  it('masks to the last four digits', () => expect(maskPhone(PHONE)).toBe('***4567'))
})

describe('link codes', () => {
  it('finds a prefixed or bare code but flags which', () => {
    expect(parseCodes('HALA K7M2QX')).toEqual([{ code: 'K7M2QX', prefixed: true }])
    expect(parseCodes('k7m2qx')).toEqual([{ code: 'K7M2QX', prefixed: false }])
    expect(parseCodes('hala-k7m2qx please')[0]?.prefixed).toBe(true)
  })
  it('ignores ordinary words that merely fit the alphabet only when the store does not know them', () => {
    expect(parseCodes('I need an ACCESS card')).toEqual([{ code: 'ACCESS', prefixed: false }]) // the sms layer checks the store
  })
  it('reads a spoken code', () => {
    expect(normalizeSpokenCode('k 7 m 2 q x')).toBe('K7M2QX')
    expect(normalizeSpokenCode('HALA-K7M2QX')).toBe('K7M2QX')
    expect(normalizeSpokenCode('hello')).toBeUndefined()
  })
  it('builds the deep link the QR opens', () => {
    expect(deepLink('K7M2QX', 'https://x.trycloudflare.com')).toBe('halaphone://link?code=K7M2QX&server=https%3A%2F%2Fx.trycloudflare.com')
    expect(smsBodyFor('K7M2QX')).toBe('HALA K7M2QX')
  })
})

describe('store', () => {
  it('links a code to exactly one phone', async () => {
    const store = createPhoneStore()
    const { code } = await store.issueCode()
    const first = await store.linkCode(code, PHONE)
    expect(first.ok).toBe(true)
    expect(await store.linkCode(code, PHONE)).toMatchObject({ ok: true }) // the same phone again is fine
    expect(await store.linkCode(code, '+971509999999')).toEqual({ ok: false, reason: 'used' })
    expect((await store.contactByCode(code))?.phone).toBe(PHONE)
  })
  it('rejects unknown and expired codes', async () => {
    let t = new Date('2026-11-24T10:00:00Z')
    const store = createPhoneStore({ now: () => t })
    expect(await store.linkCode('NOPE22', PHONE)).toEqual({ ok: false, reason: 'unknown' })
    const { code } = await store.issueCode()
    t = new Date('2026-11-25T11:00:00Z')
    expect(await store.linkCode(code, PHONE)).toEqual({ ok: false, reason: 'expired' })
  })
  it('hands out messages after a cursor, per phone', async () => {
    const store = createPhoneStore()
    const a = await store.addMessage({ phone: PHONE, from: 'user', kind: 'text', text: 'hi' })
    await store.addMessage({ phone: '+971500000000', from: 'user', kind: 'text', text: 'other' })
    const b = await store.addMessage({ phone: PHONE, from: 'agent', kind: 'text', text: 'hello' })
    expect((await store.messagesFor(PHONE)).map((m) => m.text)).toEqual(['hi', 'hello'])
    expect((await store.messagesFor(PHONE, a.seq)).map((m) => m.id)).toEqual([b.id])
  })
})

function fakeAgent(texts: string[] = ['Sure, I can help.'], fail = false): TextAgent & { calls: { text: string; first: string }[] } {
  const calls: { text: string; first: string }[] = []
  return {
    calls,
    async reply(ctx, text) {
      calls.push({ text, first: ctx.firstMessage })
      if (fail) throw new Error('down')
      return { texts, conversationId: 'conv_1' }
    },
    close() {}
  }
}

describe('sms', () => {
  it('opens a new thread with the AI disclosure, then the agent answer', async () => {
    const store = createPhoneStore()
    const agent = fakeAgent(['It costs a demo fee.'])
    const sms = createSmsService({ store, agent })
    const r = await sms.receive({ from: PHONE, body: 'How do I renew a visa?' })
    expect(r.replies.map((m) => m.text)).toEqual([BILINGUAL_GREETING, 'It costs a demo fee.'])
    expect(r.replies[0]?.text).toMatch(/AI assistant/)
    expect(agent.calls[0]?.first).toBe(BILINGUAL_GREETING)
    // second text: no repeated disclosure
    const r2 = await sms.receive({ from: PHONE, body: 'thanks' })
    expect(r2.replies).toHaveLength(1)
    expect(await store.phoneForConversation('conv_1')).toBe(PHONE)
  })

  it('links a code from the QR text and tells the robot screen, without calling the agent', async () => {
    const store = createPhoneStore()
    const agent = fakeAgent()
    const publish = vi.fn()
    const sms = createSmsService({ store, agent, publish })
    const { code } = await store.issueCode({ conversationId: 'robot_conv' })
    const r = await sms.receive({ from: '+971 50 123 4567', body: smsBodyFor(code) })
    expect(r.linked?.phone).toBe(PHONE)
    expect(r.replies[0]?.text).toMatch(/AI assistant/)
    expect(agent.calls).toHaveLength(0)
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'phone_linked', conversationId: 'robot_conv', data: expect.objectContaining({ phone: '***4567' }) }))
  })

  it('refuses a code that belongs to another phone, and never links the same code twice', async () => {
    const store = createPhoneStore()
    const sms = createSmsService({ store, agent: fakeAgent() })
    const { code } = await store.issueCode()
    await sms.receive({ from: PHONE, body: `HALA ${code}` })
    const r = await sms.receive({ from: '+971509999999', body: `HALA ${code}` })
    expect(r.linked).toBeUndefined()
    expect(r.replies[0]?.text).toMatch(/couldn't match/)
  })

  it('does not mistake an ordinary word for a code', async () => {
    const store = createPhoneStore()
    const agent = fakeAgent()
    await createSmsService({ store, agent }).receive({ from: PHONE, body: 'I need an ACCESS card' })
    expect(agent.calls).toHaveLength(1)
  })

  it('answers with a voice message when asked, with the transcript attached', async () => {
    const store = createPhoneStore()
    const synthesize = vi.fn(async () => ({ audioUrl: '/api/phone/audio/a1.mp3', durationSec: 4 }))
    const sms = createSmsService({ store, agent: fakeAgent(['Hello there.']), synthesize })
    const r = await sms.receive({ from: PHONE, body: 'hi', voice: true })
    const voice = r.replies.at(-1)!
    expect(voice).toMatchObject({ kind: 'voice', text: 'Hello there.', audioUrl: '/api/phone/audio/a1.mp3', durationSec: 4 })
  })

  it('falls back to text when speech fails, and apologises when the agent is down', async () => {
    const store = createPhoneStore()
    const failing = vi.fn(async () => { throw new Error('tts down') })
    const r = await createSmsService({ store, agent: fakeAgent(['Hi.']), synthesize: failing }).receive({ from: PHONE, body: 'hi', voice: true })
    expect(r.replies.at(-1)?.kind).toBe('text')
    const down = await createSmsService({ store: createPhoneStore(), agent: fakeAgent([], true) }).receive({ from: PHONE, body: 'hi' })
    expect(down.replies.at(-1)?.text).toMatch(/Sorry/)
  })

  it('replies in Arabic when the caller writes Arabic', async () => {
    const store = createPhoneStore()
    const { code } = await store.issueCode()
    const r = await createSmsService({ store, agent: fakeAgent() }).receive({ from: PHONE, body: `${'مرحبا'} HALA ${code}` })
    expect(r.replies[0]?.text).toMatch(/تم الربط/)
  })

  it('rejects empty texts and bad numbers', async () => {
    const sms = createSmsService({ store: createPhoneStore(), agent: fakeAgent() })
    await expect(sms.receive({ from: PHONE, body: '   ' })).rejects.toMatchObject({ code: 'empty' })
    await expect(sms.receive({ from: 'abc', body: 'hi' })).rejects.toMatchObject({ code: 'invalid_phone' })
  })
})

// ------------------------------------------------------------------ proactive calls

const booking = (over: Partial<Booking> = {}): Booking => ({
  ref: 'HALA-1001', serviceId: 'maintenance', attendeeName: 'Sara', contact: '050 123 4567',
  date: '2026-11-26', time: '10:30', language: 'en', status: 'confirmed', createdAt: '', updatedAt: '', ...over
})

async function world(b: Booking[]) {
  const stores = createStores()
  for (const x of b) await stores.bookings.create(x)
  const store = createPhoneStore()
  const { code } = await store.issueCode()
  await store.linkCode(code, PHONE)
  return { stores, store }
}

describe('proactive calls', () => {
  const now = new Date('2026-11-25T08:00:00Z') // 12:00 Dubai, the day before

  it('plans a reminder for a linked phone with an appointment inside the window', async () => {
    const { stores, store } = await world([booking()])
    const plan = await planNudges({ bookings: stores.bookings, store, now })
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ phone: PHONE, kind: 'appointment_reminder' })
    expect(plan[0]?.reason).toContain('HALA-1001')
  })

  it('skips cancelled bookings, far-off ones, past ones and unlinked contacts', async () => {
    const { stores, store } = await world([
      booking({ ref: 'HALA-1', status: 'cancelled' }),
      booking({ ref: 'HALA-2', date: '2026-12-10' }),
      booking({ ref: 'HALA-3', date: '2026-11-20' }),
      booking({ ref: 'HALA-4', contact: '055 999 8888' })
    ])
    expect(await planNudges({ bookings: stores.bookings, store, now })).toHaveLength(0)
  })

  it('rings once per appointment, not every scan', async () => {
    const { stores, store } = await world([booking()])
    expect(await queueNudges({ bookings: stores.bookings, store, now })).toHaveLength(1)
    expect(await queueNudges({ bookings: stores.bookings, store, now })).toHaveLength(0)
    const rings = await store.ringsFor(PHONE)
    expect(rings).toHaveLength(1)
    expect(rings[0]?.opening.startsWith(AI_INTRO.en)).toBe(true)
    expect(rings[0]?.opening).toContain('10:30 AM')
  })

  it('uses the model wording when it carries the real time, and always keeps the AI intro', async () => {
    const { stores, store } = await world([booking()])
    const [c] = await planNudges({ bookings: stores.bookings, store, now })
    const ai: ChatPort = { complete: async () => 'Quick reminder: your Maintenance Request visit is Thursday at 10:30 AM. Keep it, move it, or cancel it?' }
    const out = await composeOpening(c!, ai)
    expect(out.byModel).toBe(true)
    expect(out.text.startsWith(AI_INTRO.en)).toBe(true)
  })

  it('throws away model text that has the wrong time, a link or is missing, and uses the template', async () => {
    const { stores, store } = await world([booking()])
    const [c] = await planNudges({ bookings: stores.bookings, store, now })
    for (const bad of ['Your visit is at 3:00 PM, keep it or cancel it please.', 'See https://evil.example for 10:30 AM details please ok', undefined]) {
      const out = await composeOpening(c!, { complete: async () => bad })
      expect(out.byModel).toBe(false)
      expect(out.text).toContain('10:30 AM')
    }
    expect((await composeOpening(c!)).byModel).toBe(false)
  })

  it('speaks Arabic to an Arabic-speaking contact', async () => {
    const { stores, store } = await world([booking()])
    await store.touchContact(PHONE, { language: 'ar' })
    const [c] = await planNudges({ bookings: stores.bookings, store, now })
    const out = await composeOpening(c!)
    expect(out.text).toMatch(/ذكاء اصطناعي/)
    expect(out.text).toMatch(/10:30/)
  })
})

describe('hack club ai client', () => {
  it('sends a bearer key to the proxy and returns the text', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: ' hi ' } }] }), { status: 200 }))
    const ai = createHackClubAi({ apiKey: 'k', fetchImpl: fetchImpl as unknown as typeof fetch })!
    expect(await ai.complete('s', 'u')).toBe('hi')
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://ai.hackclub.com/proxy/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer k')
  })
  it('has no client without a key, and swallows every failure', async () => {
    expect(createHackClubAi({})).toBeUndefined()
    const boom = createHackClubAi({ apiKey: 'k', fetchImpl: (async () => { throw new Error('net') }) as unknown as typeof fetch })!
    expect(await boom.complete('s', 'u')).toBeUndefined()
    const bad = createHackClubAi({ apiKey: 'k', fetchImpl: (async () => new Response('no', { status: 401 })) as unknown as typeof fetch })!
    expect(await bad.complete('s', 'u')).toBeUndefined()
  })
})

// ------------------------------------------------------------------ phone-only tools

describe('phone tools', () => {
  const setup = async () => {
    const store = createPhoneStore()
    const { code } = await store.issueCode()
    await store.linkCode(code, PHONE)
    const sent: string[] = []
    const events: unknown[] = []
    const tools = createPhoneTools({ store, secret: 's3cret', sendText: async (_p, t) => { sent.push(t) }, publish: (e) => { events.push(e) } })
    return { store, code, tools, sent, events }
  }
  const auth = { 'x-hala-secret': 's3cret' }

  it('fails closed without the secret', async () => {
    const { tools } = await setup()
    expect((await tools.handle('lookup_contact_by_code', {}, {})).status).toBe(401)
    expect((await tools.handle('lookup_contact_by_code', { 'x-hala-secret': 'nope' }, {})).status).toBe(401)
  })
  it('looks a contact up by the code the caller reads out, and binds the conversation', async () => {
    const { tools, code, store, events } = await setup()
    const spoken = code.split('').join(' ')
    const r = await tools.handle('lookup_contact_by_code', auth, { conversation_id: 'c9', code: spoken })
    expect(r.body).toMatchObject({ ok: true, found: true, contact: PHONE, last_four: '4567' })
    expect(await store.phoneForConversation('c9')).toBe(PHONE)
    expect(JSON.stringify(events)).not.toContain('971501234567') // feeds are masked
  })
  it('says not found for a wrong code', async () => {
    const { tools } = await setup()
    const r = await tools.handle('lookup_contact_by_code', auth, { conversation_id: 'c9', code: 'ZZZZZZ' })
    expect(r.body).toMatchObject({ ok: true, found: false })
  })
  it('texts the phone bound to the conversation, and refuses when there is none', async () => {
    const { tools, store, sent } = await setup()
    expect((await tools.handle('send_text_message', auth, { conversation_id: 'nobody', text: 'hi' })).body).toMatchObject({ ok: false, error_code: 'no_phone' })
    await store.bindConversation('c1', PHONE)
    expect((await tools.handle('send_text_message', auth, { conversation_id: 'c1', text: 'Documents: passport copy' })).body).toMatchObject({ ok: true, sent: true })
    expect(sent).toEqual(['Documents: passport copy'])
  })
  it('exposes exactly the two phone tools', () => {
    expect(PHONE_TOOL_SPECS.map((s) => s.name)).toEqual(['lookup_contact_by_code', 'send_text_message'])
  })
})

// ------------------------------------------------------------------ websocket text agent

class FakeSocket implements WebSocketLike {
  sent: Record<string, any>[] = []
  private ls = new Map<string, ((ev: { data?: unknown }) => void)[]>()
  constructor(private script: (s: FakeSocket, m: Record<string, any>) => void) {
    queueMicrotask(() => this.emit('open', {}))
  }
  addEventListener(type: string, fn: (ev: { data?: unknown }) => void) { this.ls.set(type, [...(this.ls.get(type) ?? []), fn]) }
  emit(type: string, ev: { data?: unknown }) { for (const f of this.ls.get(type) ?? []) f(ev) }
  push(msg: Record<string, unknown>) { this.emit('message', { data: JSON.stringify(msg) }) }
  send(data: string) { const m = JSON.parse(data) as Record<string, any>; this.sent.push(m); this.script(this, m) }
  close() { this.emit('close', {}) }
}

describe('text agent', () => {
  const ctx = { phone: PHONE, language: 'en' as const, history: [], firstMessage: 'Welcome. I am an AI.' }
  const script = (reply: string) => (s: FakeSocket, m: Record<string, any>) => {
    if (m.type === 'conversation_initiation_client_data') {
      queueMicrotask(() => {
        s.push({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'conv_x' } })
        s.push({ type: 'agent_response', agent_response_event: { agent_response: 'Welcome. I am an AI.' } })
      })
    }
    if (m.type === 'user_message') setTimeout(() => s.push({ type: 'agent_response', agent_response_event: { agent_response: reply } }), 5)
  }

  it('opens one text-only session with dynamic variables, ignores the opening line, returns the answer', async () => {
    let socket!: FakeSocket
    const agent = createElevenTextAgent({
      getSignedUrl: async () => 'wss://x', settleMs: 30, createSocket: () => (socket = new FakeSocket(script('Your demo fee is AED 100.')))
    })
    const out = await agent.reply(ctx, 'fee?')
    expect(out).toEqual({ texts: ['Your demo fee is AED 100.'], conversationId: 'conv_x' })
    const init = socket.sent[0]!
    expect(init.conversation_config_override.conversation.text_only).toBe(true)
    expect(init.conversation_config_override.agent.first_message).toBe('Welcome. I am an AI.')
    expect(init.dynamic_variables).toMatchObject({ caller_number: PHONE, contact_mode: 'text message' })
    // second text reuses the session
    await agent.reply(ctx, 'again')
    expect(agent.sessions()).toBe(1)
    expect(socket.sent.filter((m) => m.type === 'user_message')).toHaveLength(2)
  })

  it('delivers an answer that arrives after its turn was returned (a slow tool) as its own message', async () => {
    const late: string[] = []
    let socket!: FakeSocket
    const agent = createElevenTextAgent({
      getSignedUrl: async () => 'wss://x', settleMs: 20, onLate: (_p, t) => late.push(t),
      createSocket: () => (socket = new FakeSocket((s, m) => {
        if (m.type === 'conversation_initiation_client_data') queueMicrotask(() => { s.push({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'c' } }); s.push({ type: 'agent_response', agent_response_event: { agent_response: 'Welcome. I am an AI.' } }) })
        if (m.type === 'user_message') setTimeout(() => s.push({ type: 'agent_response', agent_response_event: { agent_response: 'Let me check that.' } }), 5)
      }))
    })
    expect((await agent.reply(ctx, 'fee?')).texts).toEqual(['Let me check that.'])
    socket.push({ type: 'agent_response', agent_response_event: { agent_response: 'The demo fee is AED 100.' } })
    expect(late).toEqual(['The demo fee is AED 100.'])
  })

  it('a steady stream of pings does not keep a finished turn open', async () => {
    let socket!: FakeSocket
    const agent = createElevenTextAgent({
      getSignedUrl: async () => 'wss://x', settleMs: 30, turnTimeoutMs: 5000,
      createSocket: () => (socket = new FakeSocket((s, m) => {
        if (m.type === 'conversation_initiation_client_data') queueMicrotask(() => { s.push({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'c' } }); s.push({ type: 'agent_response', agent_response_event: { agent_response: 'Welcome.' } }) })
        if (m.type === 'user_message') setTimeout(() => s.push({ type: 'agent_response', agent_response_event: { agent_response: 'Answer.' } }), 5)
      }))
    })
    const ping = setInterval(() => socket?.push({ type: 'ping', ping_event: { event_id: 1 } }), 10)
    const started = Date.now()
    await agent.reply({ ...ctx, firstMessage: 'Welcome.' }, 'hi')
    clearInterval(ping)
    expect(Date.now() - started).toBeLessThan(1500)
  })

  it('answers pings and fails clearly when the agent stays silent', async () => {
    let socket!: FakeSocket
    const agent = createElevenTextAgent({
      getSignedUrl: async () => 'wss://x', settleMs: 20, turnTimeoutMs: 300, openingWaitMs: 50,
      createSocket: () => (socket = new FakeSocket((s, m) => {
        if (m.type === 'conversation_initiation_client_data') queueMicrotask(() => { s.push({ type: 'conversation_initiation_metadata', conversation_initiation_metadata_event: { conversation_id: 'c' } }); s.push({ type: 'ping', ping_event: { event_id: 7 } }) })
      }))
    })
    await expect(agent.reply(ctx, 'hello?')).rejects.toThrow(/did not answer/)
    expect(socket.sent.some((m) => m.type === 'pong' && m.event_id === 7)).toBe(true)
    expect(agent.sessions()).toBe(0)
  })
})
