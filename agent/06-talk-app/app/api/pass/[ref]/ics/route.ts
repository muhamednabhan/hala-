import { buildIcs } from '@hala/tools-api'
import { json } from '@/lib/server'
import { loadPass, signedLink } from '@/lib/pass'

export const dynamic = 'force-dynamic'

/**
 * GET /api/pass/HALA-1001/ics?k=...  The appointment as a calendar file. iPhone and Mac open it straight into Calendar
 * ("Add to Calendar"); Google and Outlook import it. Tickets have no time, so no file.
 */
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const { ref } = await ctx.params
  const found = await loadPass(ref, new URL(req.url).searchParams.get('k'))
  if (!found) return json({ error: 'not found' }, 404)
  const ics = buildIcs(found.pass, { now: new Date(), url: await signedLink(req, found.pass.ref) })
  if (!ics) return json({ error: 'this pass has no appointment time' }, 404)
  return new Response(ics, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': `inline; filename="${found.pass.ref}.ics"`,
      'cache-control': 'no-store'
    }
  })
}
