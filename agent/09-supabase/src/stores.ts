import {
  SlotConflictError,
  type Booking, type EventBus, type HalaEvent, type Handover, type Lang, type ServiceRequest, type Stores
} from '@hala/core'

/**
 * Supabase (PostgREST) implementation of the storage ports in @hala/core.
 * Plain fetch, no client library: nothing to install and trivial to test with a fake fetch.
 * Needs the hala_* tables from migrations/001_hala_tables.sql. Uses the service-role key, server side only.
 */
export interface SupabaseOptions {
  url: string
  serviceKey: string
  fetch?: typeof fetch
}

type Row = Record<string, unknown>

class Rest {
  private readonly base: string
  private readonly f: typeof fetch
  constructor(private readonly o: SupabaseOptions) {
    this.base = `${o.url.replace(/\/$/, '')}/rest/v1`
    this.f = o.fetch ?? fetch
  }

  async call(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<{ status: number; data: any }> {
    const res = await this.f(`${this.base}/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        apikey: this.o.serviceKey,
        authorization: `Bearer ${this.o.serviceKey}`,
        'content-type': 'application/json',
        ...(init.prefer ? { prefer: init.prefer } : {})
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    })
    const text = await res.text()
    let data: any
    try { data = text ? JSON.parse(text) : undefined } catch { data = text }
    if (!res.ok) {
      const message = typeof data === 'object' && data ? String(data.message ?? data.details ?? res.status) : String(data ?? res.status)
      const err = Object.assign(new Error(`supabase ${res.status}: ${message}`), { status: res.status, code: data?.code, detail: JSON.stringify(data ?? '') })
      throw err
    }
    return { status: res.status, data }
  }

  select = async (table: string, query = ''): Promise<Row[]> => (await this.call(`${table}?${query}`)).data ?? []
  insert = async (table: string, row: Row) => { await this.call(table, { method: 'POST', body: row, prefer: 'return=minimal' }) }
  upsert = async (table: string, row: Row, onConflict: string) => {
    await this.call(`${table}?on_conflict=${onConflict}`, { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=minimal' })
  }
  patch = async (table: string, filter: string, row: Row) => { await this.call(`${table}?${filter}`, { method: 'PATCH', body: row, prefer: 'return=minimal' }) }
}

const isSlotConflict = (e: unknown) =>
  (e as { code?: string }).code === '23505' && /hala_bookings_one_per_slot/.test((e as { detail?: string }).detail ?? '')

const hhmm = (t: unknown) => String(t).slice(0, 5)
const optional = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v)
const enc = encodeURIComponent

// ---------------------------------------------------------------- row mapping

const bookingRow = (b: Booking): Row => ({
  ref: b.ref, service_id: b.serviceId, attendee_name: b.attendeeName, booked_by_name: b.bookedByName ?? null, contact: b.contact,
  date: b.date, time: b.time, language: b.language, conversation_id: b.conversationId ?? null, status: b.status,
  created_at: b.createdAt, updated_at: b.updatedAt
})
const toBooking = (r: Row): Booking => ({
  ref: String(r.ref), serviceId: String(r.service_id), attendeeName: String(r.attendee_name), bookedByName: optional(r.booked_by_name as string),
  contact: String(r.contact), date: String(r.date), time: hhmm(r.time), language: r.language as Lang,
  conversationId: optional(r.conversation_id as string), status: r.status as Booking['status'],
  createdAt: String(r.created_at), updatedAt: String(r.updated_at)
})

const requestRow = (r: ServiceRequest): Row => ({
  ref: r.ref, service_id: r.serviceId, caller_name: r.callerName, contact: r.contact, details: r.details, location: r.location ?? null,
  language: r.language, conversation_id: r.conversationId ?? null, created_at: r.createdAt
})
const toRequest = (r: Row): ServiceRequest => ({
  ref: String(r.ref), serviceId: String(r.service_id), callerName: String(r.caller_name), contact: String(r.contact), details: String(r.details),
  location: optional(r.location as string), language: r.language as Lang, conversationId: optional(r.conversation_id as string), createdAt: String(r.created_at)
})

const handoverRow = (h: Handover): Row => ({
  id: h.id, reason: h.reason, language: h.language, summary: h.summary, caller_name: h.callerName ?? null, contact: h.contact ?? null,
  conversation_id: h.conversationId ?? null, status: h.status, created_at: h.createdAt
})
const toHandover = (r: Row): Handover => ({
  id: String(r.id), reason: r.reason as Handover['reason'], language: r.language as Lang, summary: String(r.summary),
  callerName: optional(r.caller_name as string), contact: optional(r.contact as string), conversationId: optional(r.conversation_id as string),
  status: r.status as Handover['status'], createdAt: String(r.created_at)
})

const toEvent = (r: Row): HalaEvent => ({
  id: String(r.id), ts: String(r.ts), conversationId: optional(r.conversation_id as string), type: r.type as HalaEvent['type'], data: (r.data ?? {}) as Record<string, unknown>
})

const seq = (rows: Row[]) => Math.max(1000, ...rows.map((r) => Number(/(\d+)$/.exec(String(r.ref))?.[1] ?? 0)))

// ---------------------------------------------------------------- stores

export function createSupabaseStores(o: SupabaseOptions): Stores {
  const db = new Rest(o)
  const listeners = new Set<{ fn: (e: HalaEvent) => void; conversationId?: string }>()

  const keyRepo = (kind: 'booking' | 'request') => ({
    findKey: async (key: string) => (await db.select('hala_idempotency', `select=ref&key=eq.${enc(key)}&kind=eq.${kind}&limit=1`))[0]?.ref as string | undefined,
    saveKey: (key: string, ref: string) => db.upsert('hala_idempotency', { key, kind, ref }, 'key')
  })
  const bookingKeys = keyRepo('booking')
  const requestKeys = keyRepo('request')

  const bookings = {
    create: async (b: Booking) => {
      try { await db.insert('hala_bookings', bookingRow(b)) } catch (e) { throw isSlotConflict(e) ? new SlotConflictError() : e }
    },
    get: async (ref: string) => { const r = (await db.select('hala_bookings', `ref=eq.${enc(ref)}&limit=1`))[0]; return r ? toBooking(r) : undefined },
    update: async (b: Booking) => {
      try { await db.patch('hala_bookings', `ref=eq.${enc(b.ref)}`, bookingRow(b)) } catch (e) { throw isSlotConflict(e) ? new SlotConflictError() : e }
    },
    listByDate: async (date: string) => (await db.select('hala_bookings', `date=eq.${enc(date)}&status=eq.confirmed&order=time.asc`)).map(toBooking),
    list: async () => (await db.select('hala_bookings', 'order=created_at.asc&limit=1000')).map(toBooking),
    maxSequence: async () => seq(await db.select('hala_bookings', 'select=ref&order=created_at.desc&limit=100')),
    findByKey: async (key: string) => { const ref = await bookingKeys.findKey(key); return ref ? bookings.get(ref) : undefined },
    saveKey: bookingKeys.saveKey
  }

  const requests = {
    create: (r: ServiceRequest) => db.insert('hala_requests', requestRow(r)),
    get: async (ref: string) => { const r = (await db.select('hala_requests', `ref=eq.${enc(ref)}&limit=1`))[0]; return r ? toRequest(r) : undefined },
    list: async () => (await db.select('hala_requests', 'order=created_at.asc&limit=1000')).map(toRequest),
    maxSequence: async () => seq(await db.select('hala_requests', 'select=ref&order=created_at.desc&limit=100')),
    findByKey: async (key: string) => { const ref = await requestKeys.findKey(key); return ref ? requests.get(ref) : undefined },
    saveKey: requestKeys.saveKey
  }

  const handovers = {
    create: (h: Handover) => db.insert('hala_handovers', handoverRow(h)),
    update: (h: Handover) => db.patch('hala_handovers', `id=eq.${enc(h.id)}`, handoverRow(h)),
    list: async () => (await db.select('hala_handovers', 'order=created_at.asc&limit=1000')).map(toHandover)
  }

  const events: EventBus = {
    // Listeners are told immediately (the live screen must not wait on the database); persistence is best effort.
    async publish(e) {
      for (const l of listeners) {
        if (l.conversationId && l.conversationId !== e.conversationId) continue
        try { l.fn(e) } catch { /* a broken listener must never break a tool call */ }
      }
      try {
        await db.insert('hala_events', { id: e.id, ts: e.ts, conversation_id: e.conversationId ?? null, type: e.type, data: e.data })
      } catch (err) { console.warn('hala: could not persist event:', (err as Error).message) }
    },
    history: async (conversationId) => {
      const filter = conversationId ? `conversation_id=eq.${enc(conversationId)}&` : ''
      const rows = await db.select('hala_events', `${filter}order=ts.desc&limit=500`)
      return rows.map(toEvent).reverse()
    },
    subscribe(fn, conversationId) {
      const entry = { fn, conversationId }
      listeners.add(entry)
      return () => { listeners.delete(entry) }
    }
  }

  return { bookings, requests, handovers, events }
}

/** True when the hala_* tables exist and the key works. Used to choose between Supabase and the local file. */
export async function supabaseReady(o: SupabaseOptions): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = new Rest(o)
  try {
    for (const t of ['hala_bookings', 'hala_requests', 'hala_handovers', 'hala_events', 'hala_idempotency']) await db.select(t, 'limit=0')
    return { ok: true }
  } catch (e) {
    const status = (e as { status?: number }).status
    const reason = status === 404 ? 'tables are missing: run agent/09-supabase/migrations/001_hala_tables.sql in the Supabase SQL editor'
      : status === 401 || status === 403 ? 'the service key was rejected' : (e as Error).message
    return { ok: false, reason }
  }
}
