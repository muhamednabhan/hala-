import type { Bilingual, Service } from '@hala/core'

/**
 * Which reception desk looks after a service. DEMONSTRATION values: the real desk layout of the HALA reception is not
 * published, so these are made up for the demo and the pass says so. One map, so the screen, the mobile pass and the text
 * message always agree. Appointments get a desk; tickets (maintenance, complaints) get a team instead.
 */
export interface Desk {
  /** Short code shown on the pass, e.g. "04". */
  code: string
  name: Bilingual
}

const d = (en: string, ar: string): Bilingual => ({ en, ar })

const DESKS: Record<string, Desk> = {
  visa: { code: '04', name: d('Visa Services', 'خدمات التأشيرات') },
  company: { code: '06', name: d('Business Licensing', 'التراخيص التجارية') },
  property: { code: '02', name: d('Leasing', 'التأجير') },
  access: { code: '01', name: d('Access Cards', 'بطاقات الدخول') },
  support: { code: '09', name: d('Resolution Desk', 'مكتب الحلول') }
}

/** Tickets are handled by a team, not at a desk. */
const TEAMS: Record<string, Bilingual> = {
  maintenance: d('Facilities team', 'فريق المرافق'),
  complaint: d('Customer Care team', 'فريق خدمة العملاء')
}

/** The desk for an appointment service, or undefined when the service is not booked at a desk. */
export function deskFor(service: Service): Desk | undefined {
  return service.fulfilment === 'appointment' ? DESKS[service.category] : undefined
}

/** The team that follows up a ticket (maintenance request, complaint). */
export const teamFor = (service: Service): Bilingual | undefined => (service.fulfilment === 'ticket' ? TEAMS[service.id] ?? d('DSO team', 'فريق واحة دبي للسيليكون') : undefined)

/** "Desk 04 · Visa Services" and its Arabic form. */
export const deskLabel = (desk: Desk): Bilingual => ({
  en: `Desk ${desk.code} · ${desk.name.en}`,
  ar: `مكتب ${desk.code} · ${desk.name.ar}`
})
