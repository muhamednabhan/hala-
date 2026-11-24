import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { readHalaEnv } from '@hala/provisioning'
import { syncLiveAnswers } from './sync'

/** npm run agent:answers  -  pull the staff answers from Supabase into the agents' ElevenLabs knowledge base now. */
const env = readHalaEnv()
const get = (k: string) => process.env[k] ?? env.get(k)
const url = get('SUPABASE_URL')
const serviceKey = get('SUPABASE_SERVICE_KEY')
const agentIds = [get('HALA_AGENT_ID'), get('HALA_AGENT_ID_ROBOT')].filter((x): x is string => Boolean(x))
if (!url || !serviceKey) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are needed')
if (agentIds.length === 0) throw new Error('No agent ids: run npm run agent:sync first')
console.log(await syncLiveAnswers({ supabase: { url, serviceKey }, eleven: new ElevenLabsClient(), agentIds }))
