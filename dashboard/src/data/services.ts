// DSO services the agent handles. Keys match `service` in schema.sql.

export interface ServiceDef {
  key: string;
  label: string;
  weight: number; // how often it shows up in mock data
  bookable: boolean;
  questions: { en: string[]; ar: string[] };
}

export const SERVICES: ServiceDef[] = [
  {
    key: 'visa_renewal',
    label: 'Visa renewal',
    weight: 18,
    bookable: true,
    questions: {
      en: ['I need to renew my employment visa, what documents do I need?', 'How do I renew the visa for my employee?'],
      ar: ['أريد تجديد تأشيرة الإقامة، ما هي المستندات المطلوبة؟', 'كيف أجدد تأشيرة موظف لدي؟'],
    },
  },
  {
    key: 'visa_new',
    label: 'New visa',
    weight: 10,
    bookable: true,
    questions: { en: ['How do I apply for a new employee visa?'], ar: ['كيف أقدم طلب تأشيرة عمل جديدة؟'] },
  },
  {
    key: 'visa_cancellation',
    label: 'Visa cancellation',
    weight: 7,
    bookable: true,
    questions: {
      en: ['I want to cancel the visa of an employee who resigned.'],
      ar: ['أريد إلغاء تأشيرة موظف استقال.'],
    },
  },
  {
    key: 'establishment_card',
    label: 'Establishment card',
    weight: 8,
    bookable: true,
    questions: {
      en: ['Our establishment card expires next week, how do I renew it?'],
      ar: ['بطاقة المنشأة ستنتهي الأسبوع القادم، كيف أجددها؟'],
    },
  },
  {
    key: 'access_card',
    label: 'Access / ID card',
    weight: 12,
    bookable: true,
    questions: {
      en: ['I lost my DSO access card.', 'How do I get an access card for a new employee?'],
      ar: ['فقدت بطاقة الدخول الخاصة بي.'],
    },
  },
  {
    key: 'licence_renewal',
    label: 'Trade licence renewal',
    weight: 11,
    bookable: true,
    questions: {
      en: ['When is my trade licence renewal due and what does it cost?'],
      ar: ['متى موعد تجديد الرخصة التجارية؟'],
    },
  },
  {
    key: 'licence_amendment',
    label: 'Licence amendment',
    weight: 5,
    bookable: true,
    questions: { en: ['I want to add a new activity to my licence.'], ar: ['أريد إضافة نشاط جديد إلى الرخصة.'] },
  },
  {
    key: 'noc',
    label: 'NOC',
    weight: 6,
    bookable: true,
    questions: { en: ['I need an NOC for my employee.'], ar: ['أحتاج شهادة عدم ممانعة لموظف.'] },
  },
  {
    key: 'leasing',
    label: 'Leasing',
    weight: 6,
    bookable: true,
    questions: { en: ['Do you have any office space available in Dtec?'], ar: ['هل توجد مكاتب متاحة للإيجار؟'] },
  },
  {
    key: 'maintenance',
    label: 'Maintenance request',
    weight: 9,
    bookable: false,
    questions: { en: ['The AC in my apartment is not working.'], ar: ['المكيف في شقتي لا يعمل.'] },
  },
  {
    key: 'complaint',
    label: 'Complaint',
    weight: 5,
    bookable: false,
    questions: { en: ['I want to file a complaint about parking.'], ar: ['أريد تقديم شكوى بخصوص المواقف.'] },
  },
];

const byKey = new Map(SERVICES.map((s) => [s.key, s]));

export function getService(key: string | null | undefined): ServiceDef | undefined {
  return key ? byKey.get(key) : undefined;
}

export function serviceLabel(key: string | null | undefined): string {
  if (!key) return 'General';
  return byKey.get(key)?.label ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Questions the agent couldn't answer — feed the "Teach the agent" page. */
export const GAP_QUESTIONS: { question: string; service: string; language: 'en' | 'ar' }[] = [
  { question: 'Can I renew my visa while I am outside the UAE?', service: 'visa_renewal', language: 'en' },
  { question: 'هل يمكنني دفع رسوم التجديد بالتقسيط؟', service: 'licence_renewal', language: 'ar' },
  { question: 'Is there a grace period after the establishment card expires?', service: 'establishment_card', language: 'en' },
  { question: 'Can a visitor get a temporary access card for one day?', service: 'access_card', language: 'en' },
  { question: 'Do I need a new NOC if my employee changes job title?', service: 'noc', language: 'en' },
  { question: 'هل يسمح بالحيوانات الأليفة في الشقق المؤجرة؟', service: 'leasing', language: 'ar' },
  { question: 'Can I change my company name during licence renewal?', service: 'licence_amendment', language: 'en' },
  {
    question: 'How long does visa cancellation take if the employee already left the country?',
    service: 'visa_cancellation',
    language: 'en',
  },
  { question: 'كم يستغرق إصدار تأشيرة جديدة لمستثمر؟', service: 'visa_new', language: 'ar' },
];
