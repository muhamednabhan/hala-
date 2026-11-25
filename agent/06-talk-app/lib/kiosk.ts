import type { HalaEvent } from '@hala/core'
import type { SmartPass } from '@hala/tools-api'

/**
 * What the screen next to the robot shows, worked out from the conversation's events alone (no extra state to get out of
 * step with the server):
 *  - a Smart Pass after a booking or a logged request, updated on a reschedule, gone on a cancel;
 *  - the phone-link QR from the moment the agent asks for a number until the visitor's text arrives.
 */
export interface KioskState {
  pass?: { pass: SmartPass; url: string; sent: boolean }
  /** The QR the agent asked for. Present until the conversation ends. */
  linkRequest?: { code: string; qr: string }
  /** The visitor texted the code: masked number. */
  linked?: { phone: string }
}

const isPass = (v: unknown): v is SmartPass => Boolean(v) && typeof v === 'object' && typeof (v as SmartPass).ref === 'string' && Boolean((v as SmartPass).service)

export function deriveKiosk(events: HalaEvent[]): KioskState {
  const k: KioskState = {}
  for (const e of events) {
    const d = e.data
    switch (e.type) {
      case 'phone_requested':
        if (typeof d.code === 'string' && typeof d.qr === 'string') {
          // asking again shows the same code; a new code starts over
          if (k.linkRequest?.code !== d.code) { k.linkRequest = { code: d.code, qr: d.qr }; k.linked = undefined }
        }
        break
      case 'phone_linked':
        k.linked = { phone: String(d.phone ?? '') }
        break
      case 'booking_created':
      case 'request_logged':
      case 'booking_rescheduled':
        if (isPass(d.pass)) {
          // a retried tool call (duplicate) must not replay the animation or reset the sent tick
          const same = k.pass?.pass.ref === d.pass.ref
          if (d.duplicate === true && same) break
          k.pass = { pass: d.pass, url: String(d.pass_url ?? ''), sent: same ? k.pass!.sent : d.pass_sent === true }
        }
        break
      case 'pass_sent':
        if (k.pass && d.ref === k.pass.pass.ref) k.pass = { ...k.pass, sent: true }
        break
      case 'booking_cancelled':
        if (k.pass && d.ref === k.pass.pass.ref) k.pass = undefined
        break
    }
  }
  return k
}

/** The QR image for a pass: the signed link's `k` is what authorises it. */
export function passQrSrc(ref: string, url: string): string | undefined {
  try {
    const k = new URL(url).searchParams.get('k')
    return k ? `/api/pass/${encodeURIComponent(ref)}/qr?k=${encodeURIComponent(k)}` : undefined
  } catch { return undefined }
}
