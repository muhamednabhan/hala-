'use client'
import type { SmartPass as Pass } from '@hala/tools-api'
import { Mark } from './Brand'

/**
 * The DSO Smart Pass as it appears on the screen next to the robot the moment a booking or request is confirmed: it
 * grows out of the voice orb, glows, and carries a QR that opens the same pass on the visitor's phone.
 * Everything on it is demonstration data, and it says so.
 */
export function SmartPass({ pass, qr, sent, onClose }: { pass: Pass; qr?: string; sent: boolean; onClose?: () => void }) {
  const appt = pass.kind === 'appointment'
  return (
    <article className="pass" aria-label="DSO Smart Pass">
      <span className="pass-glow" aria-hidden="true" />
      {onClose && <button type="button" className="pass-close" onClick={onClose} aria-label="Close the pass">×</button>}

      <header className="pass-head">
        <Mark className="pass-mark" />
        <div>
          <p className="pass-org">Dubai Silicon Oasis Authority</p>
          <h2 className="pass-title">HALA Smart Reception Pass</h2>
        </div>
      </header>

      <div className="pass-body">
        <div className="pass-main">
          <p className="pass-service">{pass.service.en}</p>
          <p className="pass-service-ar" lang="ar" dir="rtl">{pass.service.ar}</p>
          <dl className="pass-facts">
            {appt && <div><dt>Date</dt><dd>{pass.dateLabel?.en}</dd></div>}
            {appt && <div><dt>Time</dt><dd>{pass.timeLabel?.en}</dd></div>}
            {appt && pass.desk && <div className="pass-wide"><dt>Desk</dt><dd>{pass.desk.label.en}</dd></div>}
            {!appt && pass.team && <div className="pass-wide"><dt>Handled by</dt><dd>{pass.team.en}</dd></div>}
          </dl>
          {appt && pass.desk && <p className="pass-desk-ar" lang="ar" dir="rtl">{pass.desk.label.ar}</p>}
          <p className="pass-ref" dir="ltr"><span>Reference</span>{pass.ref}</p>
        </div>

        {qr && (
          <div className="pass-qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code that opens your pass on your phone" width={132} height={132} draggable={false} />
            <p>Scan for your pass</p>
            <p lang="ar" dir="rtl">امسح للتصريح</p>
          </div>
        )}
      </div>

      <footer className="pass-foot">
        {sent && <span className="pass-sent" role="status">✓ Sent to your phone</span>}
        <span className="pass-demo">Demo data</span>
      </footer>
    </article>
  )
}

/**
 * The QR the agent asked for so the visitor can share a phone number without saying it. Scan, send the text that opens,
 * and it flips to a tick. Shown only while it is needed.
 */
export function PhoneRequest({ qr, code, linked }: { qr: string; code: string; linked?: string }) {
  return (
    <section className={linked ? 'phreq phreq-linked' : 'phreq'} aria-label="Share your phone number" aria-live="polite">
      <div className="phreq-qr">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} alt="" width={140} height={140} draggable={false} />
        {linked && (
          <span className="phreq-check" role="status">
            <svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </span>
        )}
      </div>
      <div className="phreq-text">
        {linked ? (
          <>
            <p className="phreq-title">Phone linked</p>
            <p className="phreq-sub" dir="ltr">{linked}</p>
            <p className="phreq-sub" lang="ar" dir="rtl">تم ربط هاتفك</p>
          </>
        ) : (
          <>
            <p className="phreq-title">Share your number</p>
            <p className="phreq-sub">Scan with your phone camera, then send the message that opens.</p>
            <p className="phreq-sub" lang="ar" dir="rtl">امسح الرمز ثم أرسل الرسالة التي تظهر.</p>
            <p className="phreq-code" dir="ltr" aria-label="Link code">{code}</p>
          </>
        )}
      </div>
    </section>
  )
}
