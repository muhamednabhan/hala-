import { randomUUID } from 'node:crypto'
import type { Lang } from '@hala/core'
import { generateCode } from './codes'
import type { PhoneStore } from './store'
import type { CodeRecord, Contact, PhoneMessage, Ring, RingStatus } from './types'

/**
 * Supabase (PostgREST) implementation of PhoneStore. Plain fetch like the booking adapter, so there is
 * nothing to install and it is easy to fake in tests. Needs migrations/002_hala_phone_tables.sql.
 * Service-role key, server side only.
 */
export interface SupabasePhoneOptions {
  url: string
  serviceKey: string
  fetch?: typeof fetch
  now?: () => Date
}

type Row = Record<string, any>

const CODE_TTL_MS = 24 * 60 * 60 * 1000
const enc = encodeURIComponent
const opt = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v)

export const PHONE_TABLES = ['hala_phone_codes', 'hala_phone_contacts', 'hala_phone_messages', 'hala_phone_rings', 'hala_phone_conversations']

class Rest {
  private readonly base: string
  private readonly f: typeof fetch
  constructor(private readonly o: SupabasePhoneOptions) {
    this.base = `${o.url.replace(/\/$/, '')}/rest/v1`
    this.f = o.fetch ?? fetch
  }
  async call(path: string, init: { method?: string; body?: unknown; prefer?: string } = {}): Promise<any> {
    const res = await this.f(`${this.base}/${path}`, {
      method: init.method ?? 'GET',
      headers: {
        apikey: this.o.serviceKey, authorization: `Bearer ${this.o.serviceKey}`, 'content-type': 'application/json',
        ...(init.prefer ? { prefer: init.prefer } : {})
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    })
    const text = await res.text()
    let data: any
    try { data = text ? JSON.parse(text) : undefined } catch { data = text }
    if (!res.ok) throw Object.assign(new Error(`supabase ${res.status}: ${typeof data === 'object' && data ? (data.message ?? res.status) : data}`), { status: res.status })
    return data
  }
  select = async (table: string, query = ''): Promise<Row[]> => (await this.call(`${table}?${query}`)) ?? []
  insert = async (table: string, row: Row): Promise<Row> => (await this.call(table, { method: 'POST', body: row, prefer: 'return=representation' }))?.[0]
  upsert = async (table: string, row: Row, onConflict: string) => { await this.call(`${table}?on_conflict=${onConflict}`, { method: 'POST', body: row, prefer: 'resolution=merge-duplicates,return=minimal' }) }
  patch = async (table: string, filter: string, row: Row): Promise<Row | undefined> => (await this.call(`${table}?${filter}`, { method: 'PATCH', body: row, prefer: 'return=representation' }))?.[0]
}

const toCode = (r: Row): CodeRecord => ({
  code: r.code, createdAt: r.created_at, phone: opt(r.phone), linkedAt: opt(r.linked_at), conversationId: opt(r.conversation_id)
})
const toContact = (r: Row): Contact => ({
  phone: r.phone, name: opt(r.name), language: r.language as Lang, codes: r.codes ?? [], firstSeenAt: r.first_seen_at, lastSeenAt: r.last_seen_at
})
const toMessage = (r: Row): PhoneMessage => ({
  id: r.id, seq: Number(r.seq), phone: r.phone, from: r.from_who, kind: r.kind, text: r.text, audioUrl: opt(r.audio_url), durationSec: opt(r.duration_sec), ts: r.ts
})
const toRing = (r: Row): Ring => ({
  id: r.id, seq: Number(r.seq), phone: r.phone, reason: r.reason, opening: r.opening, language: r.language as Lang,
  kind: r.kind, nudgeKey: opt(r.nudge_key), status: r.status as RingStatus, createdAt: r.created_at
})

/** Are the tables there? Same idea as supabaseReady() for the booking tables. */
export async function phoneTablesReady(o: SupabasePhoneOptions): Promise<{ ok: true } | { ok: false; reason: string }> {
  const db = new Rest(o)
  try {
    for (const t of PHONE_TABLES) await db.select(t, 'limit=0')
    return { ok: true }
  } catch (e) {
    const status = (e as { status?: number }).status
    return { ok: false, reason: status === 404 ? 'tables are missing: run agent/11-phone/migrations/002_hala_phone_tables.sql in the Supabase SQL editor' : status === 401 || status === 403 ? 'the service key was rejected' : (e as Error).message }
  }
}

export function createSupabasePhoneStore(o: SupabasePhoneOptions): PhoneStore {
  const db = new Rest(o)
  const now = o.now ?? (() => new Date())
  const one = async (table: string, filter: string) => (await db.select(table, `${filter}&limit=1`))[0]

  const upsertContact = async (phone: string, patch: { name?: string; language?: Lang } = {}): Promise<Contact> => {
    const ts = now().toISOString()
    const existing = await one('hala_phone_contacts', `phone=eq.${enc(phone)}`)
    const row = {
      phone, name: patch.name ?? existing?.name ?? null, language: patch.language ?? existing?.language ?? 'en',
      codes: existing?.codes ?? [], first_seen_at: existing?.first_seen_at ?? ts, last_seen_at: ts
    }
    await db.upsert('hala_phone_contacts', row, 'phone')
    return toContact(row)
  }

  return {
    async issueCode(opts) {
      let code = ''
      for (let i = 0; i < 5; i++) {
        code = generateCode()
        if (!(await one('hala_phone_codes', `code=eq.${code}`))) break
      }
      const row = await db.insert('hala_phone_codes', { code, created_at: now().toISOString(), conversation_id: opts?.conversationId ?? null })
      return toCode(row)
    },

    async getCode(code) {
      const r = await one('hala_phone_codes', `code=eq.${enc(code)}`)
      return r ? toCode(r) : undefined
    },

    async linkCode(code, phone) {
      const r = await one('hala_phone_codes', `code=eq.${enc(code)}`)
      if (!r) return { ok: false, reason: 'unknown' }
      if (r.phone && r.phone !== phone) return { ok: false, reason: 'used' }
      if (!r.phone && now().getTime() - Date.parse(r.created_at) > CODE_TTL_MS) return { ok: false, reason: 'expired' }
      const linkedAt = r.linked_at ?? now().toISOString()
      await db.patch('hala_phone_codes', `code=eq.${enc(code)}`, { phone, linked_at: linkedAt })
      const contact = await upsertContact(phone)
      if (!contact.codes.includes(code)) {
        contact.codes.push(code)
        await db.patch('hala_phone_contacts', `phone=eq.${enc(phone)}`, { codes: contact.codes })
      }
      return { ok: true, contact, record: toCode({ ...r, phone, linked_at: linkedAt }) }
    },

    async contactByPhone(phone) {
      const r = await one('hala_phone_contacts', `phone=eq.${enc(phone)}`)
      return r ? toContact(r) : undefined
    },

    async contactByCode(code) {
      const c = await one('hala_phone_codes', `code=eq.${enc(code)}`)
      if (!c?.phone) return undefined
      const r = await one('hala_phone_contacts', `phone=eq.${enc(c.phone)}`)
      return r ? toContact(r) : undefined
    },

    touchContact: (phone, patch) => upsertContact(phone, patch),

    async listContacts() { return (await db.select('hala_phone_contacts', 'order=last_seen_at.desc&limit=500')).map(toContact) },

    async addMessage(m) {
      const row = await db.insert('hala_phone_messages', {
        id: randomUUID(), phone: m.phone, from_who: m.from, kind: m.kind, text: m.text,
        audio_url: m.audioUrl ?? null, duration_sec: m.durationSec ?? null, ts: m.ts ?? now().toISOString()
      })
      return toMessage(row)
    },

    async messagesFor(phone, afterSeq = 0) {
      return (await db.select('hala_phone_messages', `phone=eq.${enc(phone)}&seq=gt.${afterSeq}&order=seq.asc&limit=500`)).map(toMessage)
    },

    async addRing(r) {
      const row = await db.insert('hala_phone_rings', {
        id: `ring-${randomUUID().slice(0, 8)}`, phone: r.phone, reason: r.reason, opening: r.opening, language: r.language,
        kind: r.kind, nudge_key: r.nudgeKey ?? null, status: 'pending', created_at: now().toISOString()
      })
      return toRing(row)
    },

    async ringsFor(phone, afterSeq = 0) {
      return (await db.select('hala_phone_rings', `phone=eq.${enc(phone)}&seq=gt.${afterSeq}&order=seq.asc&limit=100`)).map(toRing)
    },

    async getRing(id) {
      const r = await one('hala_phone_rings', `id=eq.${enc(id)}`)
      return r ? toRing(r) : undefined
    },

    async setRingStatus(id, status) {
      const r = await db.patch('hala_phone_rings', `id=eq.${enc(id)}`, { status })
      return r ? toRing(r) : undefined
    },

    async hasNudged(key) { return Boolean(await one('hala_phone_rings', `nudge_key=eq.${enc(key)}`)) },

    async bindConversation(conversationId, phone) {
      await db.upsert('hala_phone_conversations', { conversation_id: conversationId, phone, created_at: now().toISOString() }, 'conversation_id')
    },

    async phoneForConversation(conversationId) {
      return (await one('hala_phone_conversations', `conversation_id=eq.${enc(conversationId)}`))?.phone ?? undefined
    },

    async currentSeq() {
      const [m, r] = await Promise.all([
        db.select('hala_phone_messages', 'select=seq&order=seq.desc&limit=1'),
        db.select('hala_phone_rings', 'select=seq&order=seq.desc&limit=1')
      ])
      return Math.max(Number(m[0]?.seq ?? 0), Number(r[0]?.seq ?? 0))
    }
  }
}
