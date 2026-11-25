'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DisplayCommand, DisplayCommandInput, Look, LookName } from '@hala/robot'

interface Catalogue {
  emojis: { id: number; name: string }[]
  ledModes: { id: number; name: string }[]
  looks: Record<LookName, Look>
  priority: number
  history: DisplayCommand[]
}
type Api = (path: string, init?: RequestInit) => Promise<unknown>

const label = (c: DisplayCommandInput): string => {
  switch (c.type) {
    case 'emoji': return `Face ${c.id}${c.loop ? ' (loop)' : ''}`
    case 'led': return `LED mode ${c.mode}, rgb(${c.r}, ${c.g}, ${c.b})`
    case 'look': return `Look: ${c.name}`
    case 'qr': return `QR on screen (${c.seconds}s)`
    case 'video': return `Video ${c.path}`
    case 'clear': return 'Clear the screen'
  }
}
const hex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`
const rgb = (h: string) => ({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16) })
/** "1.1.0" >= "1.1.0". The display commands arrived in bridge 1.1.0; an older bridge answers "unknown command display". */
const atLeast = (v: string | undefined, want: number[]) => {
  const have = (v ?? '0').split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < want.length; i++) { if ((have[i] ?? 0) !== want[i]!) return (have[i] ?? 0) > want[i]! }
  return true
}

const PRESETS: { name: string; c: [number, number, number] }[] = [
  { name: 'Blue', c: [47, 107, 246] }, { name: 'Cyan', c: [0, 194, 255] }, { name: 'Green', c: [31, 178, 107] },
  { name: 'Amber', c: [255, 170, 0] }, { name: 'Red', c: [255, 59, 48] }, { name: 'White', c: [255, 255, 255] }, { name: 'Off', c: [0, 0, 0] }
]

/** The checks "Run all" goes through, one every few seconds so you can watch the robot. */
const SEQUENCE: { say: string; cmd: DisplayCommandInput; secs: number }[] = [
  { say: 'Happy face, green lights', cmd: { type: 'look', name: 'happy' }, secs: 4 },
  { say: 'Thinking face, blue blinking', cmd: { type: 'look', name: 'thinking' }, secs: 4 },
  { say: 'Sympathy face, amber breathing', cmd: { type: 'look', name: 'sympathy' }, secs: 4 },
  { say: 'Serious face, red blinking', cmd: { type: 'look', name: 'serious' }, secs: 4 },
  { say: 'Delighted face, green flowing', cmd: { type: 'look', name: 'delighted' }, secs: 4 },
  { say: 'LED steady red', cmd: { type: 'led', mode: 0, r: 255, g: 0, b: 0 }, secs: 3 },
  { say: 'LED steady green', cmd: { type: 'led', mode: 0, r: 0, g: 255, b: 0 }, secs: 3 },
  { say: 'LED steady blue', cmd: { type: 'led', mode: 0, r: 0, g: 0, b: 255 }, secs: 3 },
  { say: 'QR code on the screen', cmd: { type: 'qr', text: 'https://hala.example/robot-screen-test', seconds: 9 }, secs: 11 },
  { say: 'Back to the calm face', cmd: { type: 'clear' }, secs: 3 }
]

export default function RobotDisplayTest({ robotId, api, online, bridgeVersion, inConversation }: { robotId: string; api: Api; online: boolean; bridgeVersion?: string; inConversation: boolean }) {
  const [cat, setCat] = useState<Catalogue>()
  const [error, setError] = useState<string>()
  const [loop, setLoop] = useState(false)
  const [mode, setMode] = useState(1)
  const [color, setColor] = useState('#00c2ff')
  const [qrText, setQrText] = useState('https://hala.example/robot-screen-test')
  const [qrSecs, setQrSecs] = useState(20)
  const [videoPath, setVideoPath] = useState('/var/tmp/hala/test.mp4')
  const [run, setRun] = useState<{ step: number; total: number }>()
  const stop = useRef(false)

  const load = useCallback(async () => {
    try { setCat((await api(`/api/robots/${robotId}/display`)) as Catalogue); setError(undefined) } catch (e) { setError((e as Error).message) }
  }, [api, robotId])
  useEffect(() => {
    void load()
    const t = setInterval(() => { void load() }, 1500)
    return () => clearInterval(t)
  }, [load])

  const send = useCallback(async (cmd: DisplayCommandInput) => {
    try { await api(`/api/robots/${robotId}/display`, { method: 'POST', body: JSON.stringify(cmd) }); setError(undefined); void load() } catch (e) { setError((e as Error).message) }
  }, [api, robotId, load])

  const runAll = async () => {
    stop.current = false
    for (let i = 0; i < SEQUENCE.length; i++) {
      if (stop.current) break
      setRun({ step: i + 1, total: SEQUENCE.length })
      await send(SEQUENCE[i]!.cmd)
      await new Promise((r) => setTimeout(r, SEQUENCE[i]!.secs * 1000))
    }
    setRun(undefined)
  }

  const old = online && !atLeast(bridgeVersion, [1, 1, 0])
  const off = !online || old
  const failed = cat?.history.filter((h) => h.status === 'failed').length ?? 0

  return (
    <div className="facetest">
      {!online && <p className="notice notice-warn">The robot is offline. Start the bridge (Connect tab), then come back.</p>}
      {old && <p className="notice notice-bad">This bridge is version {bridgeVersion ?? '?'} and cannot control the face, lights or screen. Download the new bridge (the setup command in the Connect tab fetches it) and restart it.</p>}
      {online && !old && inConversation && <p className="hint">The robot is in a conversation: tests take over the face for about 12 seconds, then it follows the conversation again.</p>}
      {error && <p className="notice notice-bad" role="alert">{error}</p>}

      <div className="actions">
        {run
          ? <button className="btn btn-end btn-small" onClick={() => { stop.current = true }}>Stop ({run.step} of {run.total})</button>
          : <button className="btn btn-primary btn-small" disabled={off} onClick={() => void runAll()}>Run all checks</button>}
        <button className="btn btn-ghost btn-small" disabled={off} onClick={() => void send({ type: 'clear' })}>Clear the screen</button>
        <span className="hint">{run ? SEQUENCE[run.step - 1]?.say : 'Goes through 5 faces, 3 light colours and a QR code, a few seconds each.'}</span>
      </div>

      <h3 className="facetest-h">Faces</h3>
      <div className="facegrid" role="group" aria-label="Emoji faces">
        {cat?.emojis.map((e) => (
          <button key={e.id} type="button" className="btn btn-ghost btn-small" disabled={off} onClick={() => void send({ type: 'emoji', id: e.id, loop })}>
            <small className="facenum">{e.id}</small> {e.name}
          </button>
        ))}
      </div>
      <label className="check-row"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop the face until another one replaces it</label>

      <h3 className="facetest-h">Looks (face and lights together)</h3>
      <div className="facegrid" role="group" aria-label="Looks">
        {cat && (Object.keys(cat.looks) as LookName[]).map((n) => (
          <button key={n} type="button" className="btn btn-ghost btn-small" disabled={off} title={cat.looks[n].label} onClick={() => void send({ type: 'look', name: n })}>
            <span className="swatch" style={{ background: hex(cat.looks[n].led.r, cat.looks[n].led.g, cat.looks[n].led.b) }} aria-hidden="true" /> {n}
          </button>
        ))}
      </div>

      <h3 className="facetest-h">LED strip</h3>
      <div className="row">
        <div className="field">
          <label htmlFor="ledmode">Mode</label>
          <select id="ledmode" className="input" value={mode} onChange={(e) => setMode(Number(e.target.value))}>
            {cat?.ledModes.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="ledcolor">Colour</label>
          <input id="ledcolor" type="color" className="input colorpick" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <button className="btn btn-ghost btn-small" disabled={off} onClick={() => void send({ type: 'led', mode, ...rgb(color) } as DisplayCommandInput)}>Send</button>
      </div>
      <div className="facegrid" role="group" aria-label="Colour presets">
        {PRESETS.map((p) => (
          <button key={p.name} type="button" className="btn btn-ghost btn-small" onClick={() => setColor(hex(...p.c))}>
            <span className="swatch" style={{ background: hex(...p.c) }} aria-hidden="true" /> {p.name}
          </button>
        ))}
      </div>

      <h3 className="facetest-h">Screen: QR code (played as a video)</h3>
      <div className="field">
        <label htmlFor="qrtext">What the QR says</label>
        <input id="qrtext" className="input" value={qrText} onChange={(e) => setQrText(e.target.value)} maxLength={400} />
      </div>
      <div className="row">
        <div className="field">
          <label htmlFor="qrsecs">Seconds on screen</label>
          <input id="qrsecs" type="number" className="input" min={3} max={120} value={qrSecs} onChange={(e) => setQrSecs(Number(e.target.value))} />
        </div>
        <button className="btn btn-ghost btn-small" disabled={off || !qrText.trim()} onClick={() => void send({ type: 'qr', text: qrText, seconds: qrSecs })}>Show the QR on the robot</button>
      </div>
      <div className="field">
        <label htmlFor="vidpath">Or play a video that is already on the robot (PC3)</label>
        <div className="row">
          <input id="vidpath" className="input" value={videoPath} onChange={(e) => setVideoPath(e.target.value)} />
          <button className="btn btn-ghost btn-small" disabled={off || !videoPath.trim()} onClick={() => void send({ type: 'video', path: videoPath, loop: false })}>Play</button>
        </div>
      </div>

      <h3 className="facetest-h">Results {failed > 0 && <span className="chip chip-bad">{failed} failed</span>}</h3>
      {(cat?.history.length ?? 0) === 0
        ? <p className="hint">Nothing sent yet. Each test shows here with what the robot answered.</p>
        : (
          <ol className="events">
            {cat?.history.map((h) => (
              <li key={h.id} className={`event event-${h.status === 'done' ? 'ok' : h.status === 'failed' ? 'bad' : 'quiet'}`}>
                <div className="event-head">
                  <span className="event-title">{label(h.command)}</span>
                  <span className="hint">{h.status === 'done' ? 'worked' : h.status === 'failed' ? 'failed' : h.status === 'sent' ? 'running on the robot…' : 'waiting for the bridge…'}</span>
                </div>
                {h.result && <div className="event-detail">{h.result}</div>}
              </li>
            ))}
          </ol>
        )}

      <details className="steps">
        <summary>If something does not work</summary>
        <ul className="hint" style={{ paddingInlineStart: 18, display: 'grid', gap: 4 }}>
          <li><strong>Face does nothing:</strong> the robot&apos;s own system can take the screen back. HALA uses priority {cat?.priority ?? 11}; the system uses up to 10 for faults.</li>
          <li><strong>Lights refused or ignored:</strong> on PC1 run <code>aima em stop-app task_manager</code> (it also controls the strip). The strip answers slowly, up to 5 seconds.</li>
          <li><strong>QR does not appear:</strong> the video must be on PC3 and readable by all. If the bridge runs on PC2, start it with <code>HALA_PC3_SSH=user@10.0.1.42</code> (key login), and install <code>ffmpeg</code> on the bridge computer for an MP4.</li>
          <li><strong>&quot;did not answer&quot;:</strong> the service is not reachable from where the bridge runs. Source the AimDK workspace first.</li>
        </ul>
      </details>
    </div>
  )
}
