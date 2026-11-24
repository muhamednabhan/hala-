import { HANDOVER_REASONS } from './types'
import { SERVICE_HOURS } from './guardrails'

/**
 * HALA's conversation flows as ElevenLabs "procedures": each is loaded only when its trigger matches, so the base prompt
 * stays short (cheaper and faster per turn) and the agent follows one flow at a time instead of all of them at once.
 *
 * Free-form (not structured) on purpose: the caller can wander, switch language or change their mind mid-flow, and
 * structured procedures cannot use the knowledge base or adapt wording.
 */
export interface ProcedureDef {
  id: string
  name: string
  /** When it applies. This is the ONLY thing the model sees before the procedure loads, so it must be precise. */
  trigger: string
  content: string
}

export interface ProcedureTools {
  findService: string
  serviceProcess: string
  listSlots: string
  book: string
  reschedule: string
  cancel: string
  checkBooking: string
  checkRequest: string
  logRequest: string
  handover: string
}

export function buildProcedures(t: ProcedureTools): ProcedureDef[] {
  return [
    {
      id: 'book_appointment',
      name: 'Book an appointment',
      trigger: 'The caller wants to book, arrange or schedule an appointment or a visit for a DSO service (visa, licence, NOC, establishment card, access card, leasing, a desk appointment).',
      content: `Goal: one appointment, booked in as few turns as possible.
1. Know the service from the sheet. If the request is vague, ask ONE short question to choose.
2. In ONE question, get what is missing: who it is for (the caller, or someone else and then that person's name), a phone number or email, and a day (or "as soon as possible").
3. Call ${t.listSlots} with their words ("tomorrow", "Monday", "next_available"). Offer at most three times, spread across the day. Do not read more.
4. When they choose, read back once in one sentence (name, service, day, time, contact) and wait for a clear yes.
5. Call ${t.book}. Then say the service, day, time and the reference digit by digit, and tell them to keep the reference. You cannot send a message or email. Ask if there is anything else.
- If a slot fails, offer the alternatives the tool returns. Never work out dates yourself. Appointments are ${SERVICE_HOURS.days}, ${SERVICE_HOURS.open} to ${SERVICE_HOURS.close} Dubai time, last slot 14:30.
- Maintenance and complaints are tickets, not appointments: use the ticket procedure.`
    },
    {
      id: 'change_or_check',
      name: 'Change, cancel or check a booking or request',
      trigger: 'The caller wants to change, move, cancel or check an existing appointment or logged request, or reads out a reference number (HALA-1234 or REQ-1234).',
      content: `Ask for the reference (digits are enough).
- Check an appointment: call ${t.checkBooking}. Check a logged request: call ${t.checkRequest}. Read the details back in one sentence. Request status is not tracked: say the DSO team will follow up and offer a person for updates.
- Move an appointment: ask for the new day, call ${t.listSlots}, offer at most three times, read back once ("from ... to ...") and wait for a clear yes, then call ${t.reschedule}.
- Cancel: read back which appointment, wait for a clear yes, then call ${t.cancel} and confirm. Offer to book a new time.
- Not found: ask them to check the number once, then offer a person.`
    },
    {
      id: 'maintenance_or_complaint',
      name: 'Log a maintenance request or complaint',
      trigger: 'The caller reports something broken or a problem in a building, villa, office or common area (AC, leak, lift, electricity, noise, parking), or wants to file a complaint or give feedback.',
      content: `Goal: log one ticket quickly.
1. Ask for what is missing in as few questions as possible: name, phone number, building or community and unit, and one sentence of detail. For maintenance also: the type (AC, plumbing, electrical, other) and whether it is an emergency or routine.
2. If it is really a dispute about a fee, charge, refund or waiver, do NOT log it: use the hand-over procedure with reason fee_dispute.
3. Read back once in one sentence and wait for a clear yes. Then call ${t.logRequest} (service maintenance or complaint; urgency emergency or routine for maintenance).
4. Give the reference digit by digit and say the DSO team will follow up. Promise no time. If danger to people is involved, tell them to call 999 first.`
    },
    {
      id: 'handover',
      name: 'Hand over to a person',
      trigger: `The caller asks for a person or a manager, disputes or objects to a fee, asks for legal or tax advice, is angry or upset, reports an emergency, asks for something outside DSO services, or you do not know the answer and could not find it.`,
      content: `Reasons for ${t.handover}: ${HANDOVER_REASONS.join(', ')}.
- Emergency (danger, injury, fire, security): tell them to call 999 now, then call ${t.handover} straight away with what you know.
- Fee dispute, upset caller, or a request for a person: call ${t.handover} straight away. Stay calm; never argue, never promise a waiver, refund, callback time or outcome.
- Anything else (out of scope, you do not know, legal): ask ONE question for the name, a phone number and, if it is about a place, where; then call ${t.handover} ONCE with all of that in the summary. Never call it twice for the same caller.
- Summary: one or two sentences in English for the person taking over: who, what they wanted, what you already did.
- After it: say once that you are passing it to the DSO team and what happens next, offer the phone line (600 59 55 57, Monday to Friday, 8 AM to 3 PM) if useful, then stop. Do not repeat the message. You cannot cancel a hand-over: if they change their mind, say you have noted it.`
    },
    {
      id: 'service_deep_dive',
      name: 'Explain a service step by step',
      trigger: 'The caller asks how a service process works step by step, who is eligible, or what happens after they apply, beyond the list of documents, fee and time.',
      content: `Call ${t.serviceProcess} with the service id from the sheet (use ${t.findService} only if the request matches no service on the sheet). Give the steps one or two at a time, in the caller's language, and ask if they want the next. Any fee or time is a demo value. Offer to book an appointment when the steps are done.`
    }
  ]
}
