import { createStores } from '@hala/booking'
import { createToolApi } from '@hala/tools-api'

/** Tuesday 24 Nov 2026, 12:00 Dubai (08:00 UTC): the clock every offline scenario runs on. */
export const FIXED_NOW = new Date('2026-11-24T08:00:00Z')
export const TEST_SECRET = 'eval-secret-7f3a9c1e5b2d4a68'

/**
 * A real tools API on real in-memory stores with a fake clock. Offline scenarios "play the agent":
 * they call the tools in the order a correct agent would, and assert what comes back.
 */
export function createHarness(conversationId = 'conv_eval') {
  const stores = createStores()
  const api = createToolApi({ stores, clock: { now: () => FIXED_NOW }, secret: TEST_SECRET })
  const headers = { 'x-hala-secret': TEST_SECRET }

  /** Call one tool as ElevenLabs would: secret header, conversation_id injected. */
  const call = async (tool: string, body: Record<string, unknown> = {}, conv: string | undefined = conversationId) => {
    const res = await api.handle(tool, headers, { ...(conv ? { conversation_id: conv } : {}), ...body })
    return res.body as Record<string, any>
  }

  const eventTypes = async (conv?: string) => (await stores.events.history(conv)).map((e) => e.type)

  return { stores, api, call, headers, eventTypes }
}

export type Harness = ReturnType<typeof createHarness>
