'use client'
import { ConversationProvider } from '@elevenlabs/react'
import { useEffect, useRef, useState } from 'react'
import { useHala, type LanguagePref } from '@/lib/use-hala'
import { EventCard } from './EventCard'
import { Link } from './Brand'

const LANGS: { id: LanguagePref; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Greets in both languages and follows you' },
  { id: 'en', label: 'English', hint: 'Start in English' },
  { id: 'ar', label: 'العربية', hint: 'ابدأ بالعربية' }
]

/** A soft orb that swells with the agent's voice. Reads the output level every frame without re-rendering React. */
function Orb({ live, mode, level }: { live: boolean; mode: string; level: () => number }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      ref.current?.style.setProperty('--level', (live ? Math.min(1, level()) : 0).toFixed(3))
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
  const [tab, setTab] = useState<'chat' | 'activity'>('chat')
  const [seen, setSeen] = useState(0)
  const logEnd = useRef<HTMLDivElement>(null)
  useEffect(() => { logEnd.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [hala.lines.length, tab])
  useEffect(() => { if (tab === 'activity') setSeen(hala.events.length) }, [tab, hala.events.length])

  const connecting = hala.starting || hala.status === 'connecting'
  const headline = hala.live ? (hala.mode === 'speaking' ? 'HALA is speaking' : 'Listening') : connecting ? 'Connecting' : 'Ready when you are'
  const headlineAr = hala.live ? (hala.mode === 'speaking' ? 'هلا تتحدث' : 'أستمع إليك') : connecting ? 'جارٍ الاتصال' : 'جاهزة عندما تكون جاهزاً'
  const unseen = tab === 'activity' ? 0 : hala.events.length - seen
  // Where the conversation is, read from what actually happened (not guessed from the voice).
  const types = new Set(hala.events.map((e) => e.type))
  const progress = !hala.live ? -1
    : ['booking_created', 'booking_rescheduled', 'booking_cancelled', 'request_logged', 'handover_requested'].some((t) => types.has(t as never)) ? 3
    : types.has('service_matched') || types.has('slots_listed') ? 2
    : hala.lines.some((l) => l.role === 'user') ? 1 : 0

  return (
    <div className="talk">
      <section className="card stage dark" aria-label="Voice conversation">
        <Orb live={hala.live} mode={hala.mode} level={hala.getOutputVolume} />
        <div className="state" aria-live="polite">
          <p className="state-main">{headline}</p>
          <p className="state-ar" lang="ar">{headlineAr}</p>
        </div>

        <Link steps={['Greet', 'Understand', 'Resolve', 'Confirm']} active={progress} label="Conversation progress" />

        <div className="seg-group" role="radiogroup" aria-label="Language">
          {LANGS.map((l) => (
            <button
              key={l.id} type="button" role="radio" aria-checked={pref === l.id} title={l.hint}
              className={pref === l.id ? 'seg seg-on' : 'seg'} disabled={hala.live || connecting}
              onClick={() => setPref(l.id)}
            >{l.label}</button>
          ))}
        </div>

        <div className="actions">
          {hala.live ? (
            <>
              <button type="button" className="btn btn-end" onClick={() => hala.stop()}>End conversation</button>
              <button type="button" className="btn btn-ghost" aria-pressed={hala.isMuted} onClick={() => hala.setMuted(!hala.isMuted)}>
                {hala.isMuted ? 'Unmute' : 'Mute'}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary" disabled={connecting} onClick={() => void hala.start(pref)}>
              {connecting ? 'Connecting…' : 'Start talking'}
            </button>
          )}
        </div>

        {hala.error && <p className="notice notice-bad" role="alert">{hala.error}</p>}
        {hala.toolProblem && (
          <p className="notice notice-warn" role="status">
            One step could not reach our server. Check the connection and that the agent was synced.
          </p>
        )}
        <p className="hint">Say “Hello” or «مرحبا». Switch language whenever you like.</p>
      </section>

      <section className="card feed" aria-label="Conversation and activity">
        <div className="tabs" role="tablist">
          <button type="button" role="tab" id="tab-chat" aria-selected={tab === 'chat'} aria-controls="panel-chat" className={tab === 'chat' ? 'tab tab-on' : 'tab'} onClick={() => setTab('chat')}>
            Conversation
          </button>
          <button type="button" role="tab" id="tab-activity" aria-selected={tab === 'activity'} aria-controls="panel-activity" className={tab === 'activity' ? 'tab tab-on' : 'tab'} onClick={() => setTab('activity')}>
            What HALA did{unseen > 0 && <span className="dot" aria-label={`${unseen} new`}>{unseen}</span>}
          </button>
        </div>

        {tab === 'chat' ? (
          <div role="tabpanel" id="panel-chat" aria-labelledby="tab-chat" className="panel" aria-live="polite">
            {hala.lines.length === 0 && (
              <div className="starter">
                <p className="eyebrow">Try asking</p>
                <ul className="chips">
                  {['Renew an employee visa', 'Book a no objection certificate', 'Which licence fits a software company?', 'How do I get an access card?', 'My AC is broken', 'Where is the e-wallet machine?'].map((q) => <li key={q} className="chip">{q}</li>)}
                </ul>
                <ul className="chips" lang="ar" dir="rtl">
                  {['أريد تجديد تأشيرة موظف', 'أحتاج شهادة عدم ممانعة', 'المكيف خربان', 'أين جهاز إيداع المحفظة؟'].map((q) => <li key={q} className="chip">{q}</li>)}
                </ul>
                <p className="hint">Your conversation appears here once you start.</p>
              </div>
            )}
            {hala.lines.map((l) => (
              <p key={l.id} className={`bubble bubble-${l.role}`} dir="auto">
                <span className="who">{l.role === 'agent' ? 'HALA' : 'You'}</span>
                {l.text}
              </p>
            ))}
            <div ref={logEnd} />
          </div>
        ) : (
          <div role="tabpanel" id="panel-activity" aria-labelledby="tab-activity" className="panel">
            {hala.events.length === 0
              ? <p className="empty">Bookings, requests and hand-overs show up here as they happen.</p>
              : <ol className="events">{[...hala.events].reverse().map((e) => <EventCard key={e.id} event={e} />)}</ol>}
          </div>
        )}
      </section>

    </div>
  )
}

export default function Talk() {
  return (
    <ConversationProvider>
      <Panel />
    </ConversationProvider>
  )
}
