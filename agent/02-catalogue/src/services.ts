import type { Bilingual, Service } from '@hala/core'

/**
 * HALA demo catalogue.
 *
 * Every fee and processing time below is a DEMONSTRATION VALUE. The real ones sit behind DSO's
 * member login and are not public. Document lists are demonstration content as well.
 * The pitch must say so (Handover.md section 0). Arabic wording is Gulf-friendly Modern Standard
 * and still needs a native speaker's review.
 */
const d = (en: string, ar: string): Bilingual => ({ en, ar })

export const SERVICES: Service[] = [
  // ------------------------------------------------------------ company / PRO
  {
    id: 'visa_new',
    name: d('New employment visa', 'تأشيرة عمل جديدة'),
    summary: d('Applying for a residence visa for a newly hired employee.', 'تقديم طلب تأشيرة إقامة لموظف جديد.'),
    audience: 'company', category: 'visa', fulfilment: 'appointment',
    documents: [d('Passport copy', 'نسخة من جواز السفر'), d('Passport-size photo', 'صورة شخصية'), d('Signed offer letter', 'عرض العمل موقّعاً'), d('Establishment card', 'بطاقة المنشأة')],
    demoFeeAed: 3400, demoDays: 5,
    keywords: {
      en: ['visa', 'new visa', 'new employment visa', 'employment visa', 'work visa', 'visa for new employee', 'new hire', 'new employee', 'hire', 'hiring', 'recruit', 'sponsor employee', 'employee visa'],
      ar: ['تأشيرة', 'فيزا', 'تأشيرة جديدة', 'فيزا جديدة', 'تأشيرة عمل', 'فيزا عمل', 'موظف جديد', 'توظيف', 'استقدام', 'تأشيرة موظف جديد']
    },
    clarify: d('Is this a new visa, a renewal, or a cancellation?', 'هل هي تأشيرة جديدة، أم تجديد، أم إلغاء؟')
  },
  {
    id: 'visa_renewal',
    name: d('Employment visa renewal', 'تجديد تأشيرة العمل'),
    summary: d('Renewing the residence visa of an existing employee.', 'تجديد إقامة موظف حالي.'),
    audience: 'company', category: 'visa', fulfilment: 'appointment',
    documents: [d('Passport copy', 'نسخة من جواز السفر'), d('Current visa page', 'صفحة التأشيرة الحالية'), d('Emirates ID', 'الهوية الإماراتية'), d('Medical fitness result', 'نتيجة الفحص الطبي')],
    demoFeeAed: 2700, demoDays: 4,
    keywords: {
      en: ['visa', 'renew visa', 'visa renewal', 'renew employment visa', 'renew work visa', 'renew employee visa', 'extend visa', 'visa expire', 'visa expiring', 'residency renewal', 'renew residency'],
      ar: ['تأشيرة', 'فيزا', 'تجديد تأشيرة', 'تجديد فيزا', 'تجديد إقامة', 'تجديد تأشيرة عمل', 'تمديد تأشيرة', 'انتهاء تأشيرة', 'تنتهي تأشيرة']
    },
    clarify: d('Is this a new visa, a renewal, or a cancellation?', 'هل هي تأشيرة جديدة، أم تجديد، أم إلغاء؟')
  },
  {
    id: 'visa_cancel',
    name: d('Employment visa cancellation', 'إلغاء تأشيرة العمل'),
    summary: d('Cancelling the visa of an employee who is leaving.', 'إلغاء تأشيرة موظف ينتهي عمله.'),
    audience: 'company', category: 'visa', fulfilment: 'appointment',
    documents: [d('Passport copy', 'نسخة من جواز السفر'), d('Signed cancellation form', 'نموذج الإلغاء موقّعاً'), d('Labour card, if any', 'بطاقة العمل إن وجدت')],
    demoFeeAed: 450, demoDays: 2,
    keywords: {
      en: ['visa', 'cancel visa', 'visa cancellation', 'cancel employment visa', 'cancel employee visa', 'cancel work visa', 'terminate visa', 'employee resigned', 'employee leaving', 'resignation', 'end visa'],
      ar: ['تأشيرة', 'فيزا', 'إلغاء تأشيرة', 'إلغاء فيزا', 'إلغاء إقامة', 'إلغاء تأشيرة عمل', 'إلغاء إقامة موظف', 'استقالة موظف', 'استقالة', 'إنهاء خدمات', 'إنهاء تأشيرة']
    },
    clarify: d('Is this a new visa, a renewal, or a cancellation?', 'هل هي تأشيرة جديدة، أم تجديد، أم إلغاء؟')
  },
  {
    id: 'establishment_card',
    name: d('Establishment card', 'بطاقة المنشأة'),
    summary: d("The company's registration card that is needed before employee visas can be processed.", 'بطاقة تسجيل الشركة المطلوبة قبل معالجة تأشيرات الموظفين.'),
    audience: 'company', category: 'company', fulfilment: 'appointment',
    documents: [d('Trade licence', 'الرخصة التجارية'), d('Lease contract', 'عقد الإيجار'), d("Manager's passport copy", 'نسخة من جواز المدير')],
    demoFeeAed: 1150, demoDays: 3,
    keywords: {
      en: ['establishment card', 'company card', 'immigration card', 'establishment registration', 'establishment', 'company registration card', 'renew establishment card', 'new establishment card'],
      ar: ['بطاقة المنشأة', 'بطاقة منشأة', 'بطاقة الشركة', 'كرت المنشأة', 'بطاقة الهجرة', 'تسجيل المنشأة', 'المنشأة']
    }
  },
  {
    id: 'licence_renewal',
    name: d('Licence renewal', 'تجديد الرخصة'),
    summary: d("Renewing the company's trade licence for the next year.", 'تجديد الرخصة التجارية للشركة للسنة القادمة.'),
    audience: 'company', category: 'company', fulfilment: 'appointment',
    documents: [d('Current licence', 'الرخصة الحالية'), d('Valid lease contract', 'عقد إيجار ساري'), d('Audited accounts', 'القوائم المالية المدققة')],
    demoFeeAed: 14500, demoDays: 3,
    keywords: {
      en: ['licence renewal', 'license renewal', 'renew licence', 'renew license', 'renew trade licence', 'renew trade license', 'renew company licence', 'renew company license', 'licence expire', 'license expire', 'licence expiring', 'license expiring', 'trade licence renewal', 'trade license renewal'],
      ar: ['تجديد رخصة', 'تجديد الرخصة', 'تجديد الرخصة التجارية', 'تجديد رخصة تجارية', 'انتهاء الرخصة', 'تنتهي الرخصة', 'رخصة الشركة', 'تجديد رخصة الشركة']
    },
    clarify: d('Do you want to renew the licence, or change something on it?', 'هل تريد تجديد الرخصة، أم تعديل شيء فيها؟')
  },
  {
    id: 'licence_amendment',
    name: d('Licence amendment', 'تعديل الرخصة'),
    summary: d('Changing details on the licence, such as the activity, company name or shareholders.', 'تغيير بيانات الرخصة مثل النشاط أو اسم الشركة أو الشركاء.'),
    audience: 'company', category: 'company', fulfilment: 'appointment',
    documents: [d('Board resolution', 'قرار مجلس الإدارة'), d('Current licence', 'الرخصة الحالية'), d("Shareholders' passport copies", 'نسخ جوازات الشركاء')],
    demoFeeAed: 1900, demoDays: 4,
    keywords: {
      en: ['amend licence', 'amend license', 'licence amendment', 'license amendment', 'change licence', 'change license', 'modify licence', 'modify license', 'update licence', 'update license', 'add activity', 'change activity', 'change business activity', 'change company name', 'add shareholder', 'amendment'],
      ar: ['تعديل رخصة', 'تعديل الرخصة', 'إضافة نشاط', 'تغيير النشاط', 'تغيير اسم الشركة', 'تعديل بيانات الشركة', 'إضافة شريك', 'تعديل']
    },
    clarify: d('Do you want to renew the licence, or change something on it?', 'هل تريد تجديد الرخصة، أم تعديل شيء فيها؟')
  },
  {
    id: 'noc',
    name: d('No objection certificate (NOC)', 'شهادة عدم ممانعة'),
    summary: d('A letter from DSO confirming it has no objection to a request, for example an employee transfer.', 'خطاب من واحة دبي للسيليكون يؤكد عدم ممانعتها لطلب معين، مثل نقل موظف.'),
    audience: 'company', category: 'company', fulfilment: 'appointment',
    documents: [d('Request letter', 'خطاب الطلب'), d('Passport copy', 'نسخة من جواز السفر'), d('Company stamp', 'ختم الشركة')],
    demoFeeAed: 280, demoDays: 1,
    keywords: {
      en: ['noc', 'n o c', 'no objection', 'no objection certificate', 'no objection letter', 'letter of no objection', 'objection letter', 'permission letter'],
      ar: ['عدم ممانعة', 'شهادة عدم ممانعة', 'خطاب عدم ممانعة', 'رسالة عدم ممانعة', 'ان او سي', 'نوك']
    }
  },
  {
    id: 'leasing',
    name: d('Leasing enquiry', 'استفسار عن التأجير'),
    summary: d('Finding out about renting office space or a desk in DSO.', 'الاستفسار عن استئجار مكتب أو مساحة عمل في واحة دبي للسيليكون.'),
    audience: 'both', category: 'property', fulfilment: 'appointment',
    documents: [d('Trade licence', 'الرخصة التجارية'), d("Manager's passport copy", 'نسخة من جواز المدير')],
    demoFeeAed: null, demoDays: 2,
    keywords: {
      en: ['lease', 'leasing', 'rent office', 'rent an office', 'office space', 'rent space', 'office rental', 'desk space', 'coworking', 'co working', 'tenancy', 'rent'],
      ar: ['إيجار', 'تأجير', 'استئجار', 'مكتب للإيجار', 'مساحة مكتبية', 'مساحة عمل', 'عقد إيجار', 'أبغى أستأجر']
    }
  },
  {
    id: 'access_card',
    name: d('Access / staff ID card', 'بطاقة الدخول'),
    summary: d('The card that opens DSO building doors for staff and residents.', 'البطاقة التي تفتح أبواب مباني واحة دبي للسيليكون للموظفين والسكان.'),
    audience: 'both', category: 'access', fulfilment: 'appointment',
    documents: [d('Passport copy', 'نسخة من جواز السفر'), d('Passport-size photo', 'صورة شخصية'), d('Employment or tenancy letter', 'خطاب عمل أو عقد سكن')],
    demoFeeAed: 140, demoDays: 1,
    keywords: {
      en: ['access card', 'access id card', 'access pass', 'staff card', 'staff id', 'staff badge', 'entry card', 'door card', 'building access', 'access badge', 'badge', 'lost card'],
      ar: ['بطاقة دخول', 'بطاقة الدخول', 'بطاقة موظف', 'بطاقة تعريف', 'كرت دخول', 'بطاقة الوصول', 'بادج', 'ضاعت البطاقة']
    }
  },
  // ------------------------------------------------------------ residents
  {
    id: 'maintenance',
    name: d('Maintenance request', 'طلب صيانة'),
    summary: d('Reporting something broken in a DSO unit so a technician can be sent.', 'الإبلاغ عن عطل في وحدة داخل واحة دبي للسيليكون ليتم إرسال فني.'),
    audience: 'resident', category: 'support', fulfilment: 'ticket',
    documents: [d('Unit or office number', 'رقم الوحدة أو المكتب'), d('A short description of the problem', 'وصف مختصر للمشكلة')],
    demoFeeAed: null, demoDays: 1,
    keywords: {
      en: ['maintenance', 'repair', 'broken', 'not working', 'fix', 'leak', 'leaking', 'water leak', 'ac', 'aircon', 'air conditioning', 'air conditioner', 'lift', 'elevator', 'plumbing', 'no electricity', 'power outage', 'technician'],
      ar: ['صيانة', 'طلب صيانة', 'تصليح', 'إصلاح', 'خربان', 'خراب', 'مكيف', 'تسريب', 'مكسور', 'معطل', 'عطل', 'ما يشتغل', 'لا يعمل', 'مصعد', 'كهرباء', 'سباكة', 'فني']
    },
    agentNote: 'Log a ticket with log_request. Ask for the unit or office number (demo data) and one sentence describing the problem.'
  },
  {
    id: 'complaint',
    name: d('Complaint', 'شكوى'),
    summary: d('Recording a complaint or feedback so the DSO team can follow up.', 'تسجيل شكوى أو ملاحظة ليتابعها فريق واحة دبي للسيليكون.'),
    audience: 'both', category: 'support', fulfilment: 'ticket',
    documents: [d('A short description of the issue', 'وصف مختصر للمشكلة')],
    demoFeeAed: null, demoDays: 3,
    keywords: {
      en: ['complaint', 'complain', 'file a complaint', 'report a problem', 'unhappy', 'dissatisfied', 'feedback', 'bad service', 'poor service', 'noise complaint', 'suggestion'],
      ar: ['شكوى', 'أشتكي', 'تقديم شكوى', 'أريد أشتكي', 'غير راضي', 'سوء خدمة', 'ملاحظة', 'اقتراح']
    },
    agentNote: 'Logging a complaint is a service: use log_request. BUT if the complaint is a dispute about a fee or charge ("this charge is wrong", "I refuse to pay"), do not log it: hand over with reason fee_dispute.'
  },
  {
    id: 'ewallet_machine',
    name: d('24-hour e-wallet deposit machine', 'جهاز إيداع المحفظة الإلكترونية على مدار 24 ساعة'),
    summary: d('A machine in the DSO HQ building where you can top up your DSO e-wallet at any hour.', 'جهاز في مبنى مقر واحة دبي للسيليكون الرئيسي لإيداع رصيد في محفظتك الإلكترونية في أي وقت.'),
    audience: 'both', category: 'info', fulfilment: 'info',
    documents: [],
    demoFeeAed: null, demoDays: null,
    keywords: {
      en: ['e wallet', 'ewallet', 'wallet', 'deposit machine', 'deposit', 'top up', 'topup', 'recharge wallet', 'cash deposit', 'add money', 'add balance'],
      ar: ['محفظة', 'المحفظة الإلكترونية', 'محفظة إلكترونية', 'إيداع', 'جهاز الإيداع', 'شحن المحفظة', 'شحن رصيد', 'ماكينة إيداع', 'أودع']
    },
    agentNote: 'Info only. The machine is in the DSO HQ building and works 24 hours. Do not state fees or limits: they are not known.'
  }
]
