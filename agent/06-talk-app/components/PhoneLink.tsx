'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

interface Issued { code: string; qr: string }

/**
 * Just the QR code. Scanning it with the iPhone camera opens HALA Phone on Messages with a one-time code
 * filled in; sending that text tells the server which phone is theirs. When it lands the QR gives way to a
 * check mark, then a fresh code is issued for the next visitor. No text on purpose: the robot page stays
 * about the conversation, and the code itself is inside the QR.
 */
export function PhoneLink() {
  const [issued, setIssued] = useState<Issued>()
  const [linked, setLinked] = useState(false)
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const issue = useCallback(async () => {
    try {
      const res = await fetch('/api/phone/codes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (!res.ok) throw new Error(String(res.status))
      setIssued((await res.json()) as Issued)
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => { void issue() }, [issue])

  // Watch for the text arriving. Cheap, and it works through any tunnel.
  useEffect(() => {
    if (!issued || linked) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/phone/codes?code=${issued.code}`, { cache: 'no-store' })
        if (((await res.json()) as { linked?: boolean }).linked) {
          setLinked(true)
          timer.current = setTimeout(() => { setLinked(false); setIssued(undefined); void issue() }, 5000)
        }
      } catch { /* try again on the next tick */ }
    }, 1500)
    return () => clearInterval(id)
  }, [issued, linked, issue])

  useEffect(() => () => clearTimeout(timer.current), [])

  return (
    <div className={`qr ${linked ? 'qr-linked' : ''}`} role="img" aria-label={linked ? 'Phone linked' : 'QR code to text HALA from your iPhone'}>
      {issued && !failed && (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="qr-img" src={issued.qr} alt="" width={176} height={176} draggable={false} />
      )}
      {!issued && !failed && <span className="qr-skeleton" aria-hidden="true" />}
      {failed && (
        <button type="button" className="qr-retry" onClick={() => void issue()} aria-label="Reload the QR code">↻</button>
      )}
      {linked && (
        <span className="qr-check" role="status" aria-live="polite">
          <svg viewBox="0 0 24 24" width="44" height="44" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      )}
    </div>
  )
}
