'use client'
import { useCallback, useEffect, useState } from 'react'
import type { QueueStatus, SmartPass } from '@hala/tools-api'
import { Mark } from './Brand'

type Lang = 'en' | 'ar'
interface Loaded { pass: SmartPass; queue?: QueueStatus }

const T = {
  org: { en: 'Dubai Silicon Oasis Authority', ar: 'هيئة واحة دبي للسيليكون' },
  title: { en: 'HALA Smart Reception Pass', ar: 'تصريح هلا الذكي للاستقبال' },
  date: { en: 'Date', ar: 'التاريخ' },
  time: { en: 'Time', ar: 'الوقت' },
  desk: { en: 'Desk', ar: 'المكتب' },
  team: { en: 'Handled by', ar: 'يتابعه' },
  holder: { en: 'For', ar: 'باسم' },
  ref: { en: 'Reference', ar: 'الرقم المرجعي' },
  queue: { en: 'Live queue', ar: 'الطابور الآن' },
  bring: { en: 'Bring with you', ar: 'ما تحتاج إحضاره' },
  ready: { en: 'ready', ar: 'جاهز' },
  calendar: { en: 'Add to Apple Calendar', ar: 'أضف إلى تقويم آبل' },
  calendarHint: { en: 'Opens in Calendar on iPhone and Mac. Works with Google and Outlook too.', ar: 'يفتح في التقويم على الآيفون والماك، ويعمل مع جوجل وأوتلوك.' },
  logged: { en: 'Logged', ar: 'تم التسجيل' },
  confirmed: { en: 'Confirmed', ar: 'مؤكد' },
  cancelled: { en: 'Cancelled', ar: 'ملغى' },
  issue: { en: 'What you reported', ar: 'ما أبلغت عنه' },
  followUp: { en: 'The DSO team will follow up. No time is promised.', ar: 'سيتابع فريق واحة دبي للسيليكون معك. لا نَعِد بوقت محدد.' },
  demo: { en: 'Demo data: the desk, the wait time and every fee are demonstration values, not official DSO figures. HALA is an AI assistant.', ar: 'بيانات تجريبية: المكتب ووقت الانتظار وكل الرسوم قيم تجريبية وليست أرقاماً رسمية. هلا مساعدة ذكاء اصطناعي.' },
  demoTag: { en: 'Demo estimate', ar: 'تقدير تجريبي' },
  min: { en: 'min', ar: 'دقيقة' },
  ahead: { en: 'ahead of you', ar: 'أمامك' },
  next: { en: 'You are next', ar: 'أنت التالي' }
} as const
const t = (k: keyof typeof T, lang: Lang) => T[k][lang]

/** The checklist is remembered on this phone only (localStorage), per pass. It works without it. */
const storeKey = (ref: string) => `hala-pass-${ref}`
function readTicks(ref: string): Record<number, boolean> {
  try { return JSON.parse(localStorage.getItem(storeKey(ref)) ?? '{}') as Record<number, boolean> } catch { return {} }
}

/**
 * The mobile pass a visitor gets by scanning the QR (or opening the text). Live queue, a tick-off document checklist,
 * and a calendar button. Mobile first, English and Arabic.
 */
export default function PassView({ initial, refId, token }: { initial: Loaded; refId: string; token: string }) {
  const [data, setData] = useState<Loaded>(initial)
  const [lang, setLang] = useState<Lang>(initial.pass.language)
  const [ticks, setTicks] = useState<Record<number, boolean>>({})
  const { pass, queue } = data
  const ar = lang === 'ar'

  useEffect(() => { setTicks(readTicks(refId)) }, [refId])

  // The queue moves: ask again every 15 s while the page is open (and when it comes back to the foreground).
  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/pass/${encodeURIComponent(refId)}?k=${encodeURIComponent(token)}`, { cache: 'no-store' })
      if (res.ok) setData((await res.json()) as Loaded)
    } catch { /* offline: keep what is on the screen */ }
  }, [refId, token])
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void refresh() }, 15_000)
    const on = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', on)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', on) }
  }, [refresh])

  const toggle = (i: number) => {
    const next = { ...ticks, [i]: !ticks[i] }
    setTicks(next)
    try { localStorage.setItem(storeKey(refId), JSON.stringify(next)) } catch { /* private mode: still works for this visit */ }
  }
  const done = pass.documents.filter((_, i) => ticks[i]).length
  const statusText = pass.status === 'cancelled' ? t('cancelled', lang) : pass.kind === 'request' ? t('logged', lang) : t('confirmed', lang)
  const calendarUrl = `/api/pass/${encodeURIComponent(refId)}/ics?k=${encodeURIComponent(token)}`

  return (
    <main className="mp" lang={lang} dir={ar ? 'rtl' : 'ltr'}>
      <header className="mp-top">
        <div className="mp-brand">
          <Mark className="mp-mark" />
          <div>
            <p className="mp-org">{t('org', lang)}</p>
            <h1 className="mp-title">{t('title', lang)}</h1>
          </div>
        </div>
        <button type="button" className="mp-lang" onClick={() => setLang(ar ? 'en' : 'ar')} aria-label={ar ? 'Switch to English' : 'التبديل إلى العربية'}>
          {ar ? 'EN' : 'عربي'}
        </button>
      </header>

      <section className={`mp-pass${pass.status === 'cancelled' ? ' mp-cancelled' : ''}`} aria-label={t('title', lang)}>
        <span className={`mp-status mp-status-${pass.status}`}>{statusText}</span>
        <h2 className="mp-service">{pass.service[lang]}</h2>
        <p className="mp-service-alt" lang={ar ? 'en' : 'ar'} dir={ar ? 'ltr' : 'rtl'}>{pass.service[ar ? 'en' : 'ar']}</p>

        <dl className="mp-facts">
          {pass.kind === 'appointment' && (
            <>
              <div><dt>{t('date', lang)}</dt><dd>{pass.dateLabel?.[lang]}</dd></div>
              <div><dt>{t('time', lang)}</dt><dd dir="ltr">{pass.timeLabel?.[lang]}</dd></div>
              {pass.desk && <div className="mp-wide"><dt>{t('desk', lang)}</dt><dd>{pass.desk.label[lang]}</dd></div>}
            </>
          )}
          {pass.kind === 'request' && pass.team && <div className="mp-wide"><dt>{t('team', lang)}</dt><dd>{pass.team[lang]}</dd></div>}
          {pass.holder && <div><dt>{t('holder', lang)}</dt><dd>{pass.holder}</dd></div>}
        </dl>

        <div className="mp-ref">
          <span>{t('ref', lang)}</span>
          <strong dir="ltr">{pass.ref}</strong>
        </div>
      </section>

      {queue && queue.state !== 'cancelled' && queue.state !== 'past' && (
        <section className="mp-card mp-queue" aria-label={t('queue', lang)} aria-live="polite">
          <div className="mp-card-head">
            <h3><span className="mp-live" aria-hidden="true" />{t('queue', lang)}</h3>
            <span className="mp-tag">{t('demoTag', lang)}</span>
          </div>
          <p className="mp-wait" dir="ltr"><strong>{queue.waitMinutes}</strong> {t('min', lang)}</p>
          <p className="mp-queue-label">{queue.label[lang]}</p>
          <div className="mp-dots" aria-hidden="true">
            {Array.from({ length: Math.min(queue.ahead, 6) }, (_, i) => <i key={i} />)}
            <i className="mp-me" />
          </div>
          <p className="mp-small">{queue.ahead === 0 ? t('next', lang) : `${queue.ahead} ${t('ahead', lang)}`}</p>
        </section>
      )}
      {queue && (queue.state === 'cancelled' || queue.state === 'past') && (
        <section className="mp-card"><p className="mp-queue-label">{queue.label[lang]}</p></section>
      )}

      {pass.kind === 'request' && pass.detail && (
        <section className="mp-card">
          <div className="mp-card-head"><h3>{t('issue', lang)}</h3></div>
          <p className="mp-detail" dir="auto">{pass.detail}</p>
          <p className="mp-small">{t('followUp', lang)}</p>
        </section>
      )}

      {pass.documents.length > 0 && (
        <section className="mp-card" aria-label={t('bring', lang)}>
          <div className="mp-card-head">
            <h3>{t('bring', lang)}</h3>
            <span className="mp-count" dir="ltr">{done}/{pass.documents.length} {t('ready', lang)}</span>
          </div>
          <div className="mp-bar" role="progressbar" aria-valuemin={0} aria-valuemax={pass.documents.length} aria-valuenow={done}>
            <i style={{ width: `${(done / pass.documents.length) * 100}%` }} />
          </div>
          <ul className="mp-checks">
            {pass.documents.map((d, i) => (
              <li key={d.en}>
                <label className={ticks[i] ? 'mp-check mp-check-on' : 'mp-check'}>
                  <input type="checkbox" checked={Boolean(ticks[i])} onChange={() => toggle(i)} />
                  <span className="mp-box" aria-hidden="true" />
                  <span className="mp-doc">{d[lang]}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
      )}

      {pass.kind === 'appointment' && pass.status !== 'cancelled' && (
        <section className="mp-cta">
          <a className="mp-btn" href={calendarUrl}>
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M7 2v3M17 2v3M3.5 9h17M5 4.5h14a1.5 1.5 0 0 1 1.5 1.5v13A1.5 1.5 0 0 1 19 20.5H5A1.5 1.5 0 0 1 3.5 19V6A1.5 1.5 0 0 1 5 4.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /><path d="M12 12.5v4M10 14.5h4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            {t('calendar', lang)}
          </a>
          <p className="mp-small">{t('calendarHint', lang)}</p>
        </section>
      )}

      <footer className="mp-foot">{t('demo', lang)}</footer>
    </main>
  )
}
