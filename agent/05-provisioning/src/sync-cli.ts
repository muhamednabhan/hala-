import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { buildAgentConfig, type Channel } from './agent-config'
import { HALA_ENV_FILE, ensureToolSecret, isPublicHttps, readHalaEnv, setHalaVar } from './hala-env'
import { redact, syncAgent } from './sync'

/**
 * npm run agent:sync -- [--channel web|robot|phone|both|all] [--contact-tool] [--human] [--dry-run] [--base-url https://...]
 *
 * Creates or updates the ElevenLabs agent(s) from code. Safe to re-run: it updates in place and pins
 * the agent id in .env.hala. --dry-run prints the config (secret redacted) and needs no API key.
 */
const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const opt = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }

const file = readHalaEnv()
const get = (k: string) => process.env[k] ?? file.get(k)

const channelArg = opt('channel') ?? 'web'
const channels: Channel[] = channelArg === 'both' ? ['web', 'robot'] : channelArg === 'all' ? ['web', 'robot', 'phone'] : [channelArg as Channel]
if (!channels.every((c) => c === 'web' || c === 'robot' || c === 'phone')) throw new Error('--channel must be web, robot, phone, both or all')

const baseUrl = opt('base-url') ?? get('PUBLIC_BASE_URL') ?? ''
const dry = flag('dry-run')
if (!dry && !isPublicHttps(baseUrl)) {
  console.error('PUBLIC_BASE_URL must be a public https URL (ElevenLabs calls our tools from the internet).')
  console.error(`Start a tunnel: cloudflared tunnel --url http://localhost:3005, then put the URL in ${HALA_ENV_FILE} as PUBLIC_BASE_URL=...`)
  process.exit(1)
}

const secret = ensureToolSecret()
const client = dry ? undefined : new ElevenLabsClient()
if (!dry && !process.env.ELEVENLABS_API_KEY) {
  console.error('ELEVENLABS_API_KEY is not set. Run the ElevenLabs onboarding (npx -y @elevenlabs/cli@latest onboard init) first.')
  process.exit(1)
}

for (const channel of channels) {
  const config = buildAgentConfig({ channel, publicBaseUrl: baseUrl || 'https://example.invalid', toolSecret: secret, voiceId: get('HALA_VOICE_ID'), contactTool: flag('contact-tool'), humanVoice: channel === 'phone' || flag('human') ? true : undefined, ttsModel: get('HALA_TTS_MODEL') as never })
  if (dry) {
    console.log(JSON.stringify(redact(config, secret), null, 2))
    continue
  }
  const key = channel === 'robot' ? 'HALA_AGENT_ID_ROBOT' : channel === 'phone' ? 'HALA_AGENT_ID_PHONE' : 'HALA_AGENT_ID'
  const result = await syncAgent(client!, config, get(key))
  if (result.created || get(key) !== result.agentId) setHalaVar(key, result.agentId)
  console.log(`${result.created ? 'created' : 'updated'} ${config.name}: ${result.agentId}`)
  if (result.duplicates.length) console.warn(`  note: other agents named "${config.name}" exist: ${result.duplicates.join(', ')}`)
}
