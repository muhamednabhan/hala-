import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'HALA · Voice concierge',
  description: 'A bilingual (Arabic and English) voice concierge for Dubai Silicon Oasis. AI assistant. Demo data.'
}

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#0e6b5c' }

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
