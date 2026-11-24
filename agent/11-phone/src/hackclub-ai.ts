/**
 * Hack Club AI: a free, OpenAI-compatible LLM proxy for teens (https://ai.hackclub.com).
 * Endpoint and auth verified against the live service on 2026-11-24:
 *   GET  /proxy/v1/models           open
 *   POST /proxy/v1/chat/completions needs `Authorization: Bearer <key>` (401 without one)
 * The key comes from the user's Hack Club AI dashboard and lives only in .env.hala as HACKCLUB_AI_KEY.
 * It is never sent to the phone app.
 */
export const HACKCLUB_AI_BASE = 'https://ai.hackclub.com/proxy/v1'
/**
 * Tried in order until one answers. Checked on 2026-11-24 with a real key: paid models answered 402 "insufficient
 * credits" and the free ones were over their daily quota, so the order is: a free model that is good at Arabic, a
 * second free one, then a cheap paid one for when credits exist. Override with HACKCLUB_AI_MODEL (comma separated).
 */
export const DEFAULT_AI_MODELS = ['google/gemma-4-31b-it:free', 'inclusionai/ling-3.2-flash:free', 'anthropic/claude-haiku-5.5']
export const DEFAULT_AI_MODEL = DEFAULT_AI_MODELS[0]!

/** One-shot text completion. Returns undefined on ANY failure, so callers always have a fallback. */
export interface ChatPort {
  complete(system: string, user: string, opts?: { maxTokens?: number; temperature?: number }): Promise<string | undefined>
}

export interface HackClubAiOptions {
  apiKey?: string
  /** One id, or several separated by commas, tried in order. */
  model?: string
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export function createHackClubAi(o: HackClubAiOptions): ChatPort | undefined {
  if (!o.apiKey) return undefined
  const doFetch = o.fetchImpl ?? fetch
  const base = (o.baseUrl ?? HACKCLUB_AI_BASE).replace(/\/$/, '')
  const models = o.model ? o.model.split(',').map((m) => m.trim()).filter(Boolean) : DEFAULT_AI_MODELS
  const ask = async (model: string, system: string, user: string, opts?: { maxTokens?: number; temperature?: number }) => {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), o.timeoutMs ?? 8000)
    try {
      const res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${o.apiKey}` },
        body: JSON.stringify({
          model, max_tokens: opts?.maxTokens ?? 160, temperature: opts?.temperature ?? 0.3,
          messages: [{ role: 'system', content: system }, { role: 'user', content: user }]
        })
      })
      if (!res.ok) return undefined
      const data = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
      const text = data.choices?.[0]?.message?.content
      return typeof text === 'string' && text.trim() ? text.trim() : undefined
    } catch {
      return undefined
    } finally {
      clearTimeout(timer)
    }
  }
  return {
    async complete(system, user, opts) {
      for (const model of models) {
        const text = await ask(model, system, user, opts)
        if (text) return text
      }
      return undefined
    }
  }
}
