import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  systemClock,
  type Clock, type Robot, type RobotCommand, type RobotCommandType, type RobotLog, type RobotRepo, type RobotState
} from '@hala/core'

/** Bump when the bridge protocol or script changes. The page shows it next to what the robot reports. */
export const BRIDGE_VERSION = '1.0.0'
/** The bridge calls /api/robot/sync this often. Offline means we missed about three in a row. */
export const SYNC_SECS = 2
export const ONLINE_WINDOW_SECS = 10

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
export const newToken = () => `hbr_${randomBytes(24).toString('hex')}`

export type RobotStatus = 'never' | 'online' | 'offline'
export const statusOf = (r: Robot, now: Date): RobotStatus =>
  !r.lastSeen ? 'never' : now.getTime() - new Date(r.lastSeen).getTime() <= ONLINE_WINDOW_SECS * 1000 ? 'online' : 'offline'

// ---------------------------------------------------------------- input validation

const text = (max: number) => z.string().trim().max(max)
const optionalText = (max: number) => z.preprocess((v) => (v === '' || v === null ? undefined : v), text(max).optional())

const settings = {
  name: text(60).min(1, 'Give the robot a name'),
  notes: optionalText(400),
  ip: optionalText(60),
  domainId: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(0).max(232).optional()),
  aimdkPath: optionalText(200),
  micStream: z.coerce.number().pipe(z.union([z.literal(0), z.literal(1), z.literal(2)])),
  halfDuplex: z.boolean(),
  volume: z.preprocess((v) => (v === '' || v === null ? undefined : v), z.coerce.number().int().min(0).max(100).optional())
}
// Defaults apply only when adding a robot. An update that omits a field must leave it alone.
export const createRobotInput = z.object({ ...settings, micStream: settings.micStream.default(0), halfDuplex: settings.halfDuplex.default(false) })
export const updateRobotInput = z.object(settings).partial().extend({ desired: z.enum(['running', 'stopped']).optional() })

export const commandInput = z.discriminatedUnion('type', [
  z.object({ type: z.literal('speaker_test') }),
  z.object({ type: z.literal('reconnect') }),
  z.object({ type: z.literal('say'), text: text(300).min(1) }),
  z.object({ type: z.literal('set_volume'), volume: z.coerce.number().int().min(0).max(100) })
])

// ---------------------------------------------------------------- the bridge's sync message

export const syncInput = z.object({
  version: z.string().max(20).optional(),
  state: z.object({
    phase: z.enum(['starting', 'idle', 'connecting', 'conversation', 'stopping', 'error']).optional(),
    ros: z.boolean().optional(), simulation: z.boolean().optional(), speakerFocus: z.boolean().optional(),
    micStream: z.number().int().min(0).max(9).optional(), micMessages: z.number().int().min(0).optional(),
    micAgeSecs: z.number().nullable().optional(), conversationId: z.string().max(120).optional(),
    agentOutputFormat: z.string().max(30).optional(), agentInputFormat: z.string().max(30).optional(), lastError: z.string().max(300).optional()
  }).optional(),
  logs: z.array(z.object({ level: z.enum(['info', 'warn', 'error', 'user', 'agent']), message: z.string().max(500) })).max(60).optional(),
  results: z.array(z.object({ id: z.string().max(80), ok: z.boolean(), result: z.string().max(300).optional() })).max(20).optional()
})

// ---------------------------------------------------------------- service

export interface RobotView extends Omit<Robot, 'tokenHash'> { status: RobotStatus }

const view = (r: Robot, now: Date): RobotView => {
  const { tokenHash: _hidden, ...rest } = r
  void _hidden
  return { ...rest, status: statusOf(r, now) }
}

export function createRobotService(opts: { robots: RobotRepo; clock?: Clock }) {
  const { robots } = opts
  const clock = opts.clock ?? systemClock
  const nowIso = () => clock.now().toISOString()

  async function create(input: unknown) {
    const data = createRobotInput.parse(input)
    const token = newToken()
    const robot: Robot = {
      id: `rb_${randomUUID().slice(0, 8)}`, ...data, tokenHash: hashToken(token), desired: 'stopped', createdAt: nowIso()
    }
    await robots.create(robot)
    return { robot: view(robot, clock.now()), token }
  }

  async function update(id: string, input: unknown) {
    const robot = await robots.get(id)
    if (!robot) return undefined
    const patch = updateRobotInput.parse(input)
    const next: Robot = { ...robot, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) }
    // Clearing an optional field: the form sends an empty string, which parses to undefined and is dropped above.
    const raw = (input ?? {}) as Record<string, unknown>
    for (const k of ['notes', 'ip', 'domainId', 'aimdkPath', 'volume'] as const) if (raw[k] === '' || raw[k] === null) delete next[k]
    await robots.update(next)
    return view(next, clock.now())
  }

  async function regenerateToken(id: string) {
    const robot = await robots.get(id)
    if (!robot) return undefined
    const token = newToken()
    await robots.update({ ...robot, tokenHash: hashToken(token), lastSeen: undefined, state: undefined })
    return { token }
  }

  async function enqueue(id: string, input: unknown): Promise<RobotCommand | undefined> {
    if (!(await robots.get(id))) return undefined
    const cmd = commandInput.parse(input)
    const { type, ...payload } = cmd
    const command: RobotCommand = { id: `cm_${randomUUID().slice(0, 8)}`, robotId: id, type: type as RobotCommandType, payload, status: 'pending', createdAt: nowIso() }
    await robots.addCommand(command)
    return command
  }

  async function detail(id: string) {
    const robot = await robots.get(id)
    if (!robot) return undefined
    return { robot: view(robot, clock.now()), logs: await robots.logs(id, 150), commands: await robots.recentCommands(id, 10) }
  }

  async function authenticate(token: string | null | undefined): Promise<Robot | undefined> {
    if (!token || !token.startsWith('hbr_') || token.length > 80) return undefined
    return robots.getByTokenHash(hashToken(token))
  }

  /** One round trip from the bridge: it reports, we answer with what it should do next. */
  async function sync(robot: Robot, body: unknown) {
    const msg = syncInput.parse(body ?? {})
    const ts = nowIso()
    const updated: Robot = { ...robot, lastSeen: ts, bridgeVersion: msg.version ?? robot.bridgeVersion, state: (msg.state as RobotState | undefined) ?? robot.state }
    await robots.update(updated)

    if (msg.logs?.length) {
      const logs: RobotLog[] = msg.logs.map((l) => ({ id: `lg_${randomUUID().slice(0, 10)}`, robotId: robot.id, ts, level: l.level, message: l.message }))
      await robots.addLogs(logs)
    }
    if (msg.results?.length) {
      const pending = await robots.recentCommands(robot.id, 30)
      for (const r of msg.results) {
        const cmd = pending.find((c) => c.id === r.id)
        if (cmd) await robots.updateCommand({ ...cmd, status: r.ok ? 'done' : 'failed', result: r.result, doneAt: ts })
      }
    }
    const commands = await robots.pendingCommands(robot.id)
    return {
      ok: true,
      serverTime: ts,
      desired: updated.desired,
      config: { micStream: updated.micStream, halfDuplex: updated.halfDuplex, volume: updated.volume ?? null },
      commands: commands.map((c) => ({ id: c.id, type: c.type, payload: c.payload }))
    }
  }

  return {
    create, update, regenerateToken, enqueue, detail, authenticate, sync,
    list: async () => (await robots.list()).map((r) => view(r, clock.now())),
    remove: async (id: string) => { if (!(await robots.get(id))) return false; await robots.delete(id); return true }
  }
}

export type RobotService = ReturnType<typeof createRobotService>
