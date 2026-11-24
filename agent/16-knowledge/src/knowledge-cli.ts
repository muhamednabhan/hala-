import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { readHalaEnv, setHalaVar } from '@hala/provisioning'
import { loadDocs } from './docs'
import { rulesHash, RULES } from './pronunciation'
import { syncKnowledgeBase, syncProcedures, syncPronunciation } from './sync'

/**
 * npm run agent:knowledge -- [--only pronunciation,kb,procedures] [--agent web|robot|dev] [--dry-run]
 *
 *   pronunciation  create the UAE/DSO pronunciation dictionary (once per change) and remember its id in .env.hala
 *   kb             upload the knowledge-base documents (once per change), build the Arabic-capable index, remember the ids
 *   procedures     create or update the conversation procedures on an agent and publish them
 *
 * Nothing here changes an agent's prompt or voice: that is `npm run agent:sync` (with --lean to use the procedures).
 */
const args = process.argv.slice(2)
const opt = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined }
const only = new Set((opt('only') ?? 'pronunciation,kb').split(','))
const env = readHalaEnv()
const get = (k: string) => process.env[k] ?? env.get(k)

if (args.includes('--dry-run')) {
  console.log(`pronunciation: ${RULES.length} rules, version ${rulesHash()}`)
  for (const d of loadDocs()) console.log(`kb: ${d.name} (${d.text.length} chars)`)
  process.exit(0)
}
if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is not set')
const client = new ElevenLabsClient()

if (only.has('pronunciation')) {
  const d = await syncPronunciation(client)
  setHalaVar('HALA_PRONUNCIATION_ID', d.pronunciationDictionaryId)
  setHalaVar('HALA_PRONUNCIATION_VERSION', d.versionId)
  console.log(`pronunciation: ${d.created ? 'created' : 'up to date'} ${d.pronunciationDictionaryId}`)
}
if (only.has('kb')) {
  const docs = await syncKnowledgeBase(client)
  // base64: the env-file parser mangles raw JSON quotes
  setHalaVar('HALA_KB_B64', Buffer.from(JSON.stringify(docs.map(({ id, name }) => ({ id, name })))).toString('base64'))
  for (const d of docs) console.log(`kb: ${d.created ? 'uploaded' : 'up to date'} ${d.name}`)
}
if (only.has('procedures')) {
  const which = opt('agent') ?? 'dev'
  const key = which === 'robot' ? 'HALA_AGENT_ID_ROBOT' : which === 'web' ? 'HALA_AGENT_ID' : which === 'dev2' ? 'HALA_AGENT_ID_DEV2' : 'HALA_AGENT_ID_DEV'
  const id = get(key)
  if (!id) throw new Error(`No agent id for "${which}" (${key}). Run npm run agent:sync first${which === 'dev' ? ' with --dev' : ''}.`)
  const r = await syncProcedures(client, id)
  setHalaVar(`HALA_PROC_START_${which.toUpperCase()}`, r.startIds.join(','))
  console.log(`procedures on ${which}: created ${r.created.length}, updated ${r.updated.length}, published`)
}
