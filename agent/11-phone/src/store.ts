import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Lang } from '@hala/core'
import { generateCode } from './codes'
import type { CodeRecord, Contact, PhoneMessage, PhoneSnapshot, Ring, RingStatus } from './types'

/**
 * Phone-side storage: link codes, who each phone is, the SMS threads and the pending calls.
 *
 * Same idea as the booking stores: one small interface, a JSON-file adapter today, and a Supabase
 * adapter later (tables: phone_codes, phone_contacts, phone_messages, phone_rings). The agent code
 * only ever sees `PhoneStore`, and every method is async so a network adapter drops in.
 */
export interface PhoneStore {
  issueCode(opts?: { conversationId?: string }): Promise<CodeRecord>
  getCode(code: string): Promise<CodeRecord | undefined>
  /** Links a phone to a code. Fails if the code is unknown, expired, or already used by another phone. */
  linkCode(code: string, phone: string): Promise<{ ok: true; contact: Contact; record: CodeRecord } | { ok: false; reason: 'unknown' | 'expired' | 'used' }>
  contactByPhone(phone: string): Promise<Contact | undefined>
  contactByCode(code: string): Promise<Contact | undefined>
  touchContact(phone: string, patch?: { name?: string; language?: Lang }): Promise<Contact>
  listContacts(): Promise<Contact[]>

  addMessage(m: Omit<PhoneMessage, 'id' | 'seq' | 'ts'> & { ts?: string }): Promise<PhoneMessage>
  messagesFor(phone: string, afterSeq?: number): Promise<PhoneMessage[]>

  addRing(r: Omit<Ring, 'id' | 'seq' | 'createdAt' | 'status'>): Promise<Ring>
  ringsFor(phone: string, afterSeq?: number): Promise<Ring[]>
  getRing(id: string): Promise<Ring | undefined>
  setRingStatus(id: string, status: RingStatus): Promise<Ring | undefined>
  hasNudged(key: string): Promise<boolean>

  bindConversation(conversationId: string, phone: string): Promise<void>
  phoneForConversation(conversationId: string): Promise<string | undefined>
  currentSeq(): Promise<number>
}

const CODE_TTL_MS = 24 * 60 * 60 * 1000
const MAX_MESSAGES = 2000
const MAX_RINGS = 200

const empty = (): PhoneSnapshot => ({ seq: 0, codes: {}, contacts: {}, messages: [], rings: [], conversations: {}, nudged: {} })

function load(file?: string): PhoneSnapshot {
  if (!file || !existsSync(file)) return empty()
  try { return { ...empty(), ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<PhoneSnapshot>) } } catch { return empty() }
}

export function createPhoneStore(opts: { file?: string; now?: () => Date } = {}): PhoneStore {
  const now = opts.now ?? (() => new Date())
  const state = load(opts.file)

  const save = () => {
    if (!opts.file) return
    mkdirSync(dirname(opts.file), { recursive: true })
    const tmp = `${opts.file}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, opts.file)
  }
  const nextSeq = () => ++state.seq

  const upsertContact = (phone: string, patch: { name?: string; language?: Lang } = {}): Contact => {
    const ts = now().toISOString()
    const existing = state.contacts[phone]
    const contact: Contact = existing ?? { phone, language: 'en', codes: [], firstSeenAt: ts, lastSeenAt: ts }
    if (patch.name) contact.name = patch.name
    if (patch.language) contact.language = patch.language
    contact.lastSeenAt = ts
    state.contacts[phone] = contact
    return contact
  }

  return {
    async issueCode(o) {
      let code = generateCode()
      while (state.codes[code]) code = generateCode()
      const record: CodeRecord = { code, createdAt: now().toISOString(), conversationId: o?.conversationId }
      state.codes[code] = record
      // Old unused codes are noise: keep the file small.
      for (const [c, r] of Object.entries(state.codes)) {
        if (!r.phone && now().getTime() - Date.parse(r.createdAt) > CODE_TTL_MS) delete state.codes[c]
      }
      save()
      return structuredClone(record)
    },

    async getCode(code) { return structuredClone(state.codes[code]) },

    async linkCode(code, phone) {
      const record = state.codes[code]
      if (!record) return { ok: false, reason: 'unknown' }
      if (record.phone && record.phone !== phone) return { ok: false, reason: 'used' }
      if (!record.phone && now().getTime() - Date.parse(record.createdAt) > CODE_TTL_MS) return { ok: false, reason: 'expired' }
      record.phone = phone
      record.linkedAt ??= now().toISOString()
      const contact = upsertContact(phone)
      if (!contact.codes.includes(code)) contact.codes.push(code)
      save()
      return { ok: true, contact: structuredClone(contact), record: structuredClone(record) }
    },

    async contactByPhone(phone) { return structuredClone(state.contacts[phone]) },

    async contactByCode(code) {
      const phone = state.codes[code]?.phone
      return phone ? structuredClone(state.contacts[phone]) : undefined
    },

    async touchContact(phone, patch) {
      const c = upsertContact(phone, patch)
      save()
      return structuredClone(c)
    },

    async listContacts() { return structuredClone(Object.values(state.contacts)) },

    async addMessage(m) {
      const message: PhoneMessage = { ...m, id: randomUUID(), seq: nextSeq(), ts: m.ts ?? now().toISOString() }
      state.messages.push(message)
      if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES)
      save()
      return structuredClone(message)
    },

    async messagesFor(phone, afterSeq = 0) {
      return structuredClone(state.messages.filter((x) => x.phone === phone && x.seq > afterSeq))
    },

    async addRing(r) {
      const ring: Ring = { ...r, id: `ring-${randomUUID().slice(0, 8)}`, seq: nextSeq(), createdAt: now().toISOString(), status: 'pending' }
      state.rings.push(ring)
      if (state.rings.length > MAX_RINGS) state.rings.splice(0, state.rings.length - MAX_RINGS)
      if (r.nudgeKey) state.nudged[r.nudgeKey] = ring.id
      save()
      return structuredClone(ring)
    },

    async ringsFor(phone, afterSeq = 0) {
      return structuredClone(state.rings.filter((x) => x.phone === phone && x.seq > afterSeq))
    },

    async getRing(id) { return structuredClone(state.rings.find((r) => r.id === id)) },

    async setRingStatus(id, status) {
      const ring = state.rings.find((r) => r.id === id)
      if (!ring) return undefined
      ring.status = status
      save()
      return structuredClone(ring)
    },

    async hasNudged(key) { return key in state.nudged },

    async bindConversation(conversationId, phone) {
      state.conversations[conversationId] = phone
      const keys = Object.keys(state.conversations)
      if (keys.length > 500) for (const k of keys.slice(0, keys.length - 500)) delete state.conversations[k]
      save()
    },

    async phoneForConversation(conversationId) { return state.conversations[conversationId] },

    async currentSeq() { return state.seq }
  }
}
