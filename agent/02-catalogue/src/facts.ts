import type { Fact } from '@hala/core'
import { rank } from './matcher'

/**
 * Grounded fact base for /api/research and the lookup_fact tool.
 *
 * Sources allowed: the challenge brief, handover.md, and "DSO Knowledge Base v1.0" (kb), which the team treats as
 * verified. Anything not found here means the agent says "I don't know" and offers a hand-over. Nothing is looked
 * up on the internet and no question text leaves our server. Fees and times are NOT facts: they live in the
 * service catalogue, marked DEMO.
 */
export const FACTS: Fact[] = [
  {
    id: 'dso_online_services',
    source: 'brief',
    keywords: {
      en: ['how many services', 'number of services', 'online services', 'services does dso', '340 services', 'digital services', 'e services portal', 'eservices portal', 'dso portal', 'member portal'],
      ar: ['كم خدمة', 'عدد الخدمات', 'الخدمات الإلكترونية', 'الخدمات الرقمية', 'بوابة الواحة', 'بوابة الخدمات']
    },
    answer: {
      en: 'The DSO e-services portal hosts more than 340 digital services, including e-wallet top-ups, status tracking and document downloads.',
      ar: 'تضم بوابة الخدمات الإلكترونية في واحة دبي للسيليكون أكثر من ثلاثمئة وأربعين خدمة رقمية، منها شحن المحفظة الإلكترونية وتتبع الطلبات وتنزيل المستندات.'
    }
  },
  {
    id: 'hadi_chatbot',
    source: 'kb',
    keywords: {
      en: ['what is hadi', 'who is hadi', 'about hadi', 'hadi chatbot', 'tell me about hadi', 'text chatbot', 'chatbot', 'chat bot'],
      ar: ['ما هو هادي', 'من هو هادي', 'عن هادي', 'روبوت المحادثة', 'مساعد نصي']
    },
    answer: {
      en: 'HADI is the DSO text chatbot, covering 226 smart services by 2020. HALA adds a voice you can talk to in Arabic or English.',
      ar: 'هادي هو المساعد النصي في واحة دبي للسيليكون، وقد غطّى 226 خدمة ذكية بحلول عام 2020. وتضيف هلا صوتاً يمكنك التحدث معه بالعربية أو الإنجليزية.'
    }
  },
  {
    id: 'ewallet_machine',
    source: 'kb',
    keywords: {
      en: ['e wallet machine', 'ewallet machine', 'deposit machine', 'wallet deposit', 'where deposit', 'where top up', 'top up machine', 'cash deposit machine', 'kiosk'],
      ar: ['جهاز الإيداع', 'ماكينة الإيداع', 'إيداع المحفظة', 'وين أودع', 'أين أودع', 'شحن المحفظة']
    },
    answer: {
      en: 'There is a 24-hour e-wallet deposit machine in the lobby of the DSO HQ building.',
      ar: 'يوجد جهاز إيداع للمحفظة الإلكترونية يعمل على مدار الساعة في ردهة مبنى مقر واحة دبي للسيليكون الرئيسي.'
    }
  },
  {
    id: 'what_is_hala',
    source: 'kb',
    keywords: {
      en: ['what is hala', 'what does hala do', 'about hala', 'who are you', 'what can you do', 'what can you help', 'hala concierge', 'hala reception', 'where is hala', 'where is reception'],
      ar: ['ما هي هلا', 'ماذا تفعلين', 'ايش تسوين', 'شو تسوين', 'من أنت', 'ماذا تقدمين', 'كيف تساعدين', 'أين هلا', 'وين الاستقبال']
    },
    answer: {
      en: 'I am the voice concierge of HALA, the reception suite in the DSO headquarters building that guides members and residents through digital services. I can find the right DSO service, tell you which documents you need, book an appointment, log a maintenance request or complaint, and connect you to the DSO team.',
      ar: 'أنا المساعدة الصوتية لهلا، جناح الاستقبال في مبنى مقر واحة دبي للسيليكون الرئيسي الذي يرشد الأعضاء والسكان إلى الخدمات الرقمية. أقدر أحدد لك الخدمة المناسبة، وأخبرك بالمستندات المطلوبة، وأحجز لك موعداً، وأسجّل طلب صيانة أو شكوى، وأحوّلك إلى فريق واحة دبي للسيليكون.'
    }
  },
  {
    id: 'contact_team',
    source: 'kb',
    keywords: {
      en: ['phone number', 'contact number', 'call dso', 'how do i contact', 'contact dso', 'customer happiness', 'customer happiness number', 'email address', 'dso email', 'contact email', 'support number', 'helpline'],
      ar: ['رقم الهاتف', 'رقم التواصل', 'كيف أتواصل', 'اتصل بالواحة', 'إسعاد المتعاملين', 'البريد الإلكتروني', 'رقم الدعم']
    },
    answer: {
      en: 'You can reach DSO Customer Happiness on 600 59 55 57, Monday to Friday, 8 AM to 3 PM Dubai time, or by email at hello@dso.ae. For corporate setup enquiries the email is business@dso.com.',
      ar: 'يمكنك التواصل مع إسعاد المتعاملين في واحة دبي للسيليكون على الرقم 600 59 55 57 من الاثنين إلى الجمعة، من الثامنة صباحاً إلى الثالثة عصراً بتوقيت دبي، أو عبر البريد hello@dso.ae. ولاستفسارات تأسيس الشركات البريد business@dso.com.'
    }
  },
  {
    id: 'demo_booking_hours',
    source: 'handover',
    keywords: {
      en: ['appointment hours', 'booking hours', 'what hours', 'opening hours', 'working hours', 'when open', 'when are you open', 'office hours', 'what time open', 'support hours'],
      ar: ['ساعات العمل', 'أوقات العمل', 'متى تفتحون', 'مواعيد الدوام', 'الدوام']
    },
    answer: {
      en: 'DSO support runs Monday to Friday, 8 AM to 3 PM Dubai time. In this demonstration, appointments are booked in 30-minute slots within those hours.',
      ar: 'يعمل الدعم في واحة دبي للسيليكون من الاثنين إلى الجمعة، من الثامنة صباحاً إلى الثالثة عصراً بتوقيت دبي. وفي هذا العرض التجريبي تُحجز المواعيد في فترات مدتها ثلاثون دقيقة ضمن هذه الأوقات.'
    }
  },
  {
    id: 'dtec_campuses',
    source: 'kb',
    keywords: {
      en: ['dtec', 'dtec campus', 'dtec campuses', 'technohub', 'techno hub', 'dubai digital park', 'where is dtec', 'dtec hours', 'dtec opening'],
      ar: ['دِتيك', 'ديتيك', 'مقر دِتيك', 'تكنوهب', 'دبي ديجيتال بارك']
    },
    answer: {
      en: 'Dtec has two campuses in Dubai Silicon Oasis: TechnoHub 1 and Building A5 in Dubai Digital Park. Dtec office hours are 7:30 AM to 3 PM, and members have access 24 hours a day.',
      ar: 'لدى دِتيك حرمان في واحة دبي للسيليكون: تكنوهب 1 والمبنى A5 في دبي ديجيتال بارك. ساعات مكتب دِتيك من السابعة والنصف صباحاً إلى الثالثة عصراً، وللأعضاء دخول على مدار الساعة.'
    }
  },
  {
    id: 'authority',
    source: 'kb',
    keywords: {
      en: ['who regulates', 'which authority', 'dieza', 'who runs dso', 'free zone authority', 'integrated economic zones'],
      ar: ['الجهة المنظمة', 'من يشرف', 'ديزا', 'هيئة المناطق الاقتصادية']
    },
    answer: {
      en: 'Dubai Silicon Oasis operates under the Dubai Integrated Economic Zones Authority, DIEZA.',
      ar: 'تعمل واحة دبي للسيليكون تحت مظلة هيئة دبي للمناطق الاقتصادية المتكاملة، ديزا.'
    }
  },
  {
    id: 'residential_communities',
    source: 'kb',
    keywords: {
      en: ['residential communities', 'which communities', 'villas', 'cedre villas', 'semmer villas', 'palace towers', 'axis residences', 'where can i live'],
      ar: ['المجتمعات السكنية', 'سيدر فيلاز', 'سيمر فيلاز', 'بالاس تاورز', 'أكسيس ريزدنس', 'فلل']
    },
    answer: {
      en: 'The DSO-managed residential communities are Cedre Villas, Semmer Villas, Palace Towers and Axis Residences.',
      ar: 'المجتمعات السكنية التي تديرها واحة دبي للسيليكون هي سيدر فيلاز وسيمر فيلاز وبالاس تاورز وأكسيس ريزدنس.'
    }
  },
  {
    id: 'out_of_scope',
    source: 'kb',
    keywords: {
      en: ['check my balance', 'wallet balance', 'my account', 'account details', 'process a payment', 'pay my invoice', 'what can you not do'],
      ar: ['رصيد المحفظة', 'حسابي', 'تفاصيل الحساب', 'أدفع فاتورتي', 'ما لا تستطيعين']
    },
    answer: {
      en: 'I cannot look up real accounts, check live e-wallet balances, take payments, access private resident or company records, or give legal or tax advice. I can connect you to the DSO team for any of these.',
      ar: 'لا أستطيع الاطلاع على الحسابات الحقيقية أو معرفة رصيد المحفظة، ولا قبول مدفوعات، ولا الوصول إلى سجلات السكان أو الشركات الخاصة، ولا تقديم استشارة قانونية أو ضريبية. أقدر أحوّلك إلى فريق الواحة لأي من ذلك.'
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
