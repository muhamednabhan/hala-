import { normalizePhone } from '@hala/phone'
import { json } from '@/lib/server'
import { phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/**
 * POST /api/phone/calls  { phone, conversation_id }
 * The app tells us which ElevenLabs conversation belongs to which number, so the agent's tools
 * (send a text, book with the right contact) know who they are talking to.
 */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { phone?: unknown; conversation_id?: unknown }
  const number = normalizePhone(b.phone)
  if (!number || typeof b.conversation_id !== 'string' || b.conversation_id.length > 200) return json({ error: 'phone and conversation_id are required' }, 400)
  await (await phone()).store.bindConversation(b.conversation_id, number)
  return json({ ok: true })
}
