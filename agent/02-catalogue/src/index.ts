import type { Service } from '@hala/core'
import { SERVICES } from './services'
import { matchServices } from './matcher'

export { SERVICES } from './services'
export { FACTS, lookupFact, type FactLookup } from './facts'
export { rank, scoreKeywords, matchServices, type MatchResult, type ScoredMatch } from './matcher'

export const getService = (id: string, services: Service[] = SERVICES) => services.find((s) => s.id === id)

/** Best matching services for what the caller said, in English or Arabic. */
export const findServices = (query: string, services: Service[] = SERVICES, limit = 3) =>
  matchServices(query, services, limit)
