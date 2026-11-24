'use client'
import { useEffect, useState } from 'react'
import { Mark } from './Brand'
import Talk from './Talk'
import RobotConsole from './RobotConsole'

type View = 'talk' | 'robot'
const readHash = (): View => (typeof window !== 'undefined' && window.location.hash === '#robot' ? 'robot' : 'talk')

/**
 * One screen, no page scroll: a top bar and one of two views. Both stay mounted so a conversation or a robot
 * session is never interrupted by looking at the other tab. Only panels inside a view scroll.
 */
export default function AppShell() {
  const [view, setView] = useState<View>('talk')
  useEffect(() => {
    setView(readHash())
    const on = () => setView(readHash())
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  const go = (v: View) => { window.location.hash = v === 'robot' ? 'robot' : ''; setView(v) }

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <Mark className="brand-mark" />
          <div className="brand-text">
            <span className="brand-name">HALA <span lang="ar">هلا</span></span>
            <span className="brand-sub">Dubai Silicon Oasis · <span lang="ar">واحة دبي للسيليكون</span></span>
          </div>
        </div>
        <nav className="tabs-top" aria-label="Views">
          <button type="button" className={view === 'talk' ? 'toptab toptab-on' : 'toptab'} aria-current={view === 'talk' ? 'page' : undefined} onClick={() => go('talk')}>Talk</button>
          <button type="button" className={view === 'robot' ? 'toptab toptab-on' : 'toptab'} aria-current={view === 'robot' ? 'page' : undefined} onClick={() => go('robot')}>Robot</button>
        </nav>
        <p className="top-note" title="HALA is an AI assistant, not a person. Every fee, time and booking here is demonstration data.">
          <span className="chip chip-cyan">AI assistant</span> <span className="chip chip-line">Demo data</span>
        </p>
      </header>

      <div className="views">
        <div className="view" hidden={view !== 'talk'}><Talk /></div>
        <div className="view" hidden={view !== 'robot'}><RobotConsole active={view === 'robot'} /></div>
      </div>

      <footer className="foot">
        HALA is an AI assistant, not a person. Fees, times and bookings are demonstration values, not official DSO figures. Concept design for Voice of the Oasis.
        <span lang="ar" dir="rtl"> هلا مساعدة ذكاء اصطناعي. الرسوم والمدد والحجوزات قيم تجريبية.</span>
      </footer>
    </div>
  )
}
