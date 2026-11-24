'use client'
import { ConversationProvider } from '@elevenlabs/react'
import { useEffect, useRef, useState } from 'react'
import { useHala, type LanguagePref } from '@/lib/use-hala'
import { EventCard } from './EventCard'

const LANGS: { id: LanguagePref; label: string; hint: string }[] = [
  { id: 'auto', label: 'EN · عربي', hint: 'Greets in both, follows you' },
  { id: 'en', label: 'English', hint: 'Start in English' },
  { id: 'ar', label: 'العربية', hint: 'ابدأ بالعربية' }
]

/** The orb breathes with the agent's voice. Reads the output level every frame, no React re-render. */
function Orb({ live, mode, level }: { live: boolean; mode: string; level: () => number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const v = live ? Math.min(1, level()) : 0
      ref.current?.style.setProperty('--level', v.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [live, level])
  return (
    <div ref={ref} className={`orb ${live ? `orb-${mode}` : 'orb-idle'}`} aria-hidden="true">
      <span /><span /><span />
    </div>
  )
}

function Panel() {
  const hala = useHala()
  const [pref, setPref] = useState<LanguagePref>('auto')
  const logEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { logEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [hala.lines.length])

  const connecting = hala.starting || hala.status === 'connecting'
  const label = hala.live ? (hala.mode === 'speaking' ? 'HALA is speaking' : 'Listening') : connecting ? 'Connecting' : 'Ready'
  const labelAr = hala.live ? (hala.mode === 'speaking' ? 'هلا تتحدث' : 'أستمع إليك') : connecting ? 'جارٍ الاتصال' : 'جاهزة'

  return (
    <main className="shell">
      <header className="top">
        <div className="brand">
          <span className="brand-name">HALA</span>
          <span className="brand-ar" lang="ar">هلا</span>
          <span className="brand-sub">Dubai Silicon Oasis · Voice concierge</span>
        </div>
        <div className="badges">
          <span className="badge badge-ai" title="HALA is an AI assistant, not a person">AI assistant · مساعد ذكاء اصطناعي</span>
          <span className="badge badge-demo" title="Every fee, time and booking here is demonstration data">Demo data · بيانات تجريبية</span>
        </div>
      </header>

      <section className="stage" aria-label="Voice conversation">
        <Orb live={hala.live} mode={hala.mode} level={hala.getOutputVolume} />
        <p className="state" aria-live="polite">
          <span>{label}</span>
          <span className="state-ar" lang="ar">{labelAr}</span>
        </p>

        <div className="lang" role="radiogroup" aria-label="Language">
          {LANGS.map((l) => (
            <button
              key={l.id} type="button" role="radio" aria-checked={pref === l.id} title={l.hint}
              className={pref === l.id ? 'seg seg-on' : 'seg'} disabled={hala.live || connecting}
              onClick={() => setPref(l.id)}
            >{l.label}</button>
          ))}
        </div>

        <div className="controls">
          {hala.live ? (
            <>
              <button type="button" className="btn btn-end" onClick={() => hala.stop()}>End conversation</button>
              <button type="button" className="btn btn-ghost" aria-pressed={hala.isMuted} onClick={() => hala.setMuted(!hala.isMuted)}>
                {hala.isMuted ? 'Unmute mic' : 'Mute mic'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-start" disabled={connecting} onClick={() => void hala.start(pref)}>
              {connecting ? 'Connecting…' : 'Start talking · ابدأ'}
            </button>
          )}
        </div>

        {hala.error && <p className="alert" role="alert">{hala.error}</p>}
        {hala.toolProblem && (
          <p className="alert alert-warn" role="status">
            A step could not reach our server. Check that the tunnel is running and the agent was synced (npm run agent:sync).
          </p>
        )}
        <p className="fineprint">Say &ldquo;Hello&rdquo; or «مرحبا». You can switch language at any time.</p>
      </section>

      <section className="log" aria-label="Transcript">
        <h2>Conversation <span lang="ar">المحادثة</span></h2>
        <div className="log-body" aria-live="polite">
          {hala.lines.length === 0 && <p className="empty">The transcript appears here.</p>}
          {hala.lines.map((l) => (
            <p key={l.id} className={`line line-${l.role}`} dir="auto">
              <span className="who">{l.role === 'agent' ? 'HALA' : 'You'}</span>
              {l.text}
            </p>
          ))}
          <div ref={logEnd} />
        </div>
      </section>

      <aside className="activity" aria-label="What HALA did">
        <h2>What HALA did <span lang="ar">ما فعلته هلا</span></h2>
        {hala.events.length === 0
          ? <p className="empty">Bookings, requests and hand-overs show up here as they happen.</p>
          : <ol className="events">{[...hala.events].reverse().map((e) => <EventCard key={e.id} event={e} />)}</ol>}
      </aside>

      <footer className="foot">
        HALA is an AI assistant. Fees, processing times and bookings shown here are demonstration values, not official DSO figures.
        <span lang="ar" dir="rtl"> هلا مساعدة ذكاء اصطناعي. الرسوم والمدد والحجوزات المعروضة قيم تجريبية وليست أرقاماً رسمية.</span>
      </footer>
    </main>
  )
}

export default function Talk() {
  return (
    <ConversationProvider>
      <Panel />
    </ConversationProvider>
  )
}
