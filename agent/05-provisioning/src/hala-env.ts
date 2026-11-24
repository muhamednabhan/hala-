import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

/**
 * HALA's own settings live in `.env.hala` (gitignored), separate from `.env.local` which belongs to the
 * ElevenLabs onboarding and holds the API key. We never open `.env.local` here.
 *   HALA_TOOL_SECRET      shared secret on every tool webhook
 *   HALA_AGENT_ID         pinned web agent
 *   HALA_AGENT_ID_ROBOT   pinned robot agent
 *   HALA_AGENT_ID_PHONE   pinned phone-app agent
 *   HACKCLUB_AI_KEY       Hack Club AI key for proactive-call wording (optional)
 *   HACKCLUB_AI_MODEL     model id override (optional)
 *   PUBLIC_BASE_URL       https URL ElevenLabs can reach (cloudflared)
 *   HALA_VOICE_ID         chosen voice
 */
export const HALA_ENV_FILE = '.env.hala'

function parse(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) out.set(m[1]!, m[2]!)
  }
  return out
}

export function readHalaEnv(file = HALA_ENV_FILE): Map<string, string> {
  return existsSync(file) ? parse(readFileSync(file, 'utf8')) : new Map()
}

export function setHalaVar(key: string, value: string, file = HALA_ENV_FILE): void {
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.length > 0) : []
  const next = lines.filter((l) => !l.startsWith(`${key}=`))
  next.push(`${key}=${value}`)
  writeFileSync(file, `${next.join('\n')}\n`, 'utf8')
}

/** The tool secret: from the environment, else the file, else generated once and saved. Never printed. */
export function ensureToolSecret(env: NodeJS.ProcessEnv = process.env, file = HALA_ENV_FILE): string {
  const existing = env.HALA_TOOL_SECRET ?? readHalaEnv(file).get('HALA_TOOL_SECRET')
  if (existing) return existing
  const secret = randomBytes(24).toString('hex')
  setHalaVar('HALA_TOOL_SECRET', secret, file)
  return secret
}

export const isPublicHttps = (url: string): boolean => {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(u.hostname)
  } catch { return false }
}
