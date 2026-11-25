import { describe, expect, it, vi } from 'vitest'
import { createStores } from '@hala/booking'
import type { HalaEvent } from '@hala/core'
import { createScorer, toScore, type ConversationSummary } from '../src'

const NOW = new Date('2026-11-24T12:00:00Z')
const analysis = (over: Partial<NonNullable<ConversationSummary['sentimentAnalysis']>> = {}) => ({
  overallLabel: 'negative', overallSentimentScore: -0.9, overallFrustrationScore: 0.9, minUserSentimentScore: -0.9, maxUserFrustrationScore: 0.9, numScoredUserTurns: 4, ...over
})
const convo = (id: string, over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  conversationId: id, agentId: 'agent_web', status: 'done', startTimeUnixSecs: NOW.getTime() / 1000 - 600, sentimentAnalysis: analysis(), ...over
})

/** Fake ElevenLabs: list() returns what each agent has. */
const fakeClient = (byAgent: Record<string, ConversationSummary[]>) => {
  const list = vi.fn(async ({ agentId }: { agentId: string }) => ({ conversations: byAgent[agentId] ?? [], hasMore: false }))
  return { client: { conversationalAi: { conversations: { list } } } as never, list }
}
const ev = (conversationId: string, type: HalaEvent['type'] = 'service_matched'): HalaEvent => ({ id: `e-${Math.random()}`, ts: NOW.toISOString(), conversationId, type, data: {} })

describe('toScore', () => {
  it('takes the overall scores as ElevenLabs gives them, unscaled', () => {
    expect(toScore(convo('c'))).toMatchObject({ sentiment: -0.9, frustration: 0.9, label: 'negative', turns: 4 })
  })
  it('gives nothing while the analysis is missing, the call is not done, or no caller turn was scored (zeros then mean "nothing")', () => {
    expect(toScore(convo('c', { sentimentAnalysis: undefined }))).toBeUndefined()
    expect(toScore(convo('c', { sentimentAnalysis: null }))).toBeUndefined()
    expect(toScore(convo('c', { status: 'processing' }))).toBeUndefined()
    expect(toScore(convo('c', { sentimentAnalysis: analysis({ numScoredUserTurns: 0, overallSentimentScore: 0, overallFrustrationScore: 0, overallLabel: 'neutral' }) }))).toBeUndefined()
  })
})

describe('writing scores into the events table', () => {
  it('adds one conversation_scored row carrying both numbers, even when the conversation had no other events', async () => {
    const stores = createStores()
    const { client } = fakeClient({ agent_web: [convo('conv_quiet')] })
    const run = await createScorer({ client, agents: { web: 'agent_web' }, events: stores.events, now: () => NOW }).run()
    expect(run.scored).toEqual(['conv_quiet'])
    const rows = await stores.events.history('conv_quiet')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ type: 'conversation_scored', averageSentiment: -0.9, averageFrustration: 0.9 })
    expect(rows[0]!.data).toMatchObject({ channel: 'web', label: 'negative', source: 'elevenlabs', average_sentiment: -0.9 })
  })

  it("puts the same numbers on the conversation's other rows, and leaves other conversations alone", async () => {
    const stores = createStores()
    await stores.events.publish(ev('conv_a', 'booking_created'))
    await stores.events.publish(ev('conv_a', 'slots_listed'))
    await stores.events.publish(ev('conv_b', 'booking_created'))
    const { client } = fakeClient({ agent_web: [convo('conv_a', { sentimentAnalysis: analysis({ overallSentimentScore: 0.4, overallFrustrationScore: 0.1, overallLabel: 'positive' }) })] })
    await createScorer({ client, agents: { web: 'agent_web' }, events: stores.events, now: () => NOW }).run()
    const a = await stores.events.history('conv_a')
    expect(a).toHaveLength(3) // two original rows + the scored one
    for (const e of a) expect(e).toMatchObject({ averageSentiment: 0.4, averageFrustration: 0.1 })
    for (const e of await stores.events.history('conv_b')) expect(e.averageSentiment).toBeUndefined()
  })

  it('writes each conversation once, across runs and across a restart', async () => {
    const stores = createStores()
    const { client } = fakeClient({ agent_web: [convo('conv_1')] })
    const a = createScorer({ client, agents: { web: 'agent_web' }, events: stores.events, now: () => NOW })
    expect((await a.run()).scored).toEqual(['conv_1'])
    expect((await a.run()).scored).toEqual([])
    // a new process knows nothing in memory: the existing row is what stops a second write
    const b = createScorer({ client, agents: { web: 'agent_web' }, events: stores.events, now: () => NOW })
    expect((await b.run()).scored).toEqual([])
    expect((await stores.events.history('conv_1')).filter((e) => e.type === 'conversation_scored')).toHaveLength(1)
  })

  it('waits for a finished conversation that is not analysed yet, and picks it up later', async () => {
    const stores = createStores()
    const byAgent = { agent_web: [convo('conv_late', { sentimentAnalysis: undefined })] }
    const { client } = fakeClient(byAgent)
    const scorer = createScorer({ client, agents: { web: 'agent_web' }, events: stores.events, now: () => NOW })
    const first = await scorer.run()
    expect(first).toMatchObject({ scored: [], waiting: 1 })
    byAgent.agent_web = [convo('conv_late')] // ElevenLabs finished the analysis
    expect((await scorer.run()).scored).toEqual(['conv_late'])
  })

  it('ignores a conversation that is still going, and one with no caller turn', async () => {
    const stores = createStores()
    const { client } = fakeClient({ agent_web: [convo('live', { status: 'in-progress' }), convo('silent', { sentimentAnalysis: analysis({ numScoredUserTurns: 0 }) })] })
    const run = await createScorer({ client, agents: { web: 'agent_web' }, events: stores.events, now: () => NOW }).run()
    expect(run.scored).toEqual([])
    expect(await stores.events.history()).toHaveLength(0)
  })

  it('covers every channel and skips agents that are not set up', async () => {
    const stores = createStores()
    const { client, list } = fakeClient({ agent_web: [convo('w')], agent_robot: [convo('r', { agentId: 'agent_robot' })], agent_phone: [convo('p', { agentId: 'agent_phone' })] })
    const run = await createScorer({ client, agents: { web: 'agent_web', robot: 'agent_robot', phone: 'agent_phone', dev: undefined }, events: stores.events, now: () => NOW }).run()
    expect(run.scored.sort()).toEqual(['p', 'r', 'w'])
    expect(list).toHaveBeenCalledTimes(3)
    const channels = (await stores.events.history()).map((e) => (e.data as any).channel).sort()
    expect(channels).toEqual(['phone', 'robot', 'web'])
  })

  it('only asks for recent conversations', async () => {
    const { client, list } = fakeClient({})
    await createScorer({ client, agents: { web: 'a' }, events: createStores().events, now: () => NOW, lookbackHours: 6 }).run()
    expect(list.mock.calls[0]![0]).toMatchObject({ agentId: 'a', callStartAfterUnix: NOW.getTime() / 1000 - 6 * 3600 })
  })

  it('overlapping runs share one pass instead of writing twice', async () => {
    const stores = createStores()
    const { client, list } = fakeClient({ agent_web: [convo('conv_x')] })
    const scorer = createScorer({ client, agents: { web: 'agent_web' }, events: stores.events, now: () => NOW })
    const [a, b] = await Promise.all([scorer.run(), scorer.run()])
    expect(a).toBe(b)
    expect(list).toHaveBeenCalledTimes(1)
  })

  it('a failing annotate does not lose the scored row', async () => {
    const stores = createStores()
    const events = { ...stores.events, annotate: async () => { throw new Error('column missing') } }
    const { client } = fakeClient({ agent_web: [convo('conv_z')] })
    const run = await createScorer({ client, agents: { web: 'agent_web' }, events, now: () => NOW }).run()
    expect(run.scored).toEqual(['conv_z'])
  })
})
