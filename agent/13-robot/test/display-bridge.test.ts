import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LOOKS } from '../src'

const bridge = resolve(__dirname, '../bridge/hala_robot_bridge.py')
const publicCopy = resolve(__dirname, '../../06-talk-app/public/hala_robot_bridge.py')
const script = resolve(__dirname, 'display_logic.py')
const python = spawnSync('python', ['--version'])

describe.skipIf(python.status !== 0)('the bridge drives the face, lights and screen', () => {
  it('follows the conversation, plays moments once, shows the QR as a video, and agrees with the website\'s looks', () => {
    const looks = join(mkdtempSync(join(tmpdir(), 'hala-looks-')), 'looks.json')
    writeFileSync(looks, JSON.stringify(LOOKS))
    const r = spawnSync('python', [script, bridge, looks], { encoding: 'utf8', timeout: 60_000 })
    expect(r.stdout + r.stderr).toContain('OK')
    expect(r.status).toBe(0)
  }, 60_000)
  it('keeps the audio steady: stale audio after an interruption is dropped, a stalled mic does not flood silence, failed sessions back off, the AVI writer is fast and exact', () => {
    const r = spawnSync('python', [resolve(__dirname, 'audio_logic.py'), bridge], { encoding: 'utf8', timeout: 90_000 })
    expect(r.stdout + r.stderr).toContain('OK')
    expect(r.status).toBe(0)
  }, 90_000)
  it('the copy the website serves is the same file, and it is the new version', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs')
    expect(readFileSync(publicCopy, 'utf8')).toBe(readFileSync(bridge, 'utf8'))
    expect(readFileSync(bridge, 'utf8')).toContain('BRIDGE_VERSION = "1.1.1"')
  })
})
