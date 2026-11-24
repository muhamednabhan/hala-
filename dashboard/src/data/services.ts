// DSO services. Ids and names match the agent's catalogue (agent/02-catalogue/src/services.ts on the
// team branches), so live events from the agent server resolve to the same labels.

export interface ServiceDef {
  key: string;
  label: string;
  labelAr: string;
  /** appointment = the agent books a slot; ticket = logs a request; info = explains only. */
  fulfilment: 'appointment' | 'ticket' | 'info';
  weight: number; // how often it shows up in mock data
  bookable: boolean;
  questions: { en: string[]; ar: string[] };
}

const s = (
  key: string,
  label: string,
  labelAr: string,
  fulfilment: ServiceDef['fulfilment'],
  weight: number,
  en: string[],
  ar: string[],
): ServiceDef => ({ key, label, labelAr, fulfilment, weight, bookable: fulfilment === 'appointment', questions: { en, ar } });

export const SERVICES: ServiceDef[] = [
  s('visa_new', 'New employment visa', 'تأشيرة عمل جديدة', 'appointment', 10,
    ['How do I apply for a new employee visa?'], ['كيف أقدم طلب تأشيرة عمل جديدة؟']),
  s('visa_renewal', 'Employment visa renewal', 'تجديد تأشيرة العمل', 'appointment', 18,
    ['I need to renew my employment visa, what documents do I need?', 'How do I renew the visa for my employee?'],
    ['أريد تجديد تأشيرة الإقامة، ما هي المستندات المطلوبة؟', 'كيف أجدد تأشيرة موظف لدي؟']),
  s('visa_cancel', 'Employment visa cancellation', 'إلغاء تأشيرة العمل', 'appointment', 7,
    ['I want to cancel the visa of an employee who resigned.'], ['أريد إلغاء تأشيرة موظف استقال.']),
  s('establishment_card', 'Establishment card', 'بطاقة المنشأة', 'appointment', 8,
    ['Our establishment card expires next week, how do I renew it?'], ['بطاقة المنشأة ستنتهي الأسبوع القادم، كيف أجددها؟']),
  s('licence_types', 'Licence types and activities', 'أنواع الرخص والأنشطة المسموحة', 'info', 4,
    ['Which licence do I need for a software company?'], ['ما نوع الرخصة المناسبة لشركة برمجيات؟']),
  s('licence_renewal', 'Licence renewal', 'تجديد الرخصة', 'appointment', 11,
    ['When is my trade licence renewal due and what does it cost?'], ['متى موعد تجديد الرخصة التجارية؟']),
  s('licence_amendment', 'Licence amendment', 'تعديل الرخصة', 'appointment', 5,
    ['I want to add a new activity to my licence.'], ['أريد إضافة نشاط جديد إلى الرخصة.']),
  s('noc', 'No objection certificate (NOC)', 'شهادة عدم ممانعة', 'appointment', 6,
    ['I need an NOC for my employee.'], ['أحتاج شهادة عدم ممانعة لموظف.']),
  s('leasing', 'Leasing', 'خدمات التأجير', 'appointment', 6,
    ['Do you have any office space available in Dtec?'], ['هل توجد مكاتب متاحة للإيجار؟']),
  s('access_card', 'Access / ID card', 'بطاقة الدخول', 'appointment', 12,
    ['I lost my DSO access card.', 'How do I get an access card for a new employee?'], ['فقدت بطاقة الدخول الخاصة بي.']),
  s('maintenance', 'Maintenance request', 'طلب صيانة', 'ticket', 9,
    ['The AC in my apartment is not working.'], ['المكيف في شقتي لا يعمل.']),
  s('complaint', 'Complaint', 'شكوى', 'ticket', 5,
    ['I want to file a complaint about parking.'], ['أريد تقديم شكوى بخصوص المواقف.']),
  s('desk_resolution', 'HALA desk appointment', 'موعد في مكتب هلا', 'appointment', 3,
    ['Can I see someone at the HALA desk about my case?'], ['أريد موعداً في مكتب هلا لحل مشكلتي.']),
  s('ewallet_machine', '24-hour e-wallet machine', 'جهاز إيداع المحفظة الإلكترونية', 'info', 2,
    ['Where is the e-wallet deposit machine?'], ['أين جهاز إيداع المحفظة الإلكترونية؟']),
];

const byKey = new Map(SERVICES.map((x) => [x.key, x]));

export function getService(key: string | null | undefined): ServiceDef | undefined {
  return key ? byKey.get(key) : undefined;
}

export function serviceLabel(key: string | null | undefined): string {
  if (!key || key === 'none') return 'General enquiry';
  return byKey.get(key)?.label ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/** Arabic service names for follow-up messages. */
export const SERVICE_AR: Record<string, string> = Object.fromEntries(SERVICES.map((x) => [x.key, x.labelAr]));

/** Questions the agent couldn't answer (mock data for the Teach page). */
export const GAP_QUESTIONS: { question: string; service: string; language: 'en' | 'ar' }[] = [
  { question: 'Can I renew my visa while I am outside the UAE?', service: 'visa_renewal', language: 'en' },
  { question: 'هل يمكنني دفع رسوم التجديد بالتقسيط؟', service: 'licence_renewal', language: 'ar' },
  { question: 'Is there a grace period after the establishment card expires?', service: 'establishment_card', language: 'en' },
  { question: 'Can a visitor get a temporary access card for one day?', service: 'access_card', language: 'en' },
  { question: 'Do I need a new NOC if my employee changes job title?', service: 'noc', language: 'en' },
  { question: 'هل يسمح بالحيوانات الأليفة في الشقق المؤجرة؟', service: 'leasing', language: 'ar' },
  { question: 'Can I change my company name during licence renewal?', service: 'licence_amendment', language: 'en' },
  { question: 'How long does visa cancellation take if the employee already left the country?', service: 'visa_cancel', language: 'en' },
  { question: 'كم يستغرق إصدار تأشيرة جديدة لمستثمر؟', service: 'visa_new', language: 'ar' },
  { question: 'Which bus routes serve DSO?', service: 'none', language: 'en' },
];

/** The agent's hand-over reasons (agent/01-core HANDOVER_REASONS). */
export const HANDOVER_REASON_LABEL: Record<string, string> = {
  fee_dispute: 'Fee dispute',
  legal_question: 'Legal question',
  upset_caller: 'Upset caller',
  out_of_scope: 'Out of scope',
  unknown_answer: "Didn't know the answer",
  caller_requested: 'Asked for a person',
  emergency: 'Emergency',
  other: 'Other',
};
