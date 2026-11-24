import { SERVICE_HOURS, type Fact } from '@hala/core'
import { rank } from './matcher'

/**
 * Grounded fact base for /api/research and the lookup_fact tool.
 *
 * ONLY facts that come from the challenge brief or Handover.md belong here. If a team member adds a
 * fact, it needs a source. Anything not found here means the agent says "I don't know" and offers a
 * hand-over. Nothing is looked up on the internet and no question text leaves our server.
 */
export const FACTS: Fact[] = [
  {
    id: 'dso_online_services',
    source: 'brief',
    keywords: {
      en: ['how many services', 'number of services', 'online services', 'services does dso', '340 services', 'digital services'],
      ar: ['كم خدمة', 'عدد الخدمات', 'الخدمات الإلكترونية', 'الخدمات الرقمية']
    },
    answer: {
      en: 'Dubai Silicon Oasis offers more than 340 online services.',
      ar: 'تقدّم واحة دبي للسيليكون أكثر من ثلاثمئة وأربعين خدمة إلكترونية.'
    }
  },
  {
    id: 'hadi_chatbot',
    source: 'brief',
    keywords: {
      en: ['what is hadi', 'who is hadi', 'about hadi', 'hadi chatbot', 'tell me about hadi', 'text chatbot', 'chatbot', 'chat bot'],
      ar: ['ما هو هادي', 'من هو هادي', 'عن هادي', 'روبوت المحادثة', 'مساعد نصي']
    },
    answer: {
      en: 'DSO already has a text chatbot called HADI. HALA adds a voice you can talk to in Arabic or English.',
      ar: 'لدى واحة دبي للسيليكون مساعد نصي اسمه هادي. وتضيف هلا صوتاً يمكنك التحدث معه بالعربية أو الإنجليزية.'
    }
  },
  {
    id: 'ewallet_machine',
    source: 'handover',
    keywords: {
      en: ['e wallet machine', 'ewallet machine', 'deposit machine', 'wallet deposit', 'where deposit', 'where top up', 'top up machine', 'cash deposit machine'],
      ar: ['جهاز الإيداع', 'ماكينة الإيداع', 'إيداع المحفظة', 'وين أودع', 'أين أودع', 'شحن المحفظة']
    },
    answer: {
      en: 'There is a 24-hour e-wallet deposit machine in the DSO HQ building.',
      ar: 'يوجد جهاز إيداع للمحفظة الإلكترونية يعمل على مدار الساعة في مبنى مقر واحة دبي للسيليكون الرئيسي.'
    }
  },
  {
    id: 'what_is_hala',
    source: 'brief',
    keywords: {
      en: ['what is hala', 'what does hala do', 'about hala', 'who are you', 'what can you do', 'what can you help', 'hala concierge'],
      ar: ['ما هي هلا', 'ماذا تفعلين', 'ايش تسوين', 'شو تسوين', 'من أنت', 'ماذا تقدمين', 'كيف تساعدين']
    },
    answer: {
      en: 'I am the voice concierge at the HALA reception of Dubai Silicon Oasis. I can find the right DSO service, tell you which documents you need, book an appointment, log a maintenance request or complaint, and connect you to the DSO team.',
      ar: 'أنا المساعدة الصوتية في استقبال هلا بواحة دبي للسيليكون. أقدر أحدد لك الخدمة المناسبة، وأخبرك بالمستندات المطلوبة، وأحجز لك موعداً، وأسجّل طلب صيانة أو شكوى، وأحوّلك إلى فريق واحة دبي للسيليكون.'
    }
  },
  {
    id: 'demo_booking_hours',
    source: 'handover',
    keywords: {
      en: ['appointment hours', 'booking hours', 'what hours', 'opening hours', 'working hours', 'when open', 'when are you open', 'office hours', 'what time open'],
      ar: ['ساعات العمل', 'أوقات العمل', 'متى تفتحون', 'مواعيد الدوام', 'الدوام']
    },
    answer: {
      en: `In this demonstration, appointments can be booked ${SERVICE_HOURS.days}, from 8 AM to 3 PM Dubai time, in 30-minute slots. These are demonstration hours, not official DSO opening hours.`,
      ar: 'في هذا العرض التجريبي يمكن حجز المواعيد من الاثنين إلى الجمعة، من الثامنة صباحاً إلى الثالثة عصراً بتوقيت دبي، في فترات مدتها ثلاثون دقيقة. هذه أوقات تجريبية وليست أوقات الدوام الرسمية لواحة دبي للسيليكون.'
    }
  }
]

export interface FactLookup {
  found: boolean
  fact?: Fact
  /** Confidence label for the agent. */
  confidence: 'none' | 'ambiguous' | 'clear'
}

/** Find a grounded fact for a question. A single stray word is not enough: needs a phrase match. */
export function lookupFact(question: string, facts: Fact[] = FACTS): FactLookup {
  const { matches, confidence } = rank(question, facts, 1)
  const best = matches[0]
  // Phrase matches score 4+. A lone generic word (score 1) must not pass as an answer.
  if (!best || best.score < 4) return { found: false, confidence: 'none' }
  return { found: true, fact: best.item, confidence }
}
