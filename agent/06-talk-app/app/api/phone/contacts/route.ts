import { isAdmin, json } from '@/lib/server'
import { phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/** GET /api/phone/contacts  (admin)  Every phone the agent knows, with the codes it linked with. */
export async function GET(req: Request) {
  if (!(await isAdmin(req))) return json({ error: 'admin key required' }, 401)
  return json({ contacts: await (await phone()).store.listContacts() })
}
