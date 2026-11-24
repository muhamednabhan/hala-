import { describe, expect, it } from 'vitest'
import { createPhoneStore, createSupabasePhoneStore, phoneTablesReady, type PhoneStore } from '../src'

const PHONE = '+971501234567'

/** A tiny in-memory PostgREST: eq./gt. filters, order, limit, insert, upsert, patch. Enough to run the real adapter. */
function fakePostgrest(missingTables = false): typeof fetch {
  const tables = new Map<string, Record<string, any>[]>()
  let seq = 0
  const rows = (t: string) => tables.get(t) ?? tables.set(t, []).get(t)!
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    const table = url.pathname.split('/').pop()!
    const method = init?.method ?? 'GET'
    if (missingTables) return new Response(JSON.stringify({ message: 'not found' }), { status: 404 })
    const body = init?.body ? JSON.parse(String(init.body)) : undefined
    const match = (r: Record<string, any>) => [...url.searchParams].every(([k, v]) => {
      if (['select', 'order', 'limit', 'on_conflict'].includes(k)) return true
      const [op, ...rest] = v.split('.'); const val = rest.join('.')
      if (op === 'eq') return String(r[k]) === val
      if (op === 'gt') return Number(r[k]) > Number(val)
      return true
    })
    const withSeq = (r: Record<string, any>) => (table === 'hala_phone_messages' || table === 'hala_phone_rings' ? { ...r, seq: ++seq } : r)
    const json = (data: unknown, status = 200) => new Response(data === undefined ? '' : JSON.stringify(data), { status })
    if (method === 'GET') {
      let out = rows(table).filter(match)
      const order = url.searchParams.get('order')
      if (order) { const [col, dir] = order.split('.'); out = [...out].sort((a, b) => (dir === 'desc' ? -1 : 1) * (a[col!] > b[col!] ? 1 : -1)) }
      const limit = Number(url.searchParams.get('limit') ?? 1e9)
      return json(out.slice(0, limit))
    }
    if (method === 'POST') {
      const conflict = url.searchParams.get('on_conflict')
      if (conflict) {
        const i = rows(table).findIndex((r) => r[conflict] === body[conflict])
        if (i >= 0) { rows(table)[i] = { ...rows(table)[i], ...body } } else { rows(table).push(body) }
        return json(undefined, 201)
      }
      const row = withSeq(body)
      rows(table).push(row)
      return json([row], 201)
    }
    if (method === 'PATCH') {
      const hit = rows(table).filter(match)
      hit.forEach((r) => Object.assign(r, body))
      return json(hit)
    }
    return json(undefined, 405)
  }) as unknown as typeof fetch
}

const adapters: [string, () => PhoneStore][] = [
  ['file/in-memory adapter', () => createPhoneStore()],
  ['Supabase adapter (fake PostgREST)', () => createSupabasePhoneStore({ url: 'https://x.supabase.co', serviceKey: 'k', fetch: fakePostgrest() })]
]

describe.each(adapters)('PhoneStore contract: %s', (_name, make) => {
  it('issues, links and looks up codes the same way', async () => {
    const store = make()
    const { code } = await store.issueCode({ conversationId: 'robot1' })
    expect((await store.getCode(code))?.conversationId).toBe('robot1')
    const linked = await store.linkCode(code, PHONE)
    expect(linked.ok).toBe(true)
    expect(await store.linkCode(code, '+971509999999')).toEqual({ ok: false, reason: 'used' })
    expect(await store.linkCode('NOPE22', PHONE)).toEqual({ ok: false, reason: 'unknown' })
    expect((await store.contactByCode(code))?.phone).toBe(PHONE)
    expect((await store.contactByPhone(PHONE))?.codes).toEqual([code])
  })

  it('keeps names and language on a contact', async () => {
    const store = make()
    await store.touchContact(PHONE, { name: 'Sara', language: 'ar' })
    await store.touchContact(PHONE, { language: 'en' })
    expect(await store.contactByPhone(PHONE)).toMatchObject({ name: 'Sara', language: 'en' })
  })

  it('serves messages after a cursor, per phone, in order', async () => {
    const store = make()
    const a = await store.addMessage({ phone: PHONE, from: 'user', kind: 'text', text: 'hi' })
    await store.addMessage({ phone: '+971500000000', from: 'user', kind: 'text', text: 'other' })
    const b = await store.addMessage({ phone: PHONE, from: 'agent', kind: 'voice', text: 'hello', audioUrl: '/api/phone/audio/x', durationSec: 3 })
    expect((await store.messagesFor(PHONE)).map((m) => m.text)).toEqual(['hi', 'hello'])
    expect((await store.messagesFor(PHONE, a.seq))).toEqual([expect.objectContaining({ id: b.id, kind: 'voice', audioUrl: '/api/phone/audio/x', durationSec: 3 })])
    expect(await store.currentSeq()).toBeGreaterThanOrEqual(b.seq)
  })

  it('queues a ring once per nudge key and tracks its status', async () => {
    const store = make()
    const ring = await store.addRing({ phone: PHONE, reason: 'r', opening: 'Hi, AI', language: 'en', kind: 'appointment_reminder', nudgeKey: 'k1' })
    expect(ring.status).toBe('pending')
    expect(await store.hasNudged('k1')).toBe(true)
    expect(await store.hasNudged('k2')).toBe(false)
    expect((await store.setRingStatus(ring.id, 'answered'))?.status).toBe('answered')
    expect((await store.ringsFor(PHONE))[0]?.status).toBe('answered')
    expect((await store.getRing(ring.id))?.id).toBe(ring.id)
  })

  it('maps conversations to phones', async () => {
    const store = make()
    await store.bindConversation('c1', PHONE)
    expect(await store.phoneForConversation('c1')).toBe(PHONE)
    expect(await store.phoneForConversation('zzz')).toBeUndefined()
  })
})

describe('phoneTablesReady', () => {
  it('says what to run when the tables are missing', async () => {
    const r = await phoneTablesReady({ url: 'https://x.supabase.co', serviceKey: 'k', fetch: fakePostgrest(true) })
    expect(r).toMatchObject({ ok: false })
    expect((r as { reason: string }).reason).toMatch(/002_hala_phone_tables/)
  })
  it('is ok when they exist', async () => {
    expect(await phoneTablesReady({ url: 'https://x.supabase.co', serviceKey: 'k', fetch: fakePostgrest() })).toEqual({ ok: true })
  })
})
