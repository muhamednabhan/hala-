import { deepLink, smsBodyFor, maskPhone } from '@hala/phone'
import { json } from '@/lib/server'
import { phone, publicBase } from '@/lib/phone'
import { clientKey, createRateLimiter } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'
const allow = createRateLimiter(30, 60_000)

/**
 * POST /api/phone/codes   -> a fresh link code for the QR on the robot's screen.
 *   { code, link, smsBody, qr }  `link` is what the QR encodes: halaphone://link?code=..&server=..
 * GET  /api/phone/codes?code=X -> has somebody texted it yet? { linked, phone? (masked) }
 */
export async function POST(req: Request) {
  if (!allow(clientKey(req))) return json({ error: 'Too many requests.' }, 429)
  const body = (await req.json().catch(() => ({}))) as { conversation_id?: unknown }
  const { store } = await phone()
  const { code } = await store.issueCode({ conversationId: typeof body.conversation_id === 'string' ? body.conversation_id : undefined })
  return json({ code, link: deepLink(code, publicBase(req)), smsBody: smsBodyFor(code), qr: `/api/phone/qr?code=${code}` })
}

export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code')?.toUpperCase() ?? ''
  const record = code ? await (await phone()).store.getCode(code) : undefined
  if (!record) return json({ error: 'unknown code' }, 404)
  return json({ linked: Boolean(record.phone), ...(record.phone ? { phone: maskPhone(record.phone) } : {}) })
}
