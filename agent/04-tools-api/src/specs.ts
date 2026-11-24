import { HANDOVER_REASONS } from '@hala/core'

/**
 * Tool contracts: the single source of truth for what the agent can do.
 * 04-tools-api implements them; 05-provisioning turns them into ElevenLabs webhook tools;
 * 01-core's prompt refers to them by name. Descriptions are written for the LLM: they say WHEN
 * to call the tool, not just what it does.
 */
export interface ParamSpec {
  type: 'string' | 'boolean'
  description: string
  enum?: readonly string[]
  optional?: boolean
}

export interface ToolSpec {
  name: string
  description: string
  params: Record<string, ParamSpec>
  /** Seconds ElevenLabs waits for our answer. */
  timeoutSecs: number
  /** Whether the agent should say something before the call ("one moment"). */
  preSpeech: 'auto' | 'force' | 'off'
}

const language: ParamSpec = {
  type: 'string', enum: ['en', 'ar'],
  description: 'The language the caller is speaking right now: en for English, ar for Arabic.'
}

export const TOOL_NAMES = {
  findService: 'find_service',
  listSlots: 'list_slots',
  book: 'book_appointment',
  reschedule: 'reschedule_appointment',
  cancel: 'cancel_appointment',
  checkBooking: 'check_booking',
  logRequest: 'log_request',
  lookupFact: 'lookup_fact',
  handover: 'handover_to_human'
} as const

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: TOOL_NAMES.findService,
    description:
      'Identify which DSO service the caller needs and get its documents, demo fee and demo processing time. ' +
      'Call this BEFORE describing any service, fee or document, and whenever the caller changes topic. ' +
      'Pass what the caller said in their own words, in the language they used.',
    params: { query: { type: 'string', description: "The caller's request, as they said it, e.g. 'renew an employee visa' or 'المكيف خربان'." } },
    timeoutSecs: 8, preSpeech: 'off'
  },
  {
    name: TOOL_NAMES.listSlots,
    description:
      'List free appointment slots for a day. The server owns the calendar, so never work out dates yourself: ' +
      "pass 'today', 'tomorrow', a weekday name such as 'thursday', an ISO date YYYY-MM-DD, or 'next_available' for the soonest openings. " +
      'Call this before offering any time to the caller.',
    params: { when: { type: 'string', description: "'today', 'tomorrow', a weekday in English, a YYYY-MM-DD date, or 'next_available'." } },
    timeoutSecs: 8, preSpeech: 'force'
  },
  {
    name: TOOL_NAMES.book,
    description:
      'Book an appointment. Only call after you have read the details back and the caller clearly said yes. ' +
      'Use the exact date and time values returned by list_slots. Only for services whose fulfilment is appointment.',
    params: {
      service_id: { type: 'string', description: 'The id returned by find_service, e.g. visa_renewal.' },
      attendee_name: { type: 'string', description: 'Full name of the person who will attend the appointment (demo data).' },
      booked_by_name: { type: 'string', optional: true, description: "Name of the caller, only if they are booking for someone else." },
      contact: { type: 'string', description: 'One contact: a phone number or an email (demo data).' },
      date: { type: 'string', description: 'Appointment date as YYYY-MM-DD, taken from list_slots.' },
      time: { type: 'string', description: 'Appointment start time as HH:MM in 24-hour format, taken from list_slots, e.g. 10:30.' },
      language
    },
    timeoutSecs: 10, preSpeech: 'force'
  },
  {
    name: TOOL_NAMES.reschedule,
    description:
      'Move an existing appointment to a new slot. Ask for the reference number, read the change back, and call only after the caller says yes. ' +
      'Use dates and times returned by list_slots.',
    params: {
      ref: { type: 'string', description: "The booking reference the caller gives, e.g. HALA-1001. Digits alone are fine." },
      date: { type: 'string', description: 'New date, YYYY-MM-DD.' },
      time: { type: 'string', description: 'New start time, HH:MM 24-hour.' },
      language
    },
    timeoutSecs: 10, preSpeech: 'force'
  },
  {
    name: TOOL_NAMES.cancel,
    description: 'Cancel an appointment by its reference. Read back which appointment will be cancelled and call only after the caller says yes.',
    params: {
      ref: { type: 'string', description: 'The booking reference, e.g. HALA-1001. Digits alone are fine.' },
      language
    },
    timeoutSecs: 10, preSpeech: 'force'
  },
  {
    name: TOOL_NAMES.checkBooking,
    description: 'Look up an existing appointment by reference, to read its details back or to confirm what a caller already booked.',
    params: { ref: { type: 'string', description: 'The booking reference, e.g. HALA-1001. Digits alone are fine.' } },
    timeoutSecs: 8, preSpeech: 'off'
  },
  {
    name: TOOL_NAMES.logRequest,
    description:
      'Log a maintenance request or a complaint (services whose fulfilment is ticket). Read the details back first and call only after the caller says yes. ' +
      'Do NOT use this for a dispute about a fee: hand over instead.',
    params: {
      service_id: { type: 'string', description: 'maintenance or complaint, as returned by find_service.' },
      caller_name: { type: 'string', description: "The caller's name (demo data)." },
      contact: { type: 'string', description: 'A phone number or an email (demo data).' },
      details: { type: 'string', description: 'One or two sentences describing the problem, in the caller\'s own words.' },
      location: { type: 'string', optional: true, description: 'Building or community name and the unit or office number (demo data), if relevant.' },
      urgency: { type: 'string', enum: ['emergency', 'routine'], optional: true, description: 'For maintenance: emergency or routine. Ask the caller. Omit for complaints.' },
      language
    },
    timeoutSecs: 10, preSpeech: 'force'
  },
  {
    name: TOOL_NAMES.lookupFact,
    description:
      'Answer a general question about DSO or HALA from the verified fact base (what HALA is, the e-wallet deposit machine, how many services DSO has, demo booking hours). ' +
      'If it finds nothing, say you do not know and offer a hand-over. Never answer such questions from memory.',
    params: { question: { type: 'string', description: "The caller's question, as they said it." } },
    timeoutSecs: 8, preSpeech: 'off'
  },
  {
    name: TOOL_NAMES.handover,
    description:
      'Pass the caller to a person on the DSO team. Call immediately when the caller disputes a fee, asks for legal advice, is upset, asks for a person, asks for something out of scope, ' +
      "or when you do not know the answer. Write the summary for the person who will take over: who, what they wanted, what you already did.",
    params: {
      reason: { type: 'string', enum: HANDOVER_REASONS, description: 'Why a person is needed.' },
      summary: { type: 'string', description: 'One or two sentences for the human taking over, in English.' },
      caller_name: { type: 'string', optional: true, description: "The caller's name if you have it." },
      contact: { type: 'string', optional: true, description: 'A phone number or an email if the caller gave one.' },
      language
    },
    timeoutSecs: 10, preSpeech: 'off'
  }
]

export const specByName = (name: string) => TOOL_SPECS.find((s) => s.name === name)
