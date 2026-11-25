import {
  SlotConflictError,
  type Booking, type EventBus, type HalaEvent, type Handover, type Lang, type Robot, type RobotCommand, type RobotLog, type RobotPatch, type RobotRepo,
  type ServiceRequest, type Stores
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

// numeric columns come back from PostgREST as numbers (or null when no score was written yet)
const score = (v: unknown): number | undefined => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v))

const toEvent = (r: Row): HalaEvent => ({
  id: String(r.id), ts: String(r.ts), conversationId: optional(r.conversation_id as string), type: r.type as HalaEvent['type'], data: (r.data ?? {}) as Record<string, unknown>,
  ...(score(r.average_sentiment) !== undefined ? { averageSentiment: score(r.average_sentiment) } : {}),
  ...(score(r.average_frustration) !== undefined ? { averageFrustration: score(r.average_frustration) } : {})
})

const robotRow = (r: Robot): Row => ({
  id: r.id, name: r.name, notes: r.notes ?? null, ip: r.ip ?? null, domain_id: r.domainId ?? null, aimdk_path: r.aimdkPath ?? null,
  mic_stream: r.micStream, half_duplex: r.halfDuplex, volume: r.volume ?? null, token_hash: r.tokenHash, desired: r.desired,
  last_seen: r.lastSeen ?? null, bridge_version: r.bridgeVersion ?? null, state: r.state ?? null, created_at: r.createdAt
})
const ROBOT_COLUMNS: Record<string, string> = {
  name: 'name', notes: 'notes', ip: 'ip', domainId: 'domain_id', aimdkPath: 'aimdk_path', micStream: 'mic_stream', halfDuplex: 'half_duplex',
  volume: 'volume', tokenHash: 'token_hash', desired: 'desired', lastSeen: 'last_seen', bridgeVersion: 'bridge_version', state: 'state'
}
/** Only the fields that changed, as columns. `null` clears. */
const robotPatchRow = (f: RobotPatch): Row =>
  Object.fromEntries(Object.entries(f).filter(([k, v]) => v !== undefined && ROBOT_COLUMNS[k]).map(([k, v]) => [ROBOT_COLUMNS[k]!, v]))
const toRobot = (r: Row): Robot => ({
  id: String(r.id), name: String(r.name), notes: optional(r.notes as string), ip: optional(r.ip as string), domainId: optional(r.domain_id as number),
  aimdkPath: optional(r.aimdk_path as string), micStream: Number(r.mic_stream ?? 0) as Robot['micStream'], halfDuplex: Boolean(r.half_duplex),
  volume: optional(r.volume as number), tokenHash: String(r.token_hash), desired: r.desired as Robot['desired'], lastSeen: optional(r.last_seen as string),
  bridgeVersion: optional(r.bridge_version as string), state: optional(r.state as Robot['state']), createdAt: String(r.created_at)
})
const toCommand = (r: Row): RobotCommand => ({
  id: String(r.id), robotId: String(r.robot_id), type: r.type as RobotCommand['type'], payload: (r.payload ?? {}) as Record<string, unknown>,
  status: r.status as RobotCommand['status'], result: optional(r.result as string), createdAt: String(r.created_at), doneAt: optional(r.done_at as string)
})
const commandRow = (c: RobotCommand): Row => ({
  id: c.id, robot_id: c.robotId, type: c.type, payload: c.payload, status: c.status, result: c.result ?? null, created_at: c.createdAt, done_at: c.doneAt ?? null
})
const toLog = (r: Row): RobotLog => ({ id: String(r.id), robotId: String(r.robot_id), ts: String(r.ts), level: r.level as RobotLog['level'], message: String(r.message) })

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
      const row: Row = { id: e.id, ts: e.ts, conversation_id: e.conversationId ?? null, type: e.type, data: e.data }
      const scored: Row = {
        ...(e.averageSentiment !== undefined ? { average_sentiment: e.averageSentiment } : {}),
        ...(e.averageFrustration !== undefined ? { average_frustration: e.averageFrustration } : {})
      }
      try {
        await db.insert('hala_events', { ...row, ...scored })
      } catch (err) {
        // A database without the two score columns must not lose the event: the scores also travel inside `data`.
        if (Object.keys(scored).length) {
          try { await db.insert('hala_events', row); return } catch { /* reported below */ }
        }
        console.warn('hala: could not persist event:', (err as Error).message)
      }
    },
    // Put the conversation's scores on its rows that have none yet (the scored row itself already has them).
    async annotate(conversationId, scores) {
      await db.patch('hala_events', `conversation_id=eq.${enc(conversationId)}&average_sentiment=is.null`, {
        average_sentiment: scores.averageSentiment, average_frustration: scores.averageFrustration
      })
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

  const robots: RobotRepo = {
    create: (r) => db.insert('hala_robots', robotRow(r)),
    get: async (id) => { const r = (await db.select('hala_robots', `id=eq.${enc(id)}&limit=1`))[0]; return r ? toRobot(r) : undefined },
    getByTokenHash: async (hash) => { const r = (await db.select('hala_robots', `token_hash=eq.${enc(hash)}&limit=1`))[0]; return r ? toRobot(r) : undefined },
    list: async () => (await db.select('hala_robots', 'order=created_at.asc&limit=200')).map(toRobot),
    patch: async (id, fields) => { const row = robotPatchRow(fields); if (Object.keys(row).length) await db.patch('hala_robots', `id=eq.${enc(id)}`, row) },
    delete: async (id) => { await db.call(`hala_robots?id=eq.${enc(id)}`, { method: 'DELETE', prefer: 'return=minimal' }) },
    addCommand: (c) => db.insert('hala_robot_commands', commandRow(c)),
    pendingCommands: async (robotId) => (await db.select('hala_robot_commands', `robot_id=eq.${enc(robotId)}&status=eq.pending&order=created_at.asc&limit=20`)).map(toCommand),
    recentCommands: async (robotId, limit) => (await db.select('hala_robot_commands', `robot_id=eq.${enc(robotId)}&order=created_at.desc&limit=${limit}`)).map(toCommand).reverse(),
    updateCommand: (c) => db.patch('hala_robot_commands', `id=eq.${enc(c.id)}`, commandRow(c)),
    addLogs: async (logs) => {
      if (logs.length) await db.call('hala_robot_logs', { method: 'POST', body: logs.map((l) => ({ id: l.id, robot_id: l.robotId, ts: l.ts, level: l.level, message: l.message })), prefer: 'return=minimal' })
    },
    logs: async (robotId, limit) => (await db.select('hala_robot_logs', `robot_id=eq.${enc(robotId)}&order=ts.desc&limit=${limit}`)).map(toLog).reverse()
  }

  return { bookings, requests, handovers, events, robots }
}

/** Do the robot tables (migration 002) exist? Checked separately so bookings keep working without them. */
export async function robotTablesReady(o: SupabaseOptions): Promise<boolean> {
  const db = new Rest(o)
  try {
    await Promise.all(['hala_robots', 'hala_robot_commands', 'hala_robot_logs'].map((t) => db.select(t, 'limit=0')))
    return true
  } catch { return false }
}

/** True when the hala_* tables exist and the key works. Used to choose between Supabase and the local file. */
export async function supabaseReady(o: SupabaseOptions): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = new Rest(o)
  try {
    await Promise.all(['hala_bookings', 'hala_requests', 'hala_handovers', 'hala_events', 'hala_idempotency'].map((t) => db.select(t, 'limit=0')))
    return { ok: true }
  } catch (e) {
    const status = (e as { status?: number }).status
    const reason = status === 404 ? 'tables are missing: run agent/09-supabase/migrations/001_hala_tables.sql in the Supabase SQL editor'
      : status === 401 || status === 403 ? 'the service key was rejected' : (e as Error).message
    return { ok: false, reason }
  }
}
