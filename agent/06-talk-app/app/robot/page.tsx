import { redirect } from 'next/navigation'

/** The robot console is a view of the single page. Old links land there. */
export default function Page() {
  redirect('/#robot')
}
