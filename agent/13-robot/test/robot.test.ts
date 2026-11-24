import { spawn, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createStores } from '@hala/booking'
import { createRobotService, hashToken, prepareCommands, restoreCommands, setupCommands, statusOf } from '../src'

const bridgePath = resolve(__dirname, '../bridge/hala_robot_bridge.py')
const publicCopy = resolve(__dirname, '../../06-talk-app/public/hala_robot_bridge.py')

let nowMs = Date.parse('2026-11-24T10:00:00Z')
const clock = { now: () => new Date(nowMs) }
const setup = () => { const stores = createStores(); return { stores, svc: createRobotService({ robots: stores.robots, clock }) } }

describe('robot service', () => {
  it('adds a robot, returns the token once, and stores only its hash', async () => {
    const { svc, stores } = setup()
    const { robot, token } = await svc.create({ name: ' Robot B ', ip: '10.0.1.41', domainId: '7', aimdkPath: '~/aimdk', micStream: 1, halfDuplex: true, volume: '55' })
    expect(token).toMatch(/^hbr_[0-9a-f]{48}$/)
    expect(robot).toMatchObject({ name: 'Robot B', ip: '10.0.1.41', domainId: 7, micStream: 1, halfDuplex: true, volume: 55, desired: 'stopped', status: 'never' })
    expect(JSON.stringify(robot)).not.toContain('tokenHash')
    const stored = (await stores.robots.list())[0]!
    expect(stored.tokenHash).toBe(hashToken(token))
    expect(JSON.stringify(stored)).not.toContain(token)
  })
  it('validates input', async () => {
    const { svc } = setup()
    await expect(svc.create({ name: '' })).rejects.toThrow()
    await expect(svc.create({ name: 'x', domainId: 999 })).rejects.toThrow()
    await expect(svc.create({ name: 'x', volume: 101 })).rejects.toThrow()
    await expect(svc.create({ name: 'x', micStream: 3 })).rejects.toThrow()
  })
  it('authenticates by token and rejects anything else', async () => {
    const { svc } = setup()
    const { token } = await svc.create({ name: 'A' })
    expect((await svc.authenticate(token))?.name).toBe('A')
    for (const bad of [undefined, '', 'hbr_nope', token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'), 'Bearer x', 'x'.repeat(200)]) expect(await svc.authenticate(bad)).toBeUndefined()
  })
  it('a regenerated token invalidates the old one', async () => {
    const { svc } = setup()
    const { robot, token } = await svc.create({ name: 'A' })
    const next = (await svc.regenerateToken(robot.id))!
    expect(await svc.authenticate(token)).toBeUndefined()
    expect(await svc.authenticate(next.token)).toBeDefined()
  })
  it('updates settings, clears optional fields, and sets desired state', async () => {
    const { svc } = setup()
    const { robot } = await svc.create({ name: 'A', ip: '1.2.3.4', volume: 40 })
    const u = (await svc.update(robot.id, { name: 'B', ip: '', volume: '', desired: 'running' }))!
    expect(u).toMatchObject({ name: 'B', desired: 'running' })
    expect(u.ip).toBeUndefined()
    expect(u.volume).toBeUndefined()
    expect(await svc.update('rb_missing', { name: 'x' })).toBeUndefined()
  })
  it('sync records state and logs, hands back config, desired and commands, and takes results', async () => {
    const { svc, stores } = setup()
    const { robot: view, token } = await svc.create({ name: 'A', micStream: 2, halfDuplex: true, volume: 30 })
    await svc.update(view.id, { desired: 'running' })
    const cmd = (await svc.enqueue(view.id, { type: 'say', text: 'hello' }))!
    const robot = (await svc.authenticate(token))!

    const res = await svc.sync(robot, { version: '1.0.0', state: { phase: 'idle', ros: true, micMessages: 3 }, logs: [{ level: 'info', message: 'hi' }, { level: 'user', message: 'مرحبا' }] })
    expect(res).toMatchObject({ ok: true, desired: 'running', config: { micStream: 2, halfDuplex: true, volume: 30 } })
    expect(res.commands).toEqual([{ id: cmd.id, type: 'say', payload: { text: 'hello' } }])
    expect((await stores.robots.logs(view.id, 10)).map((l) => l.message)).toEqual(['hi', 'مرحبا'])

    const again = await svc.sync(robot, { results: [{ id: cmd.id, ok: true, result: 'spoken' }] })
    expect(again.commands).toEqual([])
    expect((await svc.detail(view.id))!.commands[0]).toMatchObject({ status: 'done', result: 'spoken' })
  })
  it('a sync that read the robot before Start was pressed does not undo Start (lost-update race)', async () => {
    const { svc } = setup()
    const { robot: v, token } = await svc.create({ name: 'A', micStream: 1 })
    const stale = (await svc.authenticate(token))!            // the bridge's request starts: desired is "stopped"
    await svc.update(v.id, { desired: 'running', volume: 45 }) // meanwhile the admin presses Start and sets a volume
    await svc.sync(stale, { state: { phase: 'idle' } })        // the old request finishes
    const after = (await svc.detail(v.id))!.robot
    expect(after).toMatchObject({ desired: 'running', volume: 45, micStream: 1 })
    expect(after.state?.phase).toBe('idle')
  })
  it('an update from the page does not wipe what the bridge reported', async () => {
    const { svc } = setup()
    const { robot: v, token } = await svc.create({ name: 'A' })
    await svc.sync((await svc.authenticate(token))!, { version: '1.0.0', state: { phase: 'conversation' } })
    await svc.update(v.id, { notes: 'hello' })
    const after = (await svc.detail(v.id))!.robot
    expect(after.state?.phase).toBe('conversation')
    expect(after.lastSeen).toBeTruthy()
    expect(after.bridgeVersion).toBe('1.0.0')
  })
  it('rejects malformed sync messages', async () => {
    const { svc } = setup()
    const { token } = await svc.create({ name: 'A' })
    const robot = (await svc.authenticate(token))!
    await expect(svc.sync(robot, { state: { phase: 'exploding' } })).rejects.toThrow()
    await expect(svc.sync(robot, { logs: Array.from({ length: 100 }, () => ({ level: 'info', message: 'x' })) })).rejects.toThrow()
  })
  it('validates commands', async () => {
    const { svc } = setup()
    const { robot } = await svc.create({ name: 'A' })
    await expect(svc.enqueue(robot.id, { type: 'format_disk' })).rejects.toThrow()
    await expect(svc.enqueue(robot.id, { type: 'say', text: '' })).rejects.toThrow()
    await expect(svc.enqueue(robot.id, { type: 'set_volume', volume: 500 })).rejects.toThrow()
    expect(await svc.enqueue('rb_missing', { type: 'speaker_test' })).toBeUndefined()
    expect((await svc.enqueue(robot.id, { type: 'set_volume', volume: 70 }))!.payload).toEqual({ volume: 70 })
  })
  it('derives online/offline from the last sync', async () => {
    const { svc, stores } = setup()
    const { robot, token } = await svc.create({ name: 'A' })
    expect(statusOf((await stores.robots.get(robot.id))!, clock.now())).toBe('never')
    await svc.sync((await svc.authenticate(token))!, {})
    expect((await svc.list())[0]!.status).toBe('online')
    nowMs += 30_000
    expect((await svc.list())[0]!.status).toBe('offline')
    nowMs -= 30_000
  })
  it('removing a robot removes its commands and logs', async () => {
    const { svc, stores } = setup()
    const { robot } = await svc.create({ name: 'A' })
    await svc.enqueue(robot.id, { type: 'speaker_test' })
    expect(await svc.remove(robot.id)).toBe(true)
    expect(await stores.robots.pendingCommands(robot.id)).toEqual([])
    expect(await svc.remove(robot.id)).toBe(false)
  })
})

describe('setup command', () => {
  it('builds the steps for the robot as organised on 24 Nov: host, built AimDK, own folder, pylib', () => {
    const text = setupCommands({ domainId: 5 }, 'https://hala.example.com/', 'hbr_abc')
    expect(text).toContain('mkdir -p ~/hala && cd ~/hala')
    expect(text).toContain('source /opt/ros/humble/setup.bash')
    expect(text).toContain('export PYTHONPATH=/agibot/software/common/local/lib/python3.10/dist-packages:$PYTHONPATH')
    expect(text).toContain('export LD_LIBRARY_PATH=/agibot/software/common/lib:$LD_LIBRARY_PATH')
    expect(text).toContain('export AMENT_PREFIX_PATH=/agibot/software/common:$AMENT_PREFIX_PATH')
    expect(text).toContain('export ROS_DOMAIN_ID=5')
    expect(text).toContain('python3 -m pip install --no-deps --target ./pylib websocket-client')
    expect(text).toContain('export PYTHONPATH=$PWD/pylib:$PYTHONPATH')
    expect(text).toContain('curl -fsSL https://hala.example.com/hala_robot_bridge.py')
    expect(text).toContain('HALF_DUPLEX=1 HALA_URL=https://hala.example.com HALA_ROBOT_TOKEN=hbr_abc python3 hala_robot_bridge.py')
    expect(text).not.toMatch(/pip3? install --user|sudo/)
  })
  it('uses a custom AimDK location and skips the domain when unset', () => {
    const text = setupCommands({ aimdkPath: '/opt/aimdk/' }, 'https://x.io', 'hbr_t')
    expect(text).toContain('/opt/aimdk/local/lib/python3.10/dist-packages')
    expect(text).not.toContain('ROS_DOMAIN_ID')
  })
  it('prepare and restore use the organisers commands, in the right order', () => {
    const prep = prepareCommands()
    expect(prep).toMatch(/value: 2\}, value: only_voice/)
    expect(prep.indexOf('stop-app agent')).toBeLessThan(prep.indexOf('start-app agent'))
    expect(prep).toContain('audio_volume: 95')
    expect(prep).toContain('ros2 topic info -v --no-daemon /aima/hal/audio/playback')
    const back = restoreCommands()
    expect(back).toContain('audio_volume: 72')
    expect(back).toMatch(/value: 2\}, value: normal/)
  })
})

describe('bridge script', () => {
  it('the copy the website serves is identical to the source', () => {
    expect(readFileSync(publicCopy, 'utf8')).toBe(readFileSync(bridgePath, 'utf8'))
  })
  it('never publishes to a motion topic and starts a single ROS node', () => {
    const src = readFileSync(bridgePath, 'utf8')
    expect(src).not.toMatch(/create_publisher\([^)]*(mc|motion|cmd_vel|locomotion)/i)
    expect((src.match(/create_publisher\(/g) ?? []).length).toBe(1)
    expect(src).toContain('/aima/hal/audio/playback')
    expect(src).toContain('/agent/process_audio_output')
    expect(src).toContain('/aima/hal/audio/capture')
    expect(src).toContain('def on_raw_mic')
    expect(src).toContain('AudioPlayback')
  })
  const python = spawnSync('python', ['--version'])
  it.skipIf(python.status !== 0)('compiles', () => {
    const r = spawnSync('python', ['-m', 'py_compile', bridgePath], { encoding: 'utf8' })
    expect(r.stderr).toBe('')
    expect(r.status).toBe(0)
  })
})

describe.skipIf(python_missing())('bridge in simulation mode against a stub of the website', () => {
  let server: Server | undefined
  afterEach(() => { server?.close() })

  it('pairs, syncs, runs a command and reports back; a bad token is refused', async () => {
    const { svc, stores } = setup()
    const { robot, token } = await svc.create({ name: 'Sim' })
    const cmd = (await svc.enqueue(robot.id, { type: 'speaker_test' }))!

    server = createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const c of req) chunks.push(c as Buffer)
      const auth = await svc.authenticate(/^Bearer\s+(\S+)/.exec(req.headers.authorization ?? '')?.[1])
      if (!auth) { res.writeHead(401).end('{}'); return }
      if (req.url === '/api/robot/sync') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(await svc.sync(auth, JSON.parse(Buffer.concat(chunks).toString() || '{}'))))
      } else res.writeHead(404).end('{}')
    })
    await new Promise<void>((ok) => server!.listen(0, '127.0.0.1', ok))
    const url = `http://localhost:${(server.address() as AddressInfo).port}`

    const run = (tok: string) => spawn('python', [bridgePath], { env: { ...process.env, HALA_URL: url, HALA_ROBOT_TOKEN: tok, HALA_SIM: '1', PYTHONIOENCODING: 'utf-8' } })

    const bad = run('hbr_wrong')
    let badOut = ''
    bad.stdout.on('data', (d) => { badOut += d })

    const good = run(token)
    let out = ''
    good.stdout.on('data', (d) => { out += d })
    const waitFor = async (check: () => Promise<boolean>) => { for (let i = 0; i < 100; i++) { if (await check()) return true; await new Promise((r) => setTimeout(r, 100)) } return false }

    const done = await waitFor(async () => (await svc.detail(robot.id))!.commands.find((c) => c.id === cmd.id)?.status === 'done')
    good.kill(); bad.kill()
    expect(done, out).toBe(true)
    const detail = (await svc.detail(robot.id))!
    expect(detail.robot.status).toBe('online')
    expect(detail.robot.state).toMatchObject({ phase: 'idle', ros: false, simulation: true })
    expect(detail.robot.bridgeVersion).toBeTruthy()
    expect(detail.commands[0]).toMatchObject({ status: 'done', result: 'played two beeps' })
    expect(detail.logs.some((l) => /SIMULATION/.test(l.message))).toBe(true)
    expect(badOut).toMatch(/rejected the token|token/i)
    expect((await stores.robots.list()).length).toBe(1)
  }, 20_000)
})

function python_missing() { return spawnSync('python', ['--version']).status !== 0 }
