import { isAdmin, json } from '@/lib/server'
import { lastSync, runSync } from '@/lib/live-knowledge'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. A person can use the admin key. */
async function allowed(req: Request): Promise<boolean> {
  const cron = process.env.CRON_SECRET
  if (cron && req.headers.get('authorization') === `Bearer ${cron}`) return true
  return isAdmin(req)
}

/** GET /api/knowledge/sync: run the sync now (cron and admin). */
export async function GET(req: Request) {
  if (!(await allowed(req))) return json({ error: 'unauthorized' }, 401)
  return json(await runSync())
}

/** POST /api/knowledge/sync: same, for buttons and scripts; the answer says what the last run did. */
export async function POST(req: Request) {
  if (!(await allowed(req))) return json({ error: 'unauthorized' }, 401)
  const result = await runSync()
  return json({ result, last: lastSync() })
}
