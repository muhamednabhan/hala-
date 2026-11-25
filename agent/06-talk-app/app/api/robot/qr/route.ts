import QRCode from 'qrcode'
import { json } from '@/lib/server'
import { robotFromRequest } from '@/lib/robot-auth'

export const dynamic = 'force-dynamic'

/**
 * POST /api/robot/qr  { text }  ->  { size, rows }   (robot token required)
 * The QR as a grid of "0" and "1" characters. The bridge turns it into a video frame itself (no image library on the robot),
 * because the robot's screen can only play video.
 */
export async function POST(req: Request) {
  const auth = await robotFromRequest(req)
  if ('error' in auth) return auth.error
  const body = (await req.json().catch(() => ({}))) as { text?: unknown }
  if (typeof body.text !== 'string' || !body.text || body.text.length > 400) return json({ error: 'text is required (up to 400 characters)' }, 400)
  const { modules } = QRCode.create(body.text, { errorCorrectionLevel: 'M' })
  const size = modules.size
  const rows: string[] = []
  for (let y = 0; y < size; y++) {
    let row = ''
    for (let x = 0; x < size; x++) row += modules.get(y, x) ? '1' : '0'
    rows.push(row)
  }
  return json({ size, rows })
}
