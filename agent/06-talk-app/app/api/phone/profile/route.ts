import { normalizePhone } from '@hala/phone'
import { json } from '@/lib/server'
import { phone } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/** POST /api/phone/profile  { phone, name?, language? }  The app's "line": which dummy number is this, and whose is it. */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as { phone?: unknown; name?: unknown; language?: unknown }
  const number = normalizePhone(b.phone)
  if (!number) return json({ error: 'phone is required' }, 400)
  const name = typeof b.name === 'string' ? b.name.replace(/\s+/g, ' ').trim().slice(0, 60) : undefined
  const contact = await (await phone()).store.touchContact(number, { name: name || undefined, language: b.language === 'ar' ? 'ar' : b.language === 'en' ? 'en' : undefined })
  return json({ ok: true, linkedCodes: contact.codes.length })
}
