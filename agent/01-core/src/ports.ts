import type { Booking, Handover, HalaEvent, Robot, RobotCommand, RobotLog, ServiceRequest } from './types'

/**
 * Storage ports. The agent only ever talks to these interfaces.
 *
 * Today: in-memory and JSON-file adapters (agent/03-booking).
 * Hand-over: teammate A writes Supabase adapters that satisfy the same interfaces, so no agent
 * code changes. All methods are async so a network adapter drops in without refactors.
 */
export interface BookingRepo {
  create: (b: Booking) => Promise<void>
  get: (ref: string) => Promise<Booking | undefined>
  update: (b: Booking) => Promise<void>
  /** Confirmed bookings on a given date (YYYY-MM-DD). */
  listByDate: (date: string) => Promise<Booking[]>
  list: () => Promise<Booking[]>
  /** Highest numeric suffix used so far, so refs stay unique across restarts. */
  maxSequence: () => Promise<number>
  /** Look up by idempotency key (used to dedupe tool retries). */
  findByKey: (key: string) => Promise<Booking | undefined>
  saveKey: (key: string, ref: string) => Promise<void>
}

export interface RequestRepo {
  create: (r: ServiceRequest) => Promise<void>
  get: (ref: string) => Promise<ServiceRequest | undefined>
  list: () => Promise<ServiceRequest[]>
  maxSequence: () => Promise<number>
  findByKey: (key: string) => Promise<ServiceRequest | undefined>
  saveKey: (key: string, ref: string) => Promise<void>
}

export interface HandoverRepo {
  create: (h: Handover) => Promise<void>
  update: (h: Handover) => Promise<void>
  list: () => Promise<Handover[]>
}

/** A partial change to a robot. `null` clears an optional field. Never includes id or createdAt. */
export type RobotPatch = { [K in keyof Omit<Robot, 'id' | 'createdAt'>]?: Robot[K] | null }

/** Robots paired with the website, their remote commands and the bridge's log lines. */
export interface RobotRepo {
  create: (r: Robot) => Promise<void>
  get: (id: string) => Promise<Robot | undefined>
  getByTokenHash: (hash: string) => Promise<Robot | undefined>
  list: () => Promise<Robot[]>
  /**
   * Change only the given fields. The bridge syncs every 2 s while the admin presses buttons, so whole-row writes
   * would silently undo each other (a Start pressed during a sync would be reverted).
   */
  patch: (id: string, fields: RobotPatch) => Promise<void>
  delete: (id: string) => Promise<void>
  addCommand: (c: RobotCommand) => Promise<void>
  /** Commands not yet picked up, oldest first. */
  pendingCommands: (robotId: string) => Promise<RobotCommand[]>
  recentCommands: (robotId: string, limit: number) => Promise<RobotCommand[]>
  updateCommand: (c: RobotCommand) => Promise<void>
  addLogs: (logs: RobotLog[]) => Promise<void>
  /** Newest last. */
  logs: (robotId: string, limit: number) => Promise<RobotLog[]>
}

export interface EventSink {
  publish: (e: HalaEvent) => Promise<void> | void
}

export interface EventBus extends EventSink {
  /** Events so far, optionally for one conversation, oldest first. */
  history: (conversationId?: string) => Promise<HalaEvent[]>
  /** Live subscription. Returns an unsubscribe function. */
  subscribe: (listener: (e: HalaEvent) => void, conversationId?: string) => () => void
}

export interface Stores {
  bookings: BookingRepo
  requests: RequestRepo
  handovers: HandoverRepo
  events: EventBus
  robots: RobotRepo
}

export interface Clock {
  now: () => Date
}

export const systemClock: Clock = { now: () => new Date() }

/**
 * Thrown by a BookingRepo when the database itself refuses a write because the slot is already taken
 * (for Supabase: the partial unique index on date+time). The calendar turns it into a "taken" answer.
 */
export class SlotConflictError extends Error {
  constructor(message = 'slot already booked') {
    super(message)
    this.name = 'SlotConflictError'
  }
}
