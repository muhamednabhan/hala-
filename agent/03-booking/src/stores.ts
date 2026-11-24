import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Booking, EventBus, HalaEvent, Handover, Stores, ServiceRequest } from '@hala/core'

interface Snapshot {
  bookings: Booking[]
  requests: ServiceRequest[]
  handovers: Handover[]
  bookingKeys: Record<string, string>
  requestKeys: Record<string, string>
  events: HalaEvent[]
}

const MAX_EVENTS = 2000
const seqOf = (ref: string) => Number(/(\d+)$/.exec(ref)?.[1] ?? 0)

const empty = (): Snapshot => ({ bookings: [], requests: [], handovers: [], bookingKeys: {}, requestKeys: {}, events: [] })

/**
 * In-memory stores, optionally persisted to one JSON file.
 *
 * Why a file and not just memory: the demo runs on a laptop behind a tunnel and may restart in
 * the middle of the night; bookings and handovers must survive that. Persistence is atomic
 * (write a temp file, then rename). This is a stand-in for Supabase: the interfaces in
 * @hala/core/ports are what teammate A implements.
 */
export function createStores(opts: { file?: string } = {}): Stores & { reset: () => void } {
  let state: Snapshot = load(opts.file)
  const listeners = new Set<{ fn: (e: HalaEvent) => void; conversationId?: string }>()

  const save = () => {
    if (!opts.file) return
    mkdirSync(dirname(opts.file), { recursive: true })
    const tmp = `${opts.file}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, opts.file)
  }

  const events: EventBus = {
    publish(e) {
      state.events.push(e)
      if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS)
      save()
      for (const l of listeners) {
        if (l.conversationId && l.conversationId !== e.conversationId) continue
        try { l.fn(e) } catch { /* a broken listener must never break a tool call */ }
      }
    },
    history: async (conversationId) =>
      structuredClone(conversationId ? state.events.filter((e) => e.conversationId === conversationId) : state.events),
    subscribe(fn, conversationId) {
      const entry = { fn, conversationId }
      listeners.add(entry)
      return () => { listeners.delete(entry) }
    }
  }

  const stores: Stores & { reset: () => void } = {
    bookings: {
      create: async (b) => { state.bookings.push(structuredClone(b)); save() },
      get: async (ref) => clone(state.bookings.find((b) => b.ref === ref)),
      update: async (b) => {
        const i = state.bookings.findIndex((x) => x.ref === b.ref)
        if (i >= 0) state.bookings[i] = structuredClone(b)
        save()
      },
      listByDate: async (date) => structuredClone(state.bookings.filter((b) => b.date === date && b.status === 'confirmed')),
      list: async () => structuredClone(state.bookings),
      maxSequence: async () => Math.max(1000, ...state.bookings.map((b) => seqOf(b.ref))),
      findByKey: async (key) => {
        const ref = state.bookingKeys[key]
        return ref ? clone(state.bookings.find((b) => b.ref === ref)) : undefined
      },
      saveKey: async (key, ref) => { state.bookingKeys[key] = ref; save() }
    },
    requests: {
      create: async (r) => { state.requests.push(structuredClone(r)); save() },
      get: async (ref) => clone(state.requests.find((r) => r.ref === ref)),
      list: async () => structuredClone(state.requests),
      maxSequence: async () => Math.max(1000, ...state.requests.map((r) => seqOf(r.ref))),
      findByKey: async (key) => {
        const ref = state.requestKeys[key]
        return ref ? clone(state.requests.find((r) => r.ref === ref)) : undefined
      },
      saveKey: async (key, ref) => { state.requestKeys[key] = ref; save() }
    },
    handovers: {
      create: async (h) => { state.handovers.push(structuredClone(h)); save() },
      update: async (h) => {
        const i = state.handovers.findIndex((x) => x.id === h.id)
        if (i >= 0) state.handovers[i] = structuredClone(h)
        save()
      },
      list: async () => structuredClone(state.handovers)
    },
    events,
    reset() { state = empty(); save() }
  }
  return stores
}

const clone = <T>(v: T | undefined): T | undefined => (v === undefined ? undefined : structuredClone(v))

function load(file?: string): Snapshot {
  if (!file || !existsSync(file)) return empty()
  try {
    return { ...empty(), ...(JSON.parse(readFileSync(file, 'utf8')) as Partial<Snapshot>) }
  } catch {
    // A corrupt file must not stop the demo. Keep the broken file for inspection and start clean.
    try { renameSync(file, `${file}.corrupt-${Date.now()}`) } catch { /* ignore */ }
    return empty()
  }
}
