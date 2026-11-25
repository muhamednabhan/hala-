import { isAdmin, json } from '@/lib/server'
import { lastScoring, runScoring } from '@/lib/scoring'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST /api/conversations/score (admin key): look for analysed conversations now and write their scores into hala_events. */
export async function POST(req: Request) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  const result = await runScoring()
  return json({ result, last: lastScoring() })
}

/** GET: what the last run did, without running anything. */
export async function GET(req: Request) {
  if (!(await isAdmin(req))) return json({ error: 'unauthorized' }, 401)
  return json(lastScoring())
}
