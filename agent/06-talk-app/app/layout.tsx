import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, Noto_Sans_Arabic, Oxygen } from 'next/font/google'
import './globals.css'

// Typography from the DSO guide: Barlow Condensed for headings, Oxygen for body. Noto Sans Arabic covers Arabic text.
const head = Barlow_Condensed({ subsets: ['latin'], weight: ['500', '600', '700'], variable: '--font-head', display: 'swap' })
const body = Oxygen({ subsets: ['latin'], weight: ['300', '400', '700'], variable: '--font-body', display: 'swap' })
const arabic = Noto_Sans_Arabic({ subsets: ['arabic'], weight: ['400', '600'], variable: '--font-arabic', display: 'swap' })

export const metadata: Metadata = {
  title: 'HALA · Voice concierge · Dubai Silicon Oasis',
  description: 'A bilingual (Arabic and English) voice concierge for Dubai Silicon Oasis. AI assistant. Demo data.'
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#011530' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${head.variable} ${body.variable} ${arabic.variable}`}>
      <body>{children}</body>
    </html>
  )
}
