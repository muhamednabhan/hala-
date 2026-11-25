import QRCode from 'qrcode'
import { json } from '@/lib/server'
import { loadPass, signedLink } from '@/lib/pass'

export const dynamic = 'force-dynamic'

/** GET /api/pass/HALA-1001/qr?k=...  An SVG QR (DSO Midnight on white) that opens the mobile pass on the phone that scans it. */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const { ref } = await ctx.params
  const found = await loadPass(ref, new URL(req.url).searchParams.get('k'))
  if (!found) return json({ error: 'not found' }, 404)
  const svg = await QRCode.toString(await signedLink(req, found.pass.ref), { type: 'svg', margin: 0, errorCorrectionLevel: 'M', color: { dark: '#011530', light: '#ffffff' } })
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } })
}
