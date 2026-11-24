import { normalizePhone } from '@hala/phone'
import { isAdmin, json } from '@/lib/server'
import { manualOpening, phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/**
 * POST /api/phone/ring  (admin)  { phone, language?, text?, reason? }
 * Makes HALA call a phone right now. For a deterministic demo and for testing; the automatic version is
 * /api/phone/nudge. The AI disclosure is always put in front of `text`.
 */
export async function POST(req: Request) {
  if (!(await isAdmin(req))) return json({ error: 'admin key required' }, 401)
  const b = (await req.json().catch(() => ({}))) as { phone?: unknown; language?: unknown; text?: unknown; reason?: unknown }
  const number = normalizePhone(b.phone)
  if (!number) return json({ error: 'phone is required' }, 400)
  const { store } = await phone()
  const contact = await store.contactByPhone(number)
  const language = b.language === 'ar' || b.language === 'en' ? b.language : contact?.language ?? 'en'
  const ring = await store.addRing({
    phone: number, language, kind: 'manual',
    reason: typeof b.reason === 'string' && b.reason ? b.reason.slice(0, 200) : 'Manual call from the admin',
    opening: manualOpening(language, typeof b.text === 'string' && b.text.trim() ? b.text.trim().slice(0, 400) : undefined)
  })
  return json({ ok: true, ring })
}
