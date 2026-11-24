'use client'
import { useCallback, useEffect, useRef, useState } from 'react'

interface Issued { code: string; qr: string }

/**
 * "Text HALA from your phone": a QR code that opens the HALA Phone app on its Messages tab with a
 * one-time code pre-filled. When the visitor sends that text, the server learns which phone is theirs
 * (so nobody has to say a number out loud), and this card flips to "linked". Then it issues a fresh
 * code for the next visitor.
 */
export function PhoneLink() {
  const [issued, setIssued] = useState<Issued>()
  const [linkedAs, setLinkedAs] = useState<string>()
  const [failed, setFailed] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const issue = useCallback(async () => {
    try {
      const res = await fetch('/api/phone/codes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as Issued
      setIssued({ code: body.code, qr: body.qr })
      setFailed(false)
    } catch {
      setFailed(true)
    }
  }, [])

  useEffect(() => { void issue() }, [issue])

  // Poll for the text arriving. Cheap, and works through any tunnel.
  useEffect(() => {
    if (!issued || linkedAs) return
    const id = setInterval(async () => {
      try {
        const res = await fetch(`/api/phone/codes?code=${issued.code}`, { cache: 'no-store' })
        const body = (await res.json()) as { linked?: boolean; phone?: string }
        if (body.linked) {
          setLinkedAs(body.phone ?? 'your phone')
          timer.current = setTimeout(() => { setLinkedAs(undefined); setIssued(undefined); void issue() }, 8000)
        }
      } catch { /* try again on the next tick */ }
    }, 2000)
    return () => clearInterval(id)
  }, [issued, linkedAs, issue])

  useEffect(() => () => clearTimeout(timer.current), [])

  const spaced = issued ? `${issued.code.slice(0, 3)} ${issued.code.slice(3)}` : ''

  return (
    <section className="phonelink" aria-label="Text HALA from your phone">
      {linkedAs ? (
        <p className="phonelink-ok" role="status">Phone linked · {linkedAs}<span lang="ar"> · تم ربط هاتفك</span></p>
      ) : failed ? (
        <button type="button" className="btn btn-ghost" onClick={() => void issue()}>Show the phone QR again</button>
      ) : issued ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="phonelink-qr" src={issued.qr} alt={`QR code to text HALA. Your code is ${spaced}`} width={132} height={132} />
          <div className="phonelink-copy">
            <strong>Text HALA from your iPhone</strong>
            <span>Scan with the camera. Your code <b dir="ltr">{spaced}</b> is filled in for you. You never have to say your number.</span>
            <span lang="ar" dir="rtl">امسح الرمز لمراسلة هلا من هاتفك.</span>
          </div>
        </>
      ) : (
        <p className="empty">Getting a code…</p>
      )}
    </section>
  )
}
