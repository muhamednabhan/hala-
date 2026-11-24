import QRCode from 'qrcode'
import { deepLink } from '@hala/phone'
import { phone, publicBase } from '@/lib/phone'

export const dynamic = 'force-dynamic'

/** GET /api/phone/qr?code=K7M2QX -> an SVG QR (DSO Midnight on white) that opens the HALA Phone app on Messages, pre-filled. */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get('code')?.toUpperCase() ?? ''
  if (!code || !(await (await phone()).store.getCode(code))) return new Response('unknown code', { status: 404 })
  const svg = await QRCode.toString(deepLink(code, publicBase(req)), { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#011530', light: '#ffffff' } })
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } })
}
