import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { isPublicHttps, readHalaEnv } from '@hala/provisioning'
import { renderPlan, validateScenarios } from './live/plan'
import { renderReport, reportFileName } from './live/report'
import { SCENARIOS } from './live/scenarios'
import { runScenario, type ScenarioOutcome } from './live/session'

/**
 * Live evals: drive the REAL ElevenLabs agent in text-only mode and check what it says and which tools it calls.
 *
 *   npm run evals:live -- --dry-run          validate and print the plan, no network
 *   npm run evals:live -- --yes              run everything (spends ElevenLabs credits)
 *   npm run evals:live -- --yes --only drone_permit_en,real_person_en
 *
 * Needs: ELEVENLABS_API_KEY, HALA_AGENT_ID (.env.hala after `npm run agent:sync`), PUBLIC_BASE_URL,
 * HALA_TOOL_SECRET, and the talk app running behind the tunnel so the agent's webhook tools work.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const args = process.argv.slice(2)
const flag = (n: string) => args.includes(`--${n}`)
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }

const halaEnv = readHalaEnv(join(root, '.env.hala'))
const get = (k: string) => process.env[k] ?? halaEnv.get(k)

function fail(message: string): never {
  console.error(`\n${message}\n`)
  process.exit(1)
}

const problems = validateScenarios()
if (problems.length) fail(`Scenario data is invalid:\n${problems.map((p) => `  - ${p}`).join('\n')}`)

const only = opt('only')?.split(',').map((s) => s.trim()).filter(Boolean)
const selected = only ? SCENARIOS.filter((s) => only.includes(s.id)) : SCENARIOS
if (only && selected.length !== only.length) {
  fail(`Unknown scenario id(s). Available: ${SCENARIOS.map((s) => s.id).join(', ')}`)
}

if (flag('dry-run')) {
  console.log(renderPlan(selected))
  console.log('\nDry run: nothing was sent. Scenario data is valid.')
  process.exit(0)
}

// ---- preflight: everything that can fail obscurely is checked here, with a plain instruction.
const apiKey = process.env.ELEVENLABS_API_KEY
if (!apiKey) fail('ELEVENLABS_API_KEY is not set. Run the ElevenLabs onboarding (npx -y @elevenlabs/cli@latest onboard init) and use `npm run evals:live` from the repo root so .env.local is loaded.')
const agentId = get('HALA_AGENT_ID')
if (!agentId) fail('HALA_AGENT_ID is not set. Create the agent first: npm run agent:sync (it saves the id to .env.hala).')
const baseUrl = opt('base-url') ?? get('PUBLIC_BASE_URL') ?? ''
if (!isPublicHttps(baseUrl)) {
  fail(`PUBLIC_BASE_URL must be a public https URL (the agent's tools are called from ElevenLabs' servers).\n` +
    `  1. npm run agent:dev                                  (talk app on http://localhost:3005)\n` +
    `  2. cloudflared tunnel --url http://localhost:3005     (copy the https URL)\n` +
    `  3. put PUBLIC_BASE_URL=<url> in .env.hala and run npm run agent:sync`)
}
const secret = get('HALA_TOOL_SECRET')
if (!secret) fail('HALA_TOOL_SECRET is not set. Run npm run agent:sync once; it generates the secret in .env.hala.')

async function preflightTools(): Promise<void> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/tools/lookup_fact`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-hala-secret': secret! },
      body: JSON.stringify({ question: 'what is hala', conversation_id: 'eval-preflight' }),
      signal: AbortSignal.timeout(10_000)
    })
  } catch (e) {
    fail(`Cannot reach ${url}: ${(e as Error).message}\n  Is the talk app running (npm run agent:dev) and the cloudflared tunnel up? Quick-tunnel URLs change on restart: update PUBLIC_BASE_URL and re-run npm run agent:sync.`)
  }
  if (res.status === 401) fail('The tools endpoint rejected our secret (401). HALA_TOOL_SECRET differs from what the app loaded: restart the app, then run npm run agent:sync.')
  if (res.status === 404) fail(`The tools endpoint returned 404 at ${url}. The app is up but /api/tools/[tool] is not mounted yet.`)
  if (!res.ok) fail(`The tools endpoint answered ${res.status}. Check the app logs.`)
  const body = await res.json().catch(() => undefined) as { ok?: boolean } | undefined
  if (!body?.ok) fail('The tools endpoint answered, but not with { ok: true }. Check the app logs.')
  console.log(`✓ tools endpoint reachable and authorised: ${baseUrl}`)
}

console.log(renderPlan(selected))
if (!flag('yes')) {
  console.log('\nNot running: live evals spend ElevenLabs credits (real LLM + text-only turns). Re-run with --yes when you have the go-ahead.')
  process.exit(0)
}

if (!flag('skip-health')) await preflightTools()

const client = new ElevenLabsClient({ apiKey })
const startedAt = new Date()
const outcomes: ScenarioOutcome[] = []
for (const scenario of selected) {
  process.stdout.write(`▶ ${scenario.id} ... `)
  try {
    const outcome = await runScenario(scenario, { client, agentId: agentId!, quietMs: opt('quiet-ms') ? Number(opt('quiet-ms')) : undefined })
    outcomes.push(outcome)
    const failed = outcome.checks.filter((c) => !c.ok)
    console.log(failed.length ? `FAIL (${failed.length})` : 'pass')
    for (const f of failed) console.log(`    ✗ [${f.phase}] ${f.name}: ${f.detail}`)
  } catch (e) {
    console.log(`ERROR ${(e as Error).message}`)
    outcomes.push({
      scenarioId: scenario.id, opening: '', turns: [], conversationId: undefined, toolSource: 'socket', durationMs: 0,
      errors: [(e as Error).message], checks: [{ phase: 'run', name: 'scenario ran', ok: false, detail: (e as Error).message }]
    })
  }
}

const dir = join(root, 'agent', '07-evals', 'reports')
mkdirSync(dir, { recursive: true })
const file = join(dir, reportFileName(startedAt))
writeFileSync(file, renderReport(selected, outcomes, { agentId: agentId!, startedAt: startedAt.toISOString() }), 'utf8')
const passedCount = outcomes.filter((o) => o.checks.every((c) => c.ok)).length
console.log(`\n${passedCount}/${outcomes.length} scenarios passed. Report: ${file}`)
process.exit(passedCount === outcomes.length ? 0 : 2)
