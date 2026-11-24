import { z } from 'zod'
import { FACTS, lookupFact } from '@hala/catalogue'
import { json } from '@/lib/server'
import { clientKey, createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const allow = createRateLimiter(30, 60_000)
const body = z.object({ question: z.string().trim().min(3).max(500) })

/**
 * POST /api/research { question }  ->  { found, answer, sources }
 * Answers ONLY from the verified fact base (brief and handover facts). No web search, and the question never
 * leaves this server. Unknown means found:false, and the agent says it does not know and offers a person.
 */
export async function POST(req: Request) {
  if (!allow(clientKey(req))) return json({ error: 'Too many requests' }, 429)
  const parsed = body.safeParse(await req.json().catch(() => ({})))
  if (!parsed.success) return json({ error: 'question must be 3-500 characters' }, 400)
  const result = lookupFact(parsed.data.question, FACTS)
  if (!result.found || !result.fact) {
    return json({ found: false, answer: null, sources: [], message: "I don't have that information. A person from the DSO team should confirm." })
  }
  return json({ found: true, answer: result.fact.answer, sources: [result.fact.source] })
}
