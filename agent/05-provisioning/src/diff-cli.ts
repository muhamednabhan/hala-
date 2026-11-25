import { readFileSync } from 'node:fs'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { buildAgentConfig, type Channel } from './agent-config'
import { ensureToolSecret, readHalaEnv } from './hala-env'

/**
 * npm run agent:diff -- --channel web|robot|phone [--lean] [--no-sheet] [--voice v3|flash]
 *
 * Read-only. Fetches the live agent and prints every setting where it differs from what `agent:sync` would send, so a
 * change made by hand in the ElevenLabs dashboard is seen BEFORE a sync overwrites it. Changes nothing, prints no secret.
 */
const args = process.argv.slice(2)
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const flag = (n: string) => args.includes(`--${n}`)
const channel = (opt('channel') ?? 'web') as Channel
const file = readHalaEnv()
const get = (k: string) => process.env[k] ?? file.get(k)
const id = get(channel === 'robot' ? 'HALA_AGENT_ID_ROBOT' : channel === 'phone' ? 'HALA_AGENT_ID_PHONE' : 'HALA_AGENT_ID')
if (!id || !process.env.ELEVENLABS_API_KEY) throw new Error('needs ELEVENLABS_API_KEY and the agent id')

const kb0 = get('HALA_KB_B64') ? (JSON.parse(Buffer.from(get('HALA_KB_B64')!, 'base64').toString('utf8')) as { id: string; name: string }[]) : []
// The phone line has no knowledge base on purpose (agent:sync does the same unless --kb is given), so the diff must not expect one.
const kb = channel === 'phone' && !flag('kb') ? [] : kb0
const secret = ensureToolSecret()
const mine = buildAgentConfig({
  channel, publicBaseUrl: get('PUBLIC_BASE_URL') ?? '', toolSecret: secret, voiceId: get('HALA_VOICE_ID'), lean: flag('lean'), sheet: !flag('no-sheet'),
  voiceModel: opt('voice') as 'v3' | 'flash' | undefined, knowledge: kb, humanVoice: channel === 'phone' ? true : undefined, ttsModel: get('HALA_TTS_MODEL') as never
})

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toSnake = (v: unknown): unknown => (Array.isArray(v) ? v.map(toSnake) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [snake(k), toSnake(x)])) : v)
const res = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${id}`, { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } })
const live = (await res.json()) as { conversation_config: Record<string, unknown>; platform_settings: Record<string, unknown> }
const want = toSnake({ conversation_config: mine.conversationConfig, platform_settings: mine.platformSettings }) as Record<string, unknown>

const out: string[] = []
const short = (v: unknown) => { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s.length > 110 ? `${s.slice(0, 107)}...` : s }
type Obj = Record<string, any>
/** Every webhook tool, field by field: the agent can only call what points at the CURRENT tunnel, with the right timeout and fields. */
function diffTools(liveTools: Obj[] | undefined, wantTools: Obj[]) {
  const live = new Map((liveTools ?? []).map((t) => [t.name as string, t]))
  const want = new Map(wantTools.map((t) => [t.name as string, t]))
  for (const name of want.keys()) if (!live.has(name)) out.push(`tool ${name}: MISSING on the live agent`)
  for (const name of live.keys()) if (!want.has(name)) out.push(`tool ${name}: only on the live agent (a sync would drop it)`)
  const props = (t: Obj) => (t.api_schema?.request_body_schema?.properties ?? {}) as Obj
  for (const [name, w] of want) {
    const l = live.get(name)
    if (!l) continue
    const field = (label: string, a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`tool ${name}.${label}: live ${short(a)}  | code ${short(b)}`) }
    field('url', l.api_schema?.url, w.api_schema?.url)
    field('method', l.api_schema?.method, w.api_schema?.method)
    field('timeout', l.response_timeout_secs, w.response_timeout_secs)
    field('description', l.description, w.description)
    field('pre_tool_speech', l.pre_tool_speech, w.pre_tool_speech)
    field('tool_call_sound', l.tool_call_sound, w.tool_call_sound)
    field('tool_call_sound_behavior', l.tool_call_sound_behavior, w.tool_call_sound_behavior)
    field('request header names', Object.keys(l.api_schema?.request_headers ?? {}).sort(), Object.keys(w.api_schema?.request_headers ?? {}).sort())
    field('required fields', [...(l.api_schema?.request_body_schema?.required ?? [])].sort(), [...(w.api_schema?.request_body_schema?.required ?? [])].sort())
    field('field names', Object.keys(props(l)).sort(), Object.keys(props(w)).sort())
    // the platform stores an empty description as "" and a missing enum as null: those are the same thing as absent
    const slim = (p: Obj) => ({ type: p.type, enum: p.enum ?? undefined, description: p.description || undefined, dynamic: p.dynamic_variable || undefined })
    for (const k of Object.keys(props(w))) if (props(l)[k]) field(`field ${k}`, slim(props(l)[k]), slim(props(w)[k]))
  }
}
function walk(a: unknown, b: unknown, path: string) {
  // The platform keeps system tools (end_call, language_detection) out of what a sync sends through the SDK: they were never
  // live on any HALA agent and real calls work without them. Not a difference worth reporting on every run.
  if (path.endsWith('.built_in_tools')) return
  if (path.endsWith('.prompt.tools')) return diffTools(a as Obj[] | undefined, b as Obj[])
  if (path.endsWith('.prompt.prompt') || path.endsWith('first_message') && false) {
    if (a !== b) out.push(`${path}: live ${String(a).length} chars, code ${String(b).length} chars (${a === b ? 'same' : 'differs'})`)
    return
  }
  if (b && typeof b === 'object' && !Array.isArray(b)) {
    for (const k of Object.keys(b as object)) walk((a as Record<string, unknown> | undefined)?.[k], (b as Record<string, unknown>)[k], `${path}.${k}`)
    return
  }
  if (Array.isArray(b)) {
    const bare = (v: unknown) => (typeof v === 'string' ? v.replace(/^\[|\]$/g, '') : v)
    const names = (x: unknown) => (Array.isArray(x) ? x.map((e) => (e && typeof e === 'object' ? bare((e as Record<string, unknown>).name ?? (e as Record<string, unknown>).tag ?? (e as Record<string, unknown>).id ?? JSON.stringify(e)) : e)) : x)
    if (JSON.stringify(names(a)) !== JSON.stringify(names(b))) out.push(`${path}: live ${short(names(a))}  | code ${short(names(b))}`)
    return
  }
  if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${path}: live ${short(a)}  | code ${short(b)}`)
}
walk(live, want, '')
// keep the file import used (some bundlers drop it): readFileSync is only needed by readHalaEnv
void readFileSync
// Lean agents get their flows from procedures (agent:knowledge --only procedures): compare those too.
if (flag('lean') && channel !== 'phone') {
  const { diffProcedures } = await import('@hala/knowledge')
  out.push(...(await diffProcedures(new ElevenLabsClient(), id)))
}
console.log(`${channel} agent ${id.slice(0, 14)}...: ${out.length} difference(s) between the live agent and what agent:sync would send`)
for (const line of out) console.log(' ', line.replace(/^\./, ''))
