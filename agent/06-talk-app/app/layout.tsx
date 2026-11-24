import type { Metadata, Viewport } from 'next'
import { SiteNav } from '@/components/SiteNav'
import './globals.css'

export const metadata: Metadata = {
  title: 'HALA · Voice concierge',
  description: 'A bilingual (Arabic and English) voice concierge for Dubai Silicon Oasis. AI assistant. Demo data.'
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#f6f4ef' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteNav />
        {children}
      </body>
    </html>
  )
}
