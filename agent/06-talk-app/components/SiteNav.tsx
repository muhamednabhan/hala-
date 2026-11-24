'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const LINKS = [
  { href: '/', label: 'Talk' },
  { href: '/robot', label: 'Robot' }
]

/** Top bar shared by every page: brand, two destinations, and the one honest reminder (AI, demo data). */
export function SiteNav() {
  const path = usePathname()
  return (
    <header className="nav">
      <Link href="/" className="brand" aria-label="HALA home">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">HALA</span>
        <span className="brand-ar" lang="ar">هلا</span>
      </Link>
      <nav aria-label="Main">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={path === l.href ? 'nav-link nav-on' : 'nav-link'} aria-current={path === l.href ? 'page' : undefined}>
            {l.label}
          </Link>
        ))}
      </nav>
      <p className="nav-note" title="HALA is an AI assistant, not a person. Every fee, time and booking here is demonstration data.">
        AI assistant · demo data
      </p>
    </header>
  )
}
