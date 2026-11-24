import type { Robot } from '@hala/core'
import { hala, json } from './server'
import { clientKey, createRateLimiter } from './rate-limit'

const allow = createRateLimiter(240, 60_000) // the bridge syncs every 2 s: 30 a minute, with headroom

/** Authenticate a request from the robot bridge (Authorization: Bearer hbr_...). */
export async function robotFromRequest(req: Request): Promise<{ robot: Robot } | { error: Response }> {
  const bearer = /^Bearer\s+(\S+)/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!allow(`${clientKey(req)}:${bearer?.slice(-8) ?? ''}`)) return { error: json({ error: 'Too many requests' }, 429) }
  const robot = await (await hala()).robots.authenticate(bearer)
  return robot ? { robot } : { error: json({ error: 'unauthorized' }, 401) }
}
