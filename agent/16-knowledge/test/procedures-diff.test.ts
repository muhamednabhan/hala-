import { describe, expect, it } from 'vitest'
import { diffProcedures, syncProcedures } from '../src'

/** A fake ElevenLabs client that remembers what is written, so the diff can be checked against what a sync really writes. */
function fakeClient() {
  const store = new Map<string, { procedureId: string; name: string; content: string; trigger: string; hasDraft: boolean }>()
  let n = 0
  const procedures = {
    list: async () => ({ procedures: [...store.values()].map(({ content: _c, trigger: _t, ...rest }) => ({ ...rest, trigger: _t })) }),
    get: async (_a: string, _b: string, id: string) => [...store.values()].find((p) => p.procedureId === id),
    create: async (_a: string, _b: string, body: { name: string; content: string; trigger: string }) => {
      const procedureId = `p${++n}`
      store.set(procedureId, { procedureId, hasDraft: false, ...body })
    },
    drafts: { update: async (_a: string, _b: string, id: string, body: { name: string; content: string; trigger: string }) => { store.set(id, { procedureId: id, hasDraft: false, ...body }) } }
  }
  const client = { conversationalAi: { agents: { get: async () => ({ mainBranchId: 'br' }), update: async () => ({}), procedures } } }
  return { client: client as never, store }
}

describe('diffProcedures (read-only comparison with the live agent)', () => {
  it('finds nothing after a sync, and every kind of drift afterwards', async () => {
    const { client, store } = fakeClient()
    await syncProcedures(client, 'agent_x')
    expect(await diffProcedures(client, 'agent_x')).toEqual([])

    const [first, second, third] = [...store.values()]
    first!.content += ' edited by hand'
    second!.trigger = 'something else entirely'
    third!.hasDraft = true
    store.delete([...store.keys()][3]!)
    store.set('extra', { procedureId: 'extra', name: 'A procedure only the dashboard has', content: '', trigger: '', hasDraft: false })

    const lines = (await diffProcedures(client, 'agent_x')).join('\n')
    expect(lines).toContain(`"${first!.name}": content differs`)
    expect(lines).toContain(`"${second!.name}": trigger differs`)
    expect(lines).toContain(`"${third!.name}": has an unpublished draft`)
    expect(lines).toContain('missing on the live agent')
    expect(lines).toContain('"A procedure only the dashboard has": only on the live agent')
  })
})
