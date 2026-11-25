import type { Metadata } from 'next'
import { Mark } from '@/components/Brand'
import PassView from '@/components/PassView'
import { loadPass } from '@/lib/pass'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'HALA Smart Pass · Dubai Silicon Oasis',
  description: 'Your HALA Smart Reception Pass: live queue, documents checklist and calendar. Demo data.',
  robots: { index: false, follow: false }
}

/**
 * /pass/HALA-1001?k=...  What the QR on the screen next to the robot opens. The signature `k` is part of the link: without a
 * valid one this shows nothing about any pass (references are sequential, so they must not be browsable).
 */
export default async function PassPage({ params, searchParams }: { params: Promise<{ ref: string }>; searchParams: Promise<{ k?: string | string[] }> }) {
  const { ref } = await params
  const { k } = await searchParams
  const token = typeof k === 'string' ? k : ''
  const found = await loadPass(ref, token)
  if (!found) {
    return (
      <main className="mp mp-empty">
        <Mark className="mp-mark" />
        <h1>This pass link is not valid</h1>
        <p>Scan the QR code on the HALA screen again, or open the text HALA sent you.</p>
        <p lang="ar" dir="rtl">رابط التصريح غير صالح. امسح رمز الاستجابة السريعة على شاشة هلا مرة أخرى.</p>
      </main>
    )
  }
  return <PassView initial={JSON.parse(JSON.stringify(found))} refId={found.pass.ref} token={token} />
}
