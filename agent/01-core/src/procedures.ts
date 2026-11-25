import { HANDOVER_REASONS } from './types'
import { SERVICE_HOURS, TRIAGE } from './guardrails'

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
  /** Web and robot only. When both are set, the caller's phone number comes from the QR on the screen. */
  requestPhoneLink?: string
  getLinkedPhone?: string
}

export function buildProcedures(t: ProcedureTools): ProcedureDef[] {
  const link = Boolean(t.requestPhoneLink && t.getLinkedPhone)
  // The number is never said aloud: a QR on the screen links the caller's phone, and the same link receives the Smart Pass.
  const linkStep = link
    ? `Call ${t.requestPhoneLink} now: a QR code appears on the screen. Ask them to scan it with their phone camera and send the text that opens, and keep asking the other questions while they do. Before you book, call ${t.getLinkedPhone} and use the contact it returns (never read it aloud). Not linked yet: wait a moment and try once more, then offer to take the number aloud.`
    : ''
  return [
    {
      id: 'understand_need',
      name: 'Understand what the caller needs',
      trigger: 'The caller mentions, asks about or describes a need for a DSO service (visa, licence, NOC, establishment card, access card, parking, leasing, residence, a maintenance problem) and has not asked for an appointment.',
      content: `Goal: help them properly first. An appointment comes only when they ask for one or say yes to your offer. Speak only the caller's language, never a mix.
- Answer what they asked in one or two sentences (no fee or time unless asked, at most three documents).
- Then ask ONE question about their situation per turn: who it is for (themselves, an employee, a family member), new or renewal, how urgent or when the current one expires, what they already have, which company or community, how many people. Skip what they already said. Never a list of questions.
- Use their answers to tailor what you say and to point out what they still need to prepare. Invent no rule.
- After two to four exchanges, or sooner if they sound ready, say in one sentence what you understood and offer ONCE: "Would you like me to book an appointment for that?" After a no or not yet, keep helping and do not offer again.
- Do not ask for a name, contact or day, and do not call ${t.listSlots}, until they say yes. Then the booking procedure takes over, and what you learned goes into the notes of the booking.`
    },
    {
      id: 'book_appointment',
      name: 'Book an appointment',
      trigger: 'The caller asks to book, arrange or schedule an appointment or a visit for a DSO service (visa, licence, NOC, establishment card, access card, leasing, a desk appointment), or says yes when you offered one. NOT when they only name a service or ask about it: talk first (see "Talk first, book later").',
      content: `Goal: one appointment, booked in as few turns as possible now that the caller wants it. Speak only the caller's language, never a mix.
1. Know the service from the conversation or the sheet. If it is still vague, ask ONE short question to choose.
2. Use what the caller already told you (who it is for, name, contact, day): never ask for it again. In ONE question, get only what is still missing: who it is for (the caller, or someone else and then that person's name), ${link ? 'and' : 'a phone number or email, and'} a day (or "as soon as possible").${link ? `
   ${linkStep}` : ''}
3. Call ${t.listSlots} with their words ("tomorrow", "Monday", "next_available"). Offer at most three times, spread across the day. Do not read more.
4. When they choose, read back once in one sentence (name, service, day, time, contact) and wait for a clear yes.
5. Call ${t.book}, with notes: one or two English sentences of what you learned in the conversation (company, headcount, urgency, documents they have, anything unusual). Then say the service, day, time and the reference digit by digit, and tell them to keep the reference. A Smart Pass with the details is now on the screen; if the tool says pass_sent is true, say it was also sent to their phone. You cannot send emails. Ask if there is anything else.
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
1. Ask for what is missing in as few questions as possible: name, ${link ? 'the contact (see the phone link step below)' : 'phone number'}, building or community and unit, and one sentence of detail. For maintenance also: the type (AC, plumbing, electrical, other) and whether it is an emergency or routine.${link ? `
   Phone link: ${linkStep}` : ''}
2. If it is really a dispute about a fee, charge, refund or waiver, do NOT log it: use the hand-over procedure with reason fee_dispute.
3. Read back once in one sentence and wait for a clear yes. Then call ${t.logRequest} (service maintenance or complaint; urgency emergency or routine for maintenance).
4. Give the reference digit by digit and say the DSO team will follow up (the pass on the screen carries the reference${link ? ', and it is texted to a linked phone' : ''}). Promise no time. If danger to people is involved, tell them to call 999 first.`
    },
    {
      id: 'handover',
      name: 'Hand over to a person',
      trigger: `The caller asks for a person or a manager, disputes or objects to a fee, asks for legal or tax advice, is angry or upset about a real problem, reports an emergency, or has a REAL DSO matter you cannot do or answer. Not for jokes, tests, nonsense, trivia or impossible requests: those are declined without a person.`,
      content: `Reasons for ${t.handover}: ${HANDOVER_REASONS.join(', ')}.
Decide at once, with no tool and no extra question, whether a person is worth it. A staff member's time is scarce.
- Hand over now: ${TRIAGE.handNow}.
- Offer a person (ask first, once): ${TRIAGE.offerFirst}.
- Decline it yourself, no person, no tool: ${TRIAGE.decline}. One short, light, friendly sentence, say what you can help with, carry on. Never log it.
- ${TRIAGE.test}
How to hand over:
- Emergency (danger, injury, fire, security): tell them to call 999 now, then call ${t.handover} straight away with what you know.
- Fee dispute, upset caller, or a request for a person: call ${t.handover} straight away. Stay calm; never argue, never promise a waiver, refund, callback time or outcome.
- A real DSO matter you cannot answer or do (out_of_scope, unknown_answer, legal): ask ONE question for the name${link ? '' : ', a phone number'} and, if it is about a place, where; then call ${t.handover} ONCE with all of that in the summary. Never call it twice for the same caller.
- Summary: one or two sentences in English for the person taking over: who, what they wanted, what you already did.
- After it: say once that you are passing it to the DSO team and what happens next, offer the phone line (600 59 55 57, Monday to Friday, 8 AM to 3 PM) if useful, then stop. Do not repeat the message. You cannot cancel a hand-over: if they change their mind, say you have noted it.`
    },
    {
      id: 'service_deep_dive',
      name: 'Explain a service step by step',
      trigger: 'The caller asks how a service process works step by step, who is eligible, or what happens after they apply, beyond the list of documents, fee and time.',
      content: `Call ${t.serviceProcess} with the service id from the sheet (use ${t.findService} only if the request matches no service on the sheet). Give the steps one or two at a time, in the caller's language, and ask if they want the next. Any fee or time is a demo value. Between steps, ask what matters about their situation (who it is for, how urgent, what they already have) and tailor the answer. When the steps are done, offer ONCE to book an appointment; if they say no or not yet, keep helping.`
    }
  ]
}
