import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(here, '..', '..')

/**
 * The app lives in agent/06-talk-app but the secrets live at the repo root:
 *   .env.local  ELEVENLABS_API_KEY (written by the ElevenLabs onboarding)
 *   .env.hala   HALA_TOOL_SECRET, HALA_AGENT_ID, PUBLIC_BASE_URL, ... (written by npm run agent:sync)
 * Next only loads env from its own folder, so load the root files here. We never print them.
 */
function loadRootEnv(file: string) {
  const path = resolve(repoRoot, file)
  if (!existsSync(path)) return
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, '')
  }
}
loadRootEnv('.env.local')
loadRootEnv('.env.hala')

const config: NextConfig = {
  // Workspace packages ship TypeScript source, so Next compiles them.
  transpilePackages: ['@hala/core', '@hala/catalogue', '@hala/booking', '@hala/tools-api', '@hala/provisioning', '@hala/supabase', '@hala/robot', '@hala/live-knowledge', '@hala/phone'],
  turbopack: { root: repoRoot },
  serverExternalPackages: ['@elevenlabs/elevenlabs-js', 'qrcode'],
  poweredByHeader: false,
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Referrer-Policy', value: 'same-origin' },
        // The page needs the microphone and nothing else.
        { key: 'Permissions-Policy', value: 'microphone=(self), camera=(), geolocation=()' }
      ]
    }]
  }
}

export default config
