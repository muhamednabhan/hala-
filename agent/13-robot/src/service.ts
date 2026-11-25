import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  systemClock,
  type Clock, type Robot, type RobotCommand, type RobotCommandType, type RobotLog, type RobotPatch, type RobotRepo, type RobotState
} from '@hala/core'

/** Bump when the bridge protocol or script changes. The page shows it next to what the robot reports. */
export const BRIDGE_VERSION = '1.1.1'
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
    micStream: z.number().int().min(0).max(9).optional(), micMode: z.enum(['raw', 'processed']).optional(), micMessages: z.number().int().min(0).optional(),
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
    const raw = (input ?? {}) as Record<string, unknown>
    const parsed = updateRobotInput.parse(input)
    const fields: RobotPatch = Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined))
    // The form sends an empty string to clear an optional field.
    for (const k of ['notes', 'ip', 'domainId', 'aimdkPath', 'volume'] as const) if (raw[k] === '' || raw[k] === null) (fields as Record<string, unknown>)[k] = null
    await robots.patch(id, fields)
    return view((await robots.get(id))!, clock.now())
  }

  async function regenerateToken(id: string) {
    const robot = await robots.get(id)
    if (!robot) return undefined
    const token = newToken()
    await robots.patch(id, { tokenHash: hashToken(token), lastSeen: null, state: null })
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
    const [logs, commands] = await Promise.all([robots.logs(id, 150), robots.recentCommands(id, 10)])
    return { robot: view(robot, clock.now()), logs, commands }
  }

  async function authenticate(token: string | null | undefined): Promise<Robot | undefined> {
    if (!token || !token.startsWith('hbr_') || token.length > 80) return undefined
    return robots.getByTokenHash(hashToken(token))
  }

  /** One round trip from the bridge: it reports, we answer with what it should do next. */
  async function sync(robot: Robot, body: unknown) {
    const msg = syncInput.parse(body ?? {})
    const ts = nowIso()
    const logs: RobotLog[] = (msg.logs ?? []).map((l) => ({ id: `lg_${randomUUID().slice(0, 10)}`, robotId: robot.id, ts, level: l.level, message: l.message }))

    // One round of parallel calls: a far-away database makes every sequential query cost a full network trip.
    // Only the bridge-owned fields are written. The settings and desired state belong to the website and may have
    // just changed, so they are READ in the same round (never from the possibly stale `robot` we authenticated with).
    const [fresh, , commands] = await Promise.all([
      robots.get(robot.id),
      robots.patch(robot.id, { lastSeen: ts, ...(msg.version ? { bridgeVersion: msg.version } : {}), ...(msg.state ? { state: msg.state as RobotState } : {}) }),
      robots.pendingCommands(robot.id),
      logs.length ? robots.addLogs(logs) : Promise.resolve(),
      msg.results?.length ? applyResults(robot.id, msg.results, ts) : Promise.resolve()
    ])
    const current = fresh ?? robot
    return {
      ok: true,
      serverTime: ts,
      desired: current.desired,
      config: { micStream: current.micStream, halfDuplex: current.halfDuplex, volume: current.volume ?? null },
      // A command that just got its result back is not pending any more.
      commands: commands.filter((c) => !msg.results?.some((r) => r.id === c.id)).map((c) => ({ id: c.id, type: c.type, payload: c.payload }))
    }
  }

  async function applyResults(robotId: string, results: NonNullable<z.infer<typeof syncInput>['results']>, ts: string) {
    const recent = await robots.recentCommands(robotId, 30)
    await Promise.all(results.map(async (r) => {
      const cmd = recent.find((c) => c.id === r.id)
      if (cmd) await robots.updateCommand({ ...cmd, status: r.ok ? 'done' : 'failed', result: r.result, doneAt: ts })
    }))
  }

  return {
    create, update, regenerateToken, enqueue, detail, authenticate, sync,
    list: async () => (await robots.list()).map((r) => view(r, clock.now())),
    remove: async (id: string) => { if (!(await robots.get(id))) return false; await robots.delete(id); return true }
  }
}

export type RobotService = ReturnType<typeof createRobotService>
