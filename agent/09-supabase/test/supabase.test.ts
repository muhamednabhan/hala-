import { describe, expect, it } from 'vitest'
import type { HalaEvent } from '@hala/core'
import { createCalendar } from '@hala/booking'
import { createToolApi } from '@hala/tools-api'
import { createSupabaseStores, supabaseReady } from '../src'

/**
 * A small in-memory PostgREST: enough of the API for our adapter (eq filters, order, limit, insert, patch,
 * upsert) plus the two constraints that matter: primary keys and the one-confirmed-booking-per-slot index.
 */
function fakeSupabase(tables = ['hala_bookings', 'hala_requests', 'hala_handovers', 'hala_events', 'hala_idempotency', 'hala_robots', 'hala_robot_commands', 'hala_robot_logs']) {
  const data = new Map<string, Record<string, any>[]>(tables.map((t) => [t, []]))
  const pk: Record<string, string> = { hala_bookings: 'ref', hala_requests: 'ref', hala_handovers: 'id', hala_events: 'id', hala_idempotency: 'key', hala_robots: 'id', hala_robot_commands: 'id', hala_robot_logs: 'id' }
  const calls: { method: string; url: string; auth: string | null }[] = []

  const conflict = (what: string) => new Response(JSON.stringify({ code: '23505', message: 'duplicate key value', details: what }), { status: 409 })
  const slotTaken = (rows: Record<string, any>[], row: Record<string, any>) =>
    row.status === 'confirmed' && rows.some((r) => r.ref !== row.ref && r.status === 'confirmed' && r.date === row.date && r.time === row.time)

  const f = (async (input: any, init: any = {}) => {
    const url = new URL(String(input))
    const method = init.method ?? 'GET'
    calls.push({ method, url: url.pathname + url.search, auth: init.headers?.authorization ?? null })
    const table = url.pathname.split('/').pop()!
    const rows = data.get(table)
    if (!rows) return new Response(JSON.stringify({ message: 'relation does not exist' }), { status: 404 })
    const body = init.body ? JSON.parse(init.body) : undefined
    const matches = (r: Record<string, any>) => [...url.searchParams].every(([k, v]) => !v.startsWith('eq.') || String(r[k]) === v.slice(3))
    // Postgres returns time as HH:MM:SS
    const out = (r: Record<string, any>) => ({ ...r, ...(r.time ? { time: `${r.time}:00` } : {}) })

    if (method === 'GET') {
      let res = rows.filter(matches)
      const order = url.searchParams.get('order')
      if (order) { const [col, dir] = order.split('.'); res = [...res].sort((a, b) => (String(a[col!]) < String(b[col!]) ? -1 : 1) * (dir === 'desc' ? -1 : 1)) }
      const limit = url.searchParams.get('limit')
      if (limit !== null) res = res.slice(0, Number(limit))
      return new Response(JSON.stringify(res.map(out)), { status: 200 })
    }
    if (method === 'POST' && Array.isArray(body)) { rows.push(...body.map((r) => ({ created_at: new Date().toISOString(), ...r }))); return new Response(null, { status: 201 }) }
    if (method === 'POST') {
      const key = pk[table]!
      const idx = rows.findIndex((r) => r[key] === body[key])
      if (url.searchParams.has('on_conflict')) { if (idx >= 0) rows[idx] = { ...rows[idx], ...body }; else rows.push(body); return new Response(null, { status: 201 }) }
      if (idx >= 0) return conflict(`Key (${key})=(${body[key]}) already exists`)
      if (table === 'hala_bookings' && slotTaken(rows, body)) return conflict('Key (date, time) violates hala_bookings_one_per_slot')
      rows.push({ created_at: new Date().toISOString(), ...body })
      return new Response(null, { status: 201 })
    }
    if (method === 'PATCH') {
      for (const r of rows.filter(matches)) {
        const next = { ...r, ...body }
        if (table === 'hala_bookings' && slotTaken(rows, next)) return conflict('Key (date, time) violates hala_bookings_one_per_slot')
        Object.assign(r, body)
      }
      return new Response(null, { status: 204 })
    }
    return new Response('?', { status: 400 })
  }) as typeof fetch

  return { f, data, calls }
}

const opts = (f: typeof fetch) => ({ url: 'https://x.supabase.co', serviceKey: 'service-key', fetch: f })
const clock = { now: () => new Date('2026-11-24T08:00:00Z') }
const base = { serviceId: 'visa_renewal', attendeeName: 'Ahmed Test', contact: '0500000000', language: 'en' as const }

describe('supabase adapter', () => {
  it('books through the calendar and stores snake_case rows with the service key', async () => {
    const { f, data, calls } = fakeSupabase()
    const stores = createSupabaseStores(opts(f))
    const cal = createCalendar({ bookings: stores.bookings, clock })
    const r = await cal.book({ ...base, date: '2026-11-26', time: '10:30', bookedByName: 'Sara' })
    expect(r.ok && r.value.booking.ref).toBe('HALA-1001')
    expect(data.get('hala_bookings')![0]).toMatchObject({ ref: 'HALA-1001', attendee_name: 'Ahmed Test', booked_by_name: 'Sara', time: '10:30', status: 'confirmed' })
    expect(calls.every((c) => c.auth === 'Bearer service-key')).toBe(true)
  })
  it('reads times back as HH:MM even though Postgres returns HH:MM:SS', async () => {
    const stores = createSupabaseStores(opts(fakeSupabase().f))
    const cal = createCalendar({ bookings: stores.bookings, clock })
    await cal.book({ ...base, date: '2026-11-26', time: '10:30' })
    expect((await stores.bookings.listByDate('2026-11-26'))[0]!.time).toBe('10:30')
  })
  it('rejects double booking in the calendar and again in the database', async () => {
    const { f } = fakeSupabase()
    const stores = createSupabaseStores(opts(f))
    const cal = createCalendar({ bookings: stores.bookings, clock })
    await cal.book({ ...base, date: '2026-11-26', time: '10:30' })
    expect(await cal.book({ ...base, attendeeName: 'Other', date: '2026-11-26', time: '10:30' })).toMatchObject({ ok: false, code: 'taken' })
    // Bypass the calendar's own check: the unique index must still refuse, and surface as "taken", not a crash.
    const racing = createCalendar({ bookings: { ...stores.bookings, listByDate: async () => [] }, clock })
    expect(await racing.book({ ...base, attendeeName: 'Racer', date: '2026-11-26', time: '10:30' })).toMatchObject({ ok: false, code: 'taken' })
  })
  it('reschedule, cancel and idempotent retries work', async () => {
    const stores = createSupabaseStores(opts(fakeSupabase().f))
    const cal = createCalendar({ bookings: stores.bookings, clock })
    const input = { ...base, conversationId: 'c1', date: '2026-11-26', time: '10:30' }
    const a = await cal.book(input)
    const b = await cal.book(input)
    expect(a.ok && b.ok && a.value.booking.ref === b.value.booking.ref && b.value.duplicate).toBe(true)
    if (!a.ok) throw new Error('setup')
    expect((await cal.reschedule(a.value.booking.ref, '2026-11-27', '09:00')).ok).toBe(true)
    expect((await stores.bookings.get(a.value.booking.ref))?.date).toBe('2026-11-27')
    const c = await cal.cancel(a.value.booking.ref)
    expect(c.ok && c.value.booking.status).toBe('cancelled')
    expect((await cal.freeSlots('2026-11-27')).some((s) => s.time === '09:00')).toBe(true)
  })
  it('keeps references increasing numerically past 9999', async () => {
    const { f, data } = fakeSupabase()
    data.get('hala_bookings')!.push({ ref: 'HALA-9999', created_at: '2026-01-01T00:00:00Z' }, { ref: 'HALA-10000', created_at: '2026-01-02T00:00:00Z' })
    expect(await createSupabaseStores(opts(f)).bookings.maxSequence()).toBe(10000)
  })
  it('stores handovers, requests and events and can read them back', async () => {
    const stores = createSupabaseStores(opts(fakeSupabase().f))
    const api = createToolApi({ stores, clock, secret: 's' })
    const h = { 'x-hala-secret': 's' }
    await api.handle('handover_to_human', h, { conversation_id: 'c1', reason: 'fee_dispute', summary: 'Fee is wrong', language: 'ar' })
    await api.handle('log_request', h, { conversation_id: 'c1', service_id: 'maintenance', caller_name: 'Sara', contact: '0501234567', details: 'AC broken' })
    const [ho] = await stores.handovers.list()
    expect(ho).toMatchObject({ reason: 'fee_dispute', language: 'ar', status: 'open', conversationId: 'c1' })
    await stores.handovers.update({ ...ho!, status: 'taken' })
    expect((await stores.handovers.list())[0]!.status).toBe('taken')
    expect(await stores.requests.list()).toHaveLength(1)
    const events = await stores.events.history('c1')
    expect(events.map((e) => e.type)).toEqual(['handover_requested', 'request_logged'])
  })
  it('streams events live and survives a failing database on publish', async () => {
    const stores = createSupabaseStores(opts((async () => new Response('boom', { status: 500 })) as typeof fetch))
    const seen: HalaEvent[] = []
    stores.events.subscribe((e) => seen.push(e))
    const e: HalaEvent = { id: '1', ts: '2026-11-24T08:00:00Z', type: 'fact_lookup', data: {} }
    await expect(stores.events.publish(e)).resolves.toBeUndefined()
    expect(seen).toHaveLength(1)
  })
})

describe('supabase robots', () => {
  const robot = { id: 'rb_1', name: 'A', micStream: 0 as const, halfDuplex: false, tokenHash: 'h', desired: 'stopped' as const, createdAt: '2026-11-24T08:00:00Z' }
  it('patches only the given columns, maps names, and null clears', async () => {
    const { f, data } = fakeSupabase()
    const stores = createSupabaseStores(opts(f))
    await stores.robots.create({ ...robot, ip: '10.0.1.41', volume: 30 })
    await stores.robots.patch('rb_1', { desired: 'running', lastSeen: '2026-11-24T09:00:00Z', ip: null, state: { phase: 'idle' } })
    const row = data.get('hala_robots')![0]!
    expect(row).toMatchObject({ desired: 'running', last_seen: '2026-11-24T09:00:00Z', ip: null, state: { phase: 'idle' }, volume: 30, name: 'A' })
    const back = (await stores.robots.get('rb_1'))!
    expect(back).toMatchObject({ desired: 'running', volume: 30, lastSeen: '2026-11-24T09:00:00Z' })
    expect(back.ip).toBeUndefined()
  })
  it('finds a robot by token hash and stores commands and logs', async () => {
    const stores = createSupabaseStores(opts(fakeSupabase().f))
    await stores.robots.create(robot)
    expect((await stores.robots.getByTokenHash('h'))?.id).toBe('rb_1')
    await stores.robots.addCommand({ id: 'cm_1', robotId: 'rb_1', type: 'speaker_test', payload: {}, status: 'pending', createdAt: '2026-11-24T08:00:00Z' })
    expect(await stores.robots.pendingCommands('rb_1')).toHaveLength(1)
    await stores.robots.updateCommand({ id: 'cm_1', robotId: 'rb_1', type: 'speaker_test', payload: {}, status: 'done', result: 'ok', createdAt: '2026-11-24T08:00:00Z', doneAt: '2026-11-24T08:00:02Z' })
    expect(await stores.robots.pendingCommands('rb_1')).toHaveLength(0)
    await stores.robots.addLogs([{ id: 'lg_1', robotId: 'rb_1', ts: '2026-11-24T08:00:03Z', level: 'user', message: 'مرحبا' }])
    expect((await stores.robots.logs('rb_1', 10))[0]!.message).toBe('مرحبا')
  })
})

describe('supabaseReady', () => {
  it('is ok when every table exists', async () => {
    expect(await supabaseReady(opts(fakeSupabase().f))).toEqual({ ok: true })
  })
  it('explains missing tables', async () => {
    const r = await supabaseReady(opts(fakeSupabase(['hala_bookings']).f))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/001_hala_tables\.sql/)
  })
  it('explains a rejected key', async () => {
    const r = await supabaseReady(opts((async () => new Response('{}', { status: 401 })) as typeof fetch))
    expect(r).toEqual({ ok: false, reason: 'the service key was rejected' })
  })
})

describe('conversation scores on hala_events', () => {
  const scored: HalaEvent = {
    id: 's1', ts: '2026-11-24T08:00:00Z', conversationId: 'c1', type: 'conversation_scored', data: { label: 'negative' },
    averageSentiment: -0.9, averageFrustration: 0.9
  }
  const plain = (id: string, conversationId: string): HalaEvent => ({ id, ts: '2026-11-24T08:00:00Z', conversationId, type: 'booking_created', data: {} })

  it('writes the two numbers into average_sentiment and average_frustration, and reads them back as numbers', async () => {
    const { f, data } = fakeSupabase()
    const stores = createSupabaseStores(opts(f))
    await stores.events.publish(scored)
    expect(data.get('hala_events')![0]).toMatchObject({ id: 's1', type: 'conversation_scored', average_sentiment: -0.9, average_frustration: 0.9 })
    const [back] = await stores.events.history('c1')
    expect(back).toMatchObject({ averageSentiment: -0.9, averageFrustration: 0.9 })
  })

  it('leaves the columns out of ordinary events (null), and maps a numeric string from PostgREST', async () => {
    const { f, data } = fakeSupabase()
    const stores = createSupabaseStores(opts(f))
    await stores.events.publish(plain('p1', 'c1'))
    expect(Object.keys(data.get('hala_events')![0]!)).not.toContain('average_sentiment')
    data.get('hala_events')![0]!.average_sentiment = '0.25' // numeric columns can come back as strings
    expect((await stores.events.history('c1'))[0]!.averageSentiment).toBe(0.25)
    expect((await stores.events.history('c1'))[0]!.averageFrustration).toBeUndefined()
  })

  it("annotate puts the scores on one conversation's unscored rows only", async () => {
    const { f, data, calls } = fakeSupabase()
    const stores = createSupabaseStores(opts(f))
    await stores.events.publish(plain('p1', 'c1'))
    await stores.events.publish(plain('p2', 'c2'))
    await stores.events.annotate!('c1', { averageSentiment: -0.3, averageFrustration: 0.2 })
    const rows = data.get('hala_events')!
    expect(rows.find((r) => r.id === 'p1')).toMatchObject({ average_sentiment: -0.3, average_frustration: 0.2 })
    expect(rows.find((r) => r.id === 'p2')!.average_sentiment).toBeUndefined()
    const patch = calls.find((c) => c.method === 'PATCH')!
    expect(patch.url).toContain('conversation_id=eq.c1')
    expect(patch.url).toContain('average_sentiment=is.null') // never overwrites a score that is already there
  })

  it('a database without the two columns still keeps the event (scores stay in data)', async () => {
    const { f, data } = fakeSupabase()
    const noColumns = (async (input: any, init: any = {}) => {
      // like PostgREST: only a TOP-LEVEL column that does not exist is an error (the same key inside the jsonb `data` is fine)
      if ((init.method ?? 'GET') === 'POST' && init.body && 'average_sentiment' in JSON.parse(init.body)) {
        return new Response(JSON.stringify({ code: 'PGRST204', message: "Could not find the 'average_sentiment' column" }), { status: 400 })
      }
      return f(input, init)
    }) as typeof fetch
    const stores = createSupabaseStores(opts(noColumns))
    await stores.events.publish({ ...scored, data: { ...scored.data, average_sentiment: -0.9 } })
    const row = data.get('hala_events')![0]!
    expect(row).toMatchObject({ id: 's1', type: 'conversation_scored' })
    expect(row.average_sentiment).toBeUndefined()
    expect(row.data.average_sentiment).toBe(-0.9)
  })
})
