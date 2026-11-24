import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { buildAgentConfig } from '@hala/provisioning'
import { ensureToolSecret, readHalaEnv } from '@hala/provisioning'

/**
 * npm run evals:latency -- --yes [--llm a,b,c] [--probes hello,docs,fee,book]
 *
 * How long the agent takes to answer, per language model, measured in text mode on throw-away agents (the live agents
 * are never touched). It uses the real prompt and the real tools on the live site, so it includes the tool round trips.
 * Spends a little ElevenLabs credit, so it needs --yes. The "book" probe creates, then cancels, one demo booking.
 *
 * Text mode skips speech recognition and speech synthesis, so add roughly 0.5 s before and 0.3 s after for a real call.
 */
const args = process.argv.slice(2)
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const env = readHalaEnv()
const get = (k: string) => process.env[k] ?? env.get(k)

const ONLY_AGENTS = opt('agents') // label=agentId,label=agentId : measure existing agents instead of creating temporary ones
const LLMS = (opt('llm') ?? 'gemini-3.8-flash,gemini-3.1-flash-lite,gemini-3.5-flash,claude-haiku-5-5').split(',')
const PROBES: Record<string, string> = {
  hello: 'Hello',
  docs: 'What documents do I need to renew an employee visa?',
  fee: 'How much does a no objection certificate cost?',
  kb: 'How far is Dubai Silicon Oasis from the airport?',
  dtec: 'Which desk types does Dtec offer?',
  ar: 'ما هي المستندات المطلوبة لبطاقة الدخول؟',
  book: 'Please book a no objection certificate for tomorrow at ten thirty. My name is Latency Test and my number is 0500000000. Yes, go ahead and book it.'
}
const chosen = (opt('probes') ?? 'hello,docs,fee,ar,book').split(',').filter((p) => PROBES[p])

if (!args.includes('--yes')) {
  console.log(`Would test ${LLMS.length} models x ${chosen.length} probes (${LLMS.length * chosen.length} short text conversations) on temporary agents.`)
  console.log('Add --yes to run. It spends a little ElevenLabs credit.')
  process.exit(0)
}

const base = get('PUBLIC_BASE_URL')
if (!base || !get('ELEVENLABS_API_KEY')) throw new Error('Need ELEVENLABS_API_KEY and PUBLIC_BASE_URL')
const client = new ElevenLabsClient()
const secret = ensureToolSecret()

interface Timing { firstMs?: number; toolMs?: number[]; totalMs?: number; text: string; tools: string[] }

async function probe(agentId: string, text: string): Promise<Timing> {
  const { signedUrl } = await client.conversationalAi.conversations.getSignedUrl({ agentId })
  const ws = new WebSocket(signedUrl)
  const out: Timing = { text: '', tools: [], toolMs: [] }
  let sentAt = 0
  let phase: 'opening' | 'waiting' | 'done' = 'opening'
  let lastEvent = Date.now()
  const toolStart = new Map<number, number>()
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { try { ws.close() } catch { /* */ } resolve() }, 45_000)
    const finish = () => { clearTimeout(timer); try { ws.close() } catch { /* */ } resolve() }
    ws.onerror = () => reject(new Error('websocket error'))
    ws.onopen = () => ws.send(JSON.stringify({ type: 'conversation_initiation_client_data', conversation_config_override: { conversation: { text_only: true } } }))
    ws.onmessage = (m) => {
      const ev = JSON.parse(String(m.data)) as Record<string, any>
      if (ev.type === 'ping') { ws.send(JSON.stringify({ type: 'pong', event_id: ev.ping_event.event_id })); return }
      lastEvent = Date.now() // pings do not count: they would keep a finished answer looking busy
      if (phase === 'opening' && ev.type === 'agent_response') {
        phase = 'waiting'; sentAt = Date.now()
        ws.send(JSON.stringify({ type: 'user_message', text }))
        // the answer is complete when the agent has been quiet for a moment after speaking
        const poll = setInterval(() => { if (out.text && Date.now() - lastEvent > 1500 && !toolStart.size) { clearInterval(poll); out.totalMs = lastEvent - sentAt; phase = 'done'; finish() } }, 200)
        return
      }
      if (phase !== 'waiting') return
      const now = Date.now()
      if ((ev.type === 'agent_chat_response_part' || ev.type === 'agent_response') && out.firstMs === undefined) out.firstMs = now - sentAt
      if (ev.type === 'agent_response') out.text += `${ev.agent_response_event?.agent_response ?? ''} `
      if (ev.type === 'agent_tool_request') { const n = toolStart.size + out.tools.length; toolStart.set(n, now); out.tools.push(String(ev.agent_tool_request?.tool_name)) }
      if (ev.type === 'agent_tool_response') { const k = [...toolStart.keys()][0]; if (k !== undefined) { out.toolMs!.push(now - toolStart.get(k)!); toolStart.delete(k) } }
    }
  })
  return out
}

const pct = (xs: number[], p: number) => xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(p * xs.length))]! : NaN
const created: string[] = []
const table: string[] = ['| model | probe | first reply | whole answer | tools (ms) | answer |', '|---|---|---|---|---|---|']
const summary: Record<string, number[]> = {}

try {
  const targets: { label: string; id?: string }[] = ONLY_AGENTS ? ONLY_AGENTS.split(',').map((x) => ({ label: x.split('=')[0]!, id: x.split('=')[1] })) : LLMS.map((l) => ({ label: l }))
  for (const t of targets) {
    const llm = t.label
    let agentId: string
    if (t.id) agentId = t.id
    else try {
      const config = buildAgentConfig({ channel: 'web', publicBaseUrl: base, toolSecret: secret, llm: llm as never })
      agentId = (await client.conversationalAi.agents.create({ ...config, name: `HALA latency test (${llm})` } as never)).agentId
      created.push(agentId)
    } catch (e) { table.push(`| ${llm} | - | not available: ${(e as Error).message.slice(0, 60)} | | | |`); continue }
    for (const p of chosen) {
      try {
        const t = await probe(agentId, PROBES[p]!)
        ;(summary[llm] ??= []).push(t.firstMs ?? NaN)
        console.log(`${llm} ${p}: first ${t.firstMs ?? '-'} ms, tools ${t.tools.join(',') || '-'} ${t.toolMs!.join('/')} ms`)
        table.push(`| ${llm} | ${p} | ${t.firstMs ?? '-'} ms | ${t.totalMs ?? '-'} ms | ${t.tools.map((n, i) => `${n} ${t.toolMs![i] ?? '?'}`).join(', ') || '-'} | ${t.text.trim().slice(0, 70).replace(/\|/g, '/')} |`)
      } catch (e) { table.push(`| ${llm} | ${p} | error ${(e as Error).message} | | | |`) }
    }
  }
} finally {
  for (const id of created) { try { await client.conversationalAi.agents.delete(id) } catch { /* leave it, named "latency test" */ } }
}
console.log(table.join('\n'))
console.log('\nMedian first-reply per model (ms):')
for (const [m, xs] of Object.entries(summary)) console.log(`  ${m}: ${pct(xs.filter(Number.isFinite), 0.5)}`)
