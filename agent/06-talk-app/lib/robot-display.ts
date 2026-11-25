import { randomUUID } from 'node:crypto'
import { deepLink } from '@hala/phone'
import { deriveScreen, displayCommandInput, type DisplayCommand, type ScreenDirective } from '@hala/robot'
import { hala } from './server'

/**
 * Face, screen and lights for the robot.
 *
 * Test commands from the dashboard are kept in this server's memory, not in the database: hala_robot_commands has a CHECK
 * on its four original types, and these are transient anyway (a restart simply forgets the last few). The bridge picks
 * them up at its next sync (every 2 s) as `display` commands and reports back, which fills in the result here.
 */
const g = globalThis as unknown as { __halaDisplayCmds?: Map<string, DisplayCommand[]> }
const queues = () => (g.__halaDisplayCmds ??= new Map())
const MAX = 40

export function enqueueDisplay(robotId: string, input: unknown): DisplayCommand {
  const command = displayCommandInput.parse(input)
  const item: DisplayCommand = { id: `dc_${randomUUID().slice(0, 8)}`, robotId, command, status: 'pending', createdAt: new Date().toISOString() }
  const list = queues().get(robotId) ?? []
  list.push(item)
  if (list.length > MAX) list.splice(0, list.length - MAX)
  queues().set(robotId, list)
  return item
}

/** Commands not yet sent to the bridge. Marks them sent. */
export function takePending(robotId: string): DisplayCommand[] {
  const out = (queues().get(robotId) ?? []).filter((c: DisplayCommand) => c.status === 'pending')
  for (const c of out) c.status = 'sent'
  return out
}

/** The bridge reports how each command went. Ids that are not display commands are ignored. */
export function applyDisplayResults(robotId: string, results: unknown): void {
  if (!Array.isArray(results)) return
  const list = queues().get(robotId) ?? []
  for (const r of results as { id?: unknown; ok?: unknown; result?: unknown }[]) {
    const c = typeof r?.id === 'string' ? list.find((x: DisplayCommand) => x.id === r.id) : undefined
    if (!c) continue
    c.status = r.ok ? 'done' : 'failed'
    c.result = typeof r.result === 'string' ? r.result.slice(0, 300) : undefined
    c.doneAt = new Date().toISOString()
  }
  // A command the bridge never answered (it was stopped, or it is an old bridge that cannot read these) must not look pending forever.
  const now = Date.now()
  for (const c of list) {
    if (c.status === 'sent' && now - Date.parse(c.createdAt) > 90_000) { c.status = 'failed'; c.result = 'no answer from the bridge in 90 s'; c.doneAt = new Date().toISOString() }
  }
}

export const displayHistory = (robotId: string, limit = 20): DisplayCommand[] => (queues().get(robotId) ?? []).slice(-limit).reverse()

/** What the bridge should show for the conversation the robot is in. QR texts are resolved here (they need the public address). */
export interface BridgeDirective {
  qr: { key: string; kind: 'link' | 'pass'; text: string } | null
  look: ScreenDirective['look']
}

export async function directiveFor(conversationId: string | undefined, publicBase: string): Promise<BridgeDirective> {
  if (!conversationId) return { qr: null, look: null }
  const events = await (await hala()).stores.events.history(conversationId)
  const s = deriveScreen(events, new Date())
  const qr = !s.qr ? null : s.qr.kind === 'link'
    // the same deep link as the laptop's QR: the iPhone camera opens HALA Phone on Messages with the code filled in
    ? { key: s.qr.key, kind: s.qr.kind, text: deepLink(s.qr.code ?? '', publicBase) }
    : { key: s.qr.key, kind: s.qr.kind, text: s.qr.url ?? '' }
  return { qr: qr && qr.text ? qr : null, look: s.look }
}
