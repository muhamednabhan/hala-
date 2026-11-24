import type { Metadata } from 'next'
import RobotConsole from '@/components/RobotConsole'

export const metadata: Metadata = { title: 'HALA · Robot control' }

export default function Page() {
  return <RobotConsole />
}
