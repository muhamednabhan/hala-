'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HalaEvent, RobotCommand, RobotLog } from '@hala/core'
import type { RobotView } from '@hala/robot'
import { setupCommands } from '@hala/robot/setup'
import { EventCard } from './EventCard'

const KEY = 'hala-admin-key'
type Detail = { robot: RobotView; logs: RobotLog[]; commands: RobotCommand[] }
type Form = { name: string; notes: string; ip: string; domainId: string; aimdkPath: string; micStream: string; halfDuplex: boolean; volume: string }
const BLANK: Form = { name: '', notes: '', ip: '', domainId: '', aimdkPath: '', micStream: '0', halfDuplex: false, volume: '' }

const toForm = (r: RobotView): Form => ({
  name: r.name, notes: r.notes ?? '', ip: r.ip ?? '', domainId: r.domainId?.toString() ?? '', aimdkPath: r.aimdkPath ?? '',
  micStream: String(r.micStream), halfDuplex: r.halfDuplex, volume: r.volume?.toString() ?? ''
})
const toBody = (f: Form) => ({
  name: f.name, notes: f.notes, ip: f.ip, domainId: f.domainId, aimdkPath: f.aimdkPath, micStream: Number(f.micStream), halfDuplex: f.halfDuplex, volume: f.volume
})

const PHASES: Record<string, string> = {
  starting: 'Starting', idle: 'Waiting for Start', connecting: 'Connecting to the agent', conversation: 'In a conversation', stopping: 'Stopping', error: 'Problem'
}

/** The engineer's one-time job, from the AimDK docs and the starter bridge. Ticks are remembered in this browser. */
const CHECKLIST = [
  'Robot is an X2 Ultra (the voice module is not on the EDU) and is powered on.',
  'MangoBot has switched it to voice-only mode (run mode "only_voice") and restarted its agent module, so the built-in assistant no longer owns the mic and speaker.',
  'The development computer (PC2) has internet access. Check: curl -I this site from inside the container.',
  'You know the AimDK workspace path (ask MangoBot) and it is entered below.',
  'You are in the MangoBot container on PC2. Never PC1.'
]

function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'idle'; children: React.ReactNode }) {
  return <span className={`pill ${tone === 'idle' ? '' : `pill-${tone}`}`}><i />{children}</span>
}

export default function RobotConsole() {
  const [key, setKey] = useState('')
  const [keyInput, setKeyInput] = useState('')
  const [robots, setRobots] = useState<RobotView[]>([])
  const [note, setNote] = useState<string>()
  const [selected, setSelected] = useState<string>()
  const [detail, setDetail] = useState<Detail>()
  const [form, setForm] = useState<Form>(BLANK)
  const [adding, setAdding] = useState(false)
  const [token, setToken] = useState<{ id: string; value: string }>()
  const [message, setMessage] = useState<string>()
  const [say, setSay] = useState('Hello, I am HALA, an AI assistant. I am testing my speaker.')
  const [volume, setVolume] = useState(60)
  const [ticks, setTicks] = useState<boolean[]>(() => CHECKLIST.map(() => false))
  const [events, setEvents] = useState<HalaEvent[]>([])
  const logEnd = useRef<HTMLDivElement>(null)

  const api = useCallback(async (path: string, init: RequestInit = {}) => {
    const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', 'x-hala-admin-key': key, ...(init.headers ?? {}) }, cache: 'no-store' })
    const body = await res.json().catch(() => ({}))
    if (res.status === 401) { setKey(''); try { sessionStorage.removeItem(KEY) } catch { /* private mode */ } throw new Error('That access key was not accepted.') }
    if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`)
    return body
  }, [key])

  useEffect(() => {
    try { setKey(sessionStorage.getItem(KEY) ?? '') } catch { /* private mode */ }
    try { const t = JSON.parse(localStorage.getItem('hala-checklist') ?? '[]') as boolean[]; if (t.length === CHECKLIST.length) setTicks(t) } catch { /* ignore */ }
  }, [])

  const loadList = useCallback(async () => {
    if (!key) return
    try {
      const body = await api('/api/robots') as { robots: RobotView[]; note?: string }
      setRobots(body.robots); setNote(body.note)
      setSelected((cur) => cur ?? body.robots[0]?.id)
    } catch (e) { setMessage((e as Error).message) }
  }, [api, key])

  const loadDetail = useCallback(async () => {
    if (!key || !selected) return
    try { setDetail(await api(`/api/robots/${selected}`) as Detail) } catch { /* shown by the list loader */ }
  }, [api, key, selected])

  useEffect(() => { void loadList() }, [loadList])
  useEffect(() => {
    void loadDetail()
    const t = setInterval(() => { void loadDetail() }, 2000)
    return () => clearInterval(t)
  }, [loadDetail])
  useEffect(() => { if (detail && !adding) setForm(toForm(detail.robot)) }, [detail?.robot.id, adding]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { logEnd.current?.scrollIntoView({ block: 'end' }) }, [detail?.logs.length])

  // What HALA did during the robot's current conversation, using the same feed as the Talk page.
  const conversationId = detail?.robot.state?.conversationId
  useEffect(() => {
    setEvents([])
    if (!conversationId) return
    let after = ''
    const tick = async () => {
      const res = await fetch(`/api/events?poll=1&conversation_id=${encodeURIComponent(conversationId)}&after=${encodeURIComponent(after)}`, { cache: 'no-store' })
      if (!res.ok) return
      const fresh = (await res.json()) as HalaEvent[]
      if (fresh.length) { after = fresh[fresh.length - 1]!.ts; setEvents((p) => [...p, ...fresh.filter((e) => !p.some((x) => x.id === e.id))]) }
    }
    void tick()
    const t = setInterval(() => { void tick() }, 1500)
    return () => clearInterval(t)
  }, [conversationId])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setMessage(undefined)
    try { await fn(); setMessage(label); void loadDetail(); void loadList() } catch (e) { setMessage((e as Error).message) }
  }

  const base = typeof window === 'undefined' ? '' : window.location.origin
  const robot = detail?.robot
  const command = useMemo(() => robot ? setupCommands(robot, base, token?.id === robot.id ? token.value : 'hbr_<new token>') : '', [robot, base, token])
  const status = robot?.status
  const st = robot?.state
  const tone = status === 'online' ? 'ok' : status === 'offline' ? 'bad' : 'idle'

  if (!key) {
    return (
      <main className="page robot">
        <section className="card" style={{ maxWidth: 480 }}>
          <h1>Robot control</h1>
          <p className="lede">Enter the access key to manage robots. It is the HALA_ADMIN_KEY setting of this site.</p>
          <form onSubmit={(e) => { e.preventDefault(); try { sessionStorage.setItem(KEY, keyInput) } catch { /* private mode */ } setKey(keyInput) }} style={{ marginTop: 16 }}>
            <div className="field">
              <label htmlFor="key">Access key</label>
              <input id="key" className="input" type="password" autoComplete="off" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} />
            </div>
            <button className="btn btn-primary" type="submit" disabled={!keyInput}>Continue</button>
          </form>
          {message && <p className="notice notice-bad" role="alert" style={{ marginTop: 12 }}>{message}</p>}
        </section>
      </main>
    )
  }

  const fields = (
    <>
      <div className="field"><label htmlFor="name">Name</label><input id="name" className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Robot B, HALA reception" /></div>
      <div className="row">
        <div className="field"><label htmlFor="ip">Robot IP (reference)</label><input id="ip" className="input" value={form.ip} onChange={(e) => setForm({ ...form, ip: e.target.value })} placeholder="10.0.1.41" /></div>
        <div className="field"><label htmlFor="dom">ROS domain id</label><input id="dom" className="input" inputMode="numeric" value={form.domainId} onChange={(e) => setForm({ ...form, domainId: e.target.value })} placeholder="optional" /></div>
      </div>
      <div className="field" style={{ marginTop: 14 }}><label htmlFor="aim">AimDK workspace path</label><input id="aim" className="input" value={form.aimdkPath} onChange={(e) => setForm({ ...form, aimdkPath: e.target.value })} placeholder="~/aimdk" /><small>Ask MangoBot. The setup command sources <code>&lt;path&gt;/install/setup.bash</code>.</small></div>
      <div className="row">
        <div className="field"><label htmlFor="mic">Microphone</label>
          <select id="mic" className="input" value={form.micStream} onChange={(e) => setForm({ ...form, micStream: e.target.value })}>
            <option value="0">Automatic (first to speak)</option><option value="1">Built-in</option><option value="2">External</option>
          </select></div>
        <div className="field"><label htmlFor="vol">Speaker volume</label><input id="vol" className="input" inputMode="numeric" value={form.volume} onChange={(e) => setForm({ ...form, volume: e.target.value })} placeholder="0-100, optional" /></div>
      </div>
      <div className="field" style={{ marginTop: 14 }}>
        <label><input type="checkbox" checked={form.halfDuplex} onChange={(e) => setForm({ ...form, halfDuplex: e.target.checked })} /> Mute the microphone while the robot speaks</label>
        <small>Turn this on if the robot hears itself and interrupts its own answers.</small>
      </div>
      <div className="field"><label htmlFor="notes">Notes</label><textarea id="notes" className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
    </>
  )

  return (
    <main className="page robot">
      <div className="robot-head">
        <div>
          <h1>Robot control</h1>
          <p className="lede">Add a robot, run one command on it, then start and test everything from here. The robot calls this site; nothing connects into the robot.</p>
        </div>
        <button className="btn btn-ghost btn-small" onClick={() => { setKey(''); try { sessionStorage.removeItem(KEY) } catch { /* ignore */ } }}>Lock</button>
      </div>
      {note && <p className="notice notice-warn" role="status" style={{ maxWidth: 'none' }}>{note}</p>}
      {message && <p className="notice" role="status" style={{ maxWidth: 'none', background: 'var(--surface-2)' }}>{message}</p>}

      <div className="grid-2">
        <section className="card" aria-label="Robots">
          <h2>Robots</h2>
          {robots.length === 0 && !adding && <p className="empty" style={{ padding: '12px 0' }}>No robots yet.</p>}
          <ul className="robot-list">
            {robots.map((r) => (
              <li key={r.id}>
                <button className="robot-item" aria-current={selected === r.id && !adding} onClick={() => { setSelected(r.id); setAdding(false) }}>
                  <strong>{r.name}</strong>
                  <span><Pill tone={r.status === 'online' ? 'ok' : r.status === 'offline' ? 'bad' : 'idle'}>{r.status === 'never' ? 'Not connected yet' : r.status === 'online' ? 'Online' : 'Offline'}</Pill></span>
                </button>
              </li>
            ))}
          </ul>
          <div style={{ marginTop: 16 }}>
            <button className="btn btn-ghost btn-small" onClick={() => { setAdding(true); setForm(BLANK) }}>Add a robot</button>
          </div>
        </section>

        {adding ? (
          <section className="card" aria-label="New robot">
            <h2>New robot</h2>
            {fields}
            <div className="row">
              <button className="btn btn-primary btn-small" disabled={!form.name.trim()} onClick={() => void act('Robot added. Copy the setup command below.', async () => {
                const res = await api('/api/robots', { method: 'POST', body: JSON.stringify(toBody(form)) }) as { robot: RobotView; token: string }
                setToken({ id: res.robot.id, value: res.token }); setSelected(res.robot.id); setAdding(false)
              })}>Add robot</button>
              <button className="btn btn-ghost btn-small" onClick={() => setAdding(false)}>Cancel</button>
            </div>
          </section>
        ) : robot && (
          <section className="card" aria-label="Robot details">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h2 style={{ margin: 0 }}>{robot.name}</h2>
              <Pill tone={tone}>{status === 'never' ? 'Not connected yet' : status === 'online' ? 'Online' : 'Offline'}</Pill>
            </div>
            <p className="hint" style={{ margin: '6px 0 14px' }}>
              {status === 'online'
                ? <>{PHASES[st?.phase ?? 'idle']}{st?.simulation ? ' · simulation' : ''}{st?.ros === false && !st?.simulation ? ' · ROS not loaded' : ''} · bridge {robot.bridgeVersion ?? '?'}</>
                : robot.lastSeen ? `Last seen ${new Date(robot.lastSeen).toLocaleTimeString()}` : 'Run the setup command on the robot to connect it.'}
            </p>

            <div className="row">
              {robot.desired === 'running'
                ? <button className="btn btn-quiet" onClick={() => void act('Stopping…', () => api(`/api/robots/${robot.id}`, { method: 'PATCH', body: JSON.stringify({ desired: 'stopped' }) }))}>Stop</button>
                : <button className="btn btn-primary" disabled={status !== 'online'} onClick={() => void act('Starting. Say the robot’s wake word once, then talk.', () => api(`/api/robots/${robot.id}`, { method: 'PATCH', body: JSON.stringify({ desired: 'running' }) }))}>Start</button>}
              <button className="btn btn-ghost" disabled={status !== 'online'} onClick={() => void act('Beep sent to the robot.', () => api(`/api/robots/${robot.id}/commands`, { method: 'POST', body: JSON.stringify({ type: 'speaker_test' }) }))}>Speaker test</button>
              <button className="btn btn-ghost" disabled={status !== 'online' || robot.desired !== 'running'} onClick={() => void act('Reconnecting…', () => api(`/api/robots/${robot.id}/commands`, { method: 'POST', body: JSON.stringify({ type: 'reconnect' }) }))}>Reconnect</button>
            </div>
            {status !== 'online' && robot.desired !== 'running' && <p className="hint" style={{ marginTop: 8 }}>Start becomes available once the bridge is online.</p>}

            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 16px', margin: '18px 0 0', fontSize: '0.92rem' }}>
              <dt className="hint">Speaker</dt><dd style={{ margin: 0 }}>{st?.speakerFocus ? 'Ready (audio focus held)' : robot.desired === 'running' ? 'No audio focus yet' : 'Idle'}</dd>
              <dt className="hint">Microphone</dt>
              <dd style={{ margin: 0 }}>
                {st?.micMessages ? `${st.micMessages} chunks, last ${st.micAgeSecs ?? '?'} s ago${st.micStream ? `, stream ${st.micStream}` : ''}` : 'No audio from the robot yet'}
                {st && !st.simulation && !st.micMessages && robot.desired === 'running' && <small className="hint"> Say the wake word. If nothing arrives, ask MangoBot to confirm voice-only mode.</small>}
              </dd>
              <dt className="hint">Agent audio</dt><dd style={{ margin: 0 }}>{st?.agentOutputFormat ? `${st.agentOutputFormat} out, ${st.agentInputFormat} in${st.agentOutputFormat === 'pcm_16000' && st.agentInputFormat === 'pcm_16000' ? ' ✓' : ' (should be pcm_16000)'}` : '—'}</dd>
              {st?.lastError && <><dt className="hint">Problem</dt><dd style={{ margin: 0, color: 'var(--bad)' }}>{st.lastError}</dd></>}
            </dl>

            <div className="field" style={{ marginTop: 20 }}>
              <label htmlFor="say">Say a sentence (plays through the robot’s speaker)</label>
              <div className="row">
                <input id="say" className="input" style={{ flex: 1 }} value={say} onChange={(e) => setSay(e.target.value)} maxLength={300} />
                <button className="btn btn-ghost btn-small" disabled={status !== 'online' || !say.trim()} onClick={() => void act('Sentence queued.', () => api(`/api/robots/${robot.id}/commands`, { method: 'POST', body: JSON.stringify({ type: 'say', text: say }) }))}>Say it</button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="volnow">Volume now: {volume}</label>
              <div className="row">
                <input id="volnow" type="range" min={0} max={100} value={volume} onChange={(e) => setVolume(Number(e.target.value))} style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-small" disabled={status !== 'online'} onClick={() => void act(`Volume ${volume} sent.`, () => api(`/api/robots/${robot.id}/commands`, { method: 'POST', body: JSON.stringify({ type: 'set_volume', volume }) }))}>Apply</button>
              </div>
            </div>
          </section>
        )}
      </div>

      {robot && !adding && (
        <div className="grid-2">
          <section className="card" aria-label="Connect the robot">
            <h2>1. Connect the robot</h2>
            <ul className="checklist" style={{ marginBottom: 18 }}>
              {CHECKLIST.map((c, i) => (
                <li key={c}>
                  <input type="checkbox" aria-label={c} checked={ticks[i]} onChange={() => { const next = ticks.map((t, j) => (j === i ? !t : t)); setTicks(next); try { localStorage.setItem('hala-checklist', JSON.stringify(next)) } catch { /* ignore */ } }} />
                  <span>{c}</span>
                </li>
              ))}
            </ul>
            <p className="hint" style={{ marginBottom: 8 }}>
              Run this in the container on PC2.{' '}
              {token?.id === robot.id ? 'The token below is shown once.' : 'The token was shown once when the robot was added: make a new one if you need it again.'}
            </p>
            <div className="code">
              <button className="btn btn-ghost btn-small code-copy" style={{ color: '#e6efeb', borderColor: '#4a5a55' }} onClick={() => { void navigator.clipboard?.writeText(command); setMessage('Copied.') }}>Copy</button>
              {command}
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn btn-ghost btn-small" onClick={() => void act('New token made. The old one stopped working.', async () => { const r = await api(`/api/robots/${robot.id}/token`, { method: 'POST' }) as { token: string }; setToken({ id: robot.id, value: r.token }) })}>Make a new token</button>
            </div>
          </section>

          <section className="card" aria-label="Robot settings">
            <h2>Settings</h2>
            {fields}
            <div className="row">
              <button className="btn btn-primary btn-small" onClick={() => void act('Saved. The robot picks it up within a few seconds.', () => api(`/api/robots/${robot.id}`, { method: 'PATCH', body: JSON.stringify(toBody(form)) }))}>Save</button>
              <button className="btn btn-ghost btn-small" onClick={() => { if (confirm(`Remove ${robot.name}?`)) void act('Removed.', async () => { await api(`/api/robots/${robot.id}`, { method: 'DELETE' }); setSelected(undefined); setDetail(undefined) }) }}>Remove robot</button>
            </div>
          </section>
        </div>
      )}

      {robot && !adding && (
        <div className="grid-2">
          <section className="card" aria-label="Robot log">
            <h2>Live log</h2>
            <div className="logbox" aria-live="polite">
              {detail.logs.length === 0 && <span className="hint">Nothing yet.</span>}
              {detail.logs.map((l) => (
                <div key={l.id} className={l.level === 'warn' ? 'log-warn' : l.level === 'error' ? 'log-error' : undefined}>
                  <span className="hint">{new Date(l.ts).toLocaleTimeString()}</span>{' '}
                  {l.level === 'user' ? 'Visitor: ' : l.level === 'agent' ? 'HALA: ' : ''}{l.message}
                </div>
              ))}
              <div ref={logEnd} />
            </div>
            {detail.commands.length > 0 && (
              <p className="hint" style={{ marginTop: 10 }}>Last command: {detail.commands[detail.commands.length - 1]!.type} · {detail.commands[detail.commands.length - 1]!.status}{detail.commands[detail.commands.length - 1]!.result ? ` · ${detail.commands[detail.commands.length - 1]!.result}` : ''}</p>
            )}
          </section>
          <section className="card" aria-label="What HALA did">
            <h2>What HALA did</h2>
            {events.length === 0
              ? <p className="empty" style={{ padding: '12px 0' }}>{conversationId ? 'Nothing booked or logged yet.' : 'Appears while the robot is in a conversation.'}</p>
              : <ol className="events">{[...events].reverse().map((e) => <EventCard key={e.id} event={e} />)}</ol>}
          </section>
        </div>
      )}
    </main>
  )
}
