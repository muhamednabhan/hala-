import { tokens, withinOneEdit, type Lang, type Service } from '@hala/core'

export interface ScoredMatch<T> {
  item: T
  score: number
}

export interface MatchResult<T> {
  matches: ScoredMatch<T>[]
  /** none: nothing matched. ambiguous: several are about equally good. clear: one stands out. */
  confidence: 'none' | 'ambiguous' | 'clear'
}

interface Keyworded {
  keywords: { en: string[]; ar: string[] }
}

/** A keyword token is satisfied by an exact stem or, for longer words, one typo away (speech-to-text slips). */
function present(query: Set<string>, queryList: string[], word: string): boolean {
  if (query.has(word)) return true
  if (word.length < 6) return false
  return queryList.some((q) => q.length >= 6 && withinOneEdit(q, word))
}

/**
 * Score free text against keyword phrases. A phrase counts when ALL its words appear in the query
 * (order and gaps do not matter). Longer phrases are worth more, so "renew visa" beats "visa".
 * Single words are generic: worth 1, so a bare "visa" ties across the visa services and the agent
 * must ask which one.
 */
export function scoreKeywords(query: string, kw: Keyworded['keywords']): number {
  const queryList = tokens(query)
  const q = new Set(queryList)
  let score = 0
  for (const lang of ['en', 'ar'] as Lang[]) {
    for (const phrase of kw[lang]) {
      const words = tokens(phrase)
      if (words.length === 0) continue
      if (words.every((w) => present(q, queryList, w))) score += words.length === 1 ? 1 : words.length * 2
    }
  }
  return score
}

/** Rank items for a query. `ambiguous` when the runner-up is within 1 point of the best. */
export function rank<T extends Keyworded>(query: string, items: T[], limit = 3): MatchResult<T> {
  const scored = items
    .map((item) => ({ item, score: scoreKeywords(query, item.keywords) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) return { matches: [], confidence: 'none' }
  const top = scored[0]!
  const close = scored.filter((s) => top.score - s.score < 2).length
  const matches = scored.filter((s) => s.score * 2 >= top.score).slice(0, limit)
  return { matches, confidence: close > 1 ? 'ambiguous' : 'clear' }
}

export const matchServices = (query: string, services: Service[], limit = 3) => rank(query, services, limit)
