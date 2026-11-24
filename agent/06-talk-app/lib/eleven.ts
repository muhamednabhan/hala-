import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js'
import { setting } from './server'

// Kept out of lib/server.ts on purpose: the tools route does not need this SDK, and loading it costs cold-start time.
const g = globalThis as unknown as { __halaEleven?: ElevenLabsClient }

/** Server-side only. The API key never reaches the browser. */
export function elevenlabs(): ElevenLabsClient {
  g.__halaEleven ??= new ElevenLabsClient({ apiKey: setting('ELEVENLABS_API_KEY') })
  return g.__halaEleven
}
