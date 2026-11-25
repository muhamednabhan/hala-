import { SERVICES } from '@hala/catalogue'
import { passFromBooking, passFromRequest, passUrl, queueStatus, verifyPassToken, type QueueStatus, type SmartPass } from '@hala/tools-api'
import { hala, setting } from './server'

/** HALA-1001 for an appointment, REQ-1001 for a logged request. Anything else is refused before it reaches the store. */
const REF = /^(HALA|REQ)-\d{3,6}$/

export interface LoadedPass {
  pass: SmartPass
  queue?: QueueStatus
}

/**
 * The pass behind a QR link. Needs the signed `k` the QR carries: references are sequential, so without the signature
 * anyone could walk through every pass. A wrong ref, a wrong signature and a missing pass all look the same (undefined).
 */
export async function loadPass(rawRef: string, token: string | null | undefined): Promise<LoadedPass | undefined> {
  const ref = rawRef.toUpperCase()
  if (!REF.test(ref)) return undefined
  const h = await hala()
  if (!verifyPassToken(ref, token, h.secret)) return undefined

  if (ref.startsWith('REQ-')) {
    const request = await h.stores.requests.get(ref)
    const pass = request ? passFromRequest(request, SERVICES) : undefined
    return pass ? { pass } : undefined
  }
  const booking = await h.stores.bookings.get(ref)
  const pass = booking ? passFromBooking(booking, SERVICES) : undefined
  if (!booking || !pass) return undefined
  // Who else is booked that day decides how many are ahead (only counts when the visit is today).
  const sameDay = (await h.stores.bookings.listByDate(booking.date)).filter((b) => b.ref !== booking.ref).map((b) => b.time)
  return { pass, queue: queueStatus({ pass, now: new Date(), sameDayTimes: sameDay }) }
}

/** The public origin for links: the tunnel when there is one, otherwise where this request came from. */
export const publicOrigin = (req: Request): string => (setting('PUBLIC_BASE_URL') ?? new URL(req.url).origin).replace(/\/$/, '')

/** The signed link to a pass on the public origin (what the QR and the text carry). */
export async function signedLink(req: Request, ref: string): Promise<string> {
  return passUrl(publicOrigin(req), ref, (await hala()).secret)
}
