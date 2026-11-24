import type { Bilingual, Service } from '@hala/core'

/**
 * HALA catalogue, built from "DSO Knowledge Base v1.0" (source of truth for documents, steps, policies).
 *
 * Every fee and processing time is a DEMONSTRATION VALUE: the real tariffs sit behind DSO's member login.
 * The knowledge base marks them [DEMO DATA] and so do we: the agent must say so whenever it states one.
 * English text (steps, eligibility, policy) comes from the knowledge base; the agent translates when it speaks
 * Arabic. Arabic names, summaries and documents are written for this project (terms follow the knowledge
 * base glossary) and still need a native speaker's review.
 */
const d = (en: string, ar: string): Bilingual => ({ en, ar })

export const SERVICES: Service[] = [
  // ------------------------------------------------------------ company / PRO
  {
    id: 'visa_new',
    name: d('New employment visa', 'تأشيرة عمل جديدة'),
    summary: d('Applying for a residence visa for a newly hired employee.', 'تقديم طلب تأشيرة إقامة لموظف جديد.'),
    voiceSummary: d(
      'For a new employment visa, we first apply for an entry permit on the DSO portal, followed by medical fitness testing, Emirates ID biometrics, and residency issuance.',
      'لإصدار تأشيرة عمل جديدة نقدّم أولاً طلب تصريح الدخول عبر بوابة واحة دبي للسيليكون، ثم الفحص الطبي وبصمات الهوية الإماراتية، ثم إصدار الإقامة.'
    ),
    audience: 'company', category: 'visa', fulfilment: 'appointment',
    eligibility: 'Active DSO company with a valid Establishment Card and available visa quota (Flexi Desk: 2 visas; Fixed Desk: 3 visas; Furnished Office: 2 per desk).',
    documents: [
      d('Employee passport copy, valid for at least 6 months', 'نسخة من جواز سفر الموظف ساري لمدة ستة أشهر على الأقل'),
      d('High-resolution passport photo on a white background', 'صورة شخصية عالية الدقة بخلفية بيضاء'),
      d('Attested university degree (for managerial or skilled roles)', 'الشهادة الجامعية مصدّقة (للوظائف الإدارية أو المتخصصة)'),
      d('Signed DSO standard employment contract', 'عقد العمل الموحد من واحة دبي للسيليكون موقّعاً'),
      d('Previous UAE visa cancellation paper or tourist entry stamp (if inside the UAE)', 'ورقة إلغاء التأشيرة السابقة أو ختم دخول سياحي (إذا كان داخل الدولة)')
    ],
    steps: [
      'Submit the Employment Entry Permit on the DSO e-services portal.',
      'Complete the in-country status change (or airport entry if the employee is abroad).',
      'Complete the UAE medical fitness test and Emirates ID biometrics.',
      'Upload the medical and Emirates ID receipts on the portal for digital residency issuance.'
    ],
    feeText: 'AED 3,500 standard, AED 4,800 urgent', timelineText: '5 to 7 working days',
    demoFeeAed: 3500, demoDays: 7,
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
    voiceSummary: d(
      "To renew an employee's visa, you'll need their passport copy, current visa and Emirates ID, a fresh medical fitness certificate, and active health insurance.",
      'لتجديد تأشيرة موظف تحتاج نسخة من جواز سفره وتأشيرته الحالية وهويته الإماراتية، وشهادة لياقة طبية حديثة، وتأمين صحي ساري.'
    ),
    audience: 'company', category: 'visa', fulfilment: 'appointment',
    documents: [
      d('Passport copy, valid for at least 6 months', 'نسخة من جواز السفر سارية لستة أشهر على الأقل'),
      d('Current UAE residence visa and Emirates ID copies', 'نسخة من إقامة الإمارات الحالية والهوية الإماراتية'),
      d('Recent passport photo on a white background', 'صورة شخصية حديثة بخلفية بيضاء'),
      d('Passed medical fitness test result', 'نتيجة فحص اللياقة الطبية بعد اجتيازه'),
      d('Active UAE health insurance certificate', 'شهادة تأمين صحي سارية في الإمارات')
    ],
    steps: [
      'Select "Employment Visa Renewal" on the DSO e-services portal.',
      'Upload the updated medical, insurance and passport documents.',
      'Pay the renewal fee with the DSO e-wallet.',
      'Receive the renewed digital residency and updated Emirates ID.'
    ],
    feeText: 'AED 2,800', timelineText: '3 to 5 working days',
    demoFeeAed: 2800, demoDays: 5,
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
    voiceSummary: d(
      'To cancel an employment visa, upload the signed cancellation form, employee passport and Emirates ID copies, and end-of-service settlement confirmation on the portal.',
      'لإلغاء تأشيرة عمل ترفع على البوابة نموذج الإلغاء موقّعاً، ونسخة من جواز الموظف وهويته الإماراتية، وإقرار تسوية نهاية الخدمة.'
    ),
    audience: 'company', category: 'visa', fulfilment: 'appointment',
    documents: [
      d('Visa cancellation form signed by both the employee and the authorised company signatory', 'نموذج إلغاء التأشيرة موقّعاً من الموظف ومن المفوّض بالتوقيع عن الشركة'),
      d('Employee passport and Emirates ID copies', 'نسخة من جواز الموظف وهويته الإماراتية'),
      d('End-of-service gratuity or settlement acknowledgement', 'إقرار بتسوية مستحقات نهاية الخدمة')
    ],
    steps: [
      'Submit the cancellation request on the DSO e-services portal.',
      'Clear any pending immigration fines or e-wallet dues.',
      'Download the official visa cancellation certificate. The employee then has a grace period to leave or transfer to a new sponsor.'
    ],
    feeText: 'AED 350', timelineText: '1 to 2 working days',
    demoFeeAed: 350, demoDays: 2,
    keywords: {
      en: ['visa', 'cancel visa', 'visa cancellation', 'cancel employment visa', 'cancel employee visa', 'cancel work visa', 'terminate visa', 'employee resigned', 'employee leaving', 'resignation', 'end visa'],
      ar: ['تأشيرة', 'فيزا', 'إلغاء تأشيرة', 'إلغاء فيزا', 'إلغاء إقامة', 'إلغاء تأشيرة عمل', 'إلغاء إقامة موظف', 'استقالة موظف', 'استقالة', 'إنهاء خدمات', 'إنهاء تأشيرة']
    },
    clarify: d('Is this a new visa, a renewal, or a cancellation?', 'هل هي تأشيرة جديدة، أم تجديد، أم إلغاء؟')
  },
  {
    id: 'establishment_card',
    name: d('Establishment card', 'بطاقة المنشأة'),
    summary: d("The company's immigration file with DSO: needed before any employee visa and renewed every year.", 'ملف الشركة لدى الهجرة في الواحة: مطلوب قبل أي تأشيرة موظف ويُجدَّد سنوياً.'),
    voiceSummary: d(
      "Your company's Establishment Card is your immigration file with DSO. It is required before you can sponsor any employee visas and must be renewed annually.",
      'بطاقة المنشأة هي ملف شركتك لدى الهجرة في واحة دبي للسيليكون، وهي مطلوبة قبل كفالة أي تأشيرة موظف، وتُجدَّد سنوياً.'
    ),
    audience: 'company', category: 'company', fulfilment: 'appointment',
    documents: [
      d('Valid DSO trade licence', 'رخصة تجارية سارية من الواحة'),
      d('Valid DSO e-lease or tenancy contract', 'عقد إيجار إلكتروني أو عقد إيجار ساري'),
      d('Passport and Emirates ID copies of the general manager or authorised signatory', 'نسخة من جواز السفر والهوية الإماراتية للمدير العام أو المفوّض بالتوقيع'),
      d('Memorandum of Association (MOA)', 'عقد التأسيس')
    ],
    steps: [
      'Apply under Immigration Services, then Establishment Card, on the DSO e-services portal.',
      'Pay the issuance or renewal fee with the e-wallet.',
      'Download the digital Establishment Card.'
    ],
    feeText: 'AED 1,200 for a new card, AED 950 for the annual renewal', timelineText: '2 to 3 working days',
    policy: 'Late renewal incurs monthly immigration fines. If the caller disputes a late fine, offer to connect them to a DSO PRO or human officer (hand over with reason fee_dispute).',
    demoFeeAed: 1200, demoDays: 3,
    keywords: {
      en: ['establishment card', 'company card', 'immigration card', 'establishment registration', 'establishment', 'company registration card', 'renew establishment card', 'new establishment card'],
      ar: ['بطاقة المنشأة', 'بطاقة منشأة', 'بطاقة الشركة', 'كرت المنشأة', 'بطاقة الهجرة', 'تسجيل المنشأة', 'المنشأة']
    }
  },
  {
    id: 'licence_types',
    name: d('Licence types and permitted activities', 'أنواع الرخص والأنشطة المسموحة'),
    summary: d('Which DSO licence fits a business: service, trade, industrial or business operation permit.', 'أي رخصة من الواحة تناسب نشاطك: خدمات أو تجارية أو صناعية أو تصريح تشغيل.'),
    voiceSummary: d(
      'DSO companies are free zone companies or branches. The main licences are service, trade, industrial, and the business operation permit.',
      'الشركات في واحة دبي للسيليكون هي شركات منطقة حرة أو فروع. وأهم الرخص: رخصة الخدمات، والرخصة التجارية، والرخصة الصناعية، وتصريح تشغيل الأعمال.'
    ),
    audience: 'company', category: 'company', fulfilment: 'info',
    documents: [],
    notes: [
      'Companies in DSO operate mainly as a Free Zone Company (FZCO; under the 2023 DIEZA regulations former single-shareholder FZEs are also FZCOs) or as a Branch of a UAE or foreign parent company.',
      'Service Licence (most common for tech and Dtec): software development, SaaS, IT consultancy, AI and robotics R&D, cybersecurity, digital marketing, management consultancy, professional and creative services. Fits Dtec Flexi Desk (up to 2 visas), Fixed Desk (up to 3 visas) or Furnished Office (2 visas per desk).',
      'Trade Licence (commercial and e-commerce): import, export, storage and distribution of specified goods such as IT hardware, electronics, smart devices, e-commerce and general trading subject to screening. Fits office space or a DSO warehouse.',
      'Industrial Licence: importing raw materials, light manufacturing, electronics and PCB assembly, 3D printing at production scale, packaging and exporting finished products. Fits DSO Light Industrial Units.',
      "Business Operation Permit (special permit): lets a company holding a Dubai Department of Economy and Tourism (mainland) licence operate in privately developed areas of DSO's Administrative Zone, such as retail outlets, cafes, clinics and salons.",
      'Activities that need an external authority pre-approval: media, educational training, healthcare and clinics, telecom equipment, virtual assets, food and cosmetics, and regulated financial activities (which also need goAML registration).',
      'Several activities can sit under one licence if they are in the same segment. Adding activities across different segments (for example Service plus Trade) costs an extra segment fee of AED 3,000 to AED 5,000 a year (DEMO value).'
    ],
    demoFeeAed: null, demoDays: null,
    keywords: {
      en: ['licence types', 'license types', 'types of licence', 'types of license', 'licence category', 'license category', 'licence categories', 'license categories', 'service licence', 'service license', 'industrial licence', 'industrial license', 'business operation permit', 'free zone company', 'fzco', 'which licence', 'which license', 'what licence', 'what license', 'permitted activities', 'activities allowed', 'set up a company', 'start a company'],
      ar: ['أنواع الرخص', 'نوع الرخصة', 'رخصة خدمات', 'رخصة صناعية', 'تصريح تشغيل', 'الأنشطة المسموحة', 'أي رخصة', 'تأسيس شركة', 'فتح شركة', 'أفتح شركة', 'نفتح شركة', 'أؤسس شركة', 'نؤسس شركة', 'شركة جديدة']
    }
  },
  {
    id: 'licence_renewal',
    name: d('Licence renewal', 'تجديد الرخصة'),
    summary: d("Renewing the company's trade licence for the next year.", 'تجديد الرخصة التجارية للشركة للسنة القادمة.'),
    voiceSummary: d(
      'To renew your DSO trade licence, you first renew your office or desk lease on the e-services portal, confirm your UBO details, and settle the renewal voucher with your DSO e-wallet.',
      'لتجديد رخصتك التجارية تجدّد أولاً عقد المكتب أو المكتب المرن عبر بوابة الخدمات الإلكترونية، ثم تؤكد بيانات المستفيد الحقيقي، وتسدّد قسيمة التجديد من المحفظة الإلكترونية.'
    ),
    audience: 'company', category: 'company', fulfilment: 'appointment',
    documents: [
      d('Valid renewed DSO lease or Flexi-Desk agreement', 'عقد إيجار أو مكتب مرن مجدّد وساري'),
      d('Updated Ultimate Beneficial Owner (UBO) declaration confirmation', 'تأكيد إقرار المستفيد الحقيقي (UBO) المحدّث'),
      d('Audited financial report, if applicable to the entity', 'التقرير المالي المدقق إن انطبق على المنشأة')
    ],
    steps: [
      'Log into the DSO e-services portal and complete the lease renewal.',
      'Submit the Licence Renewal request and generate the payment voucher.',
      'Pay with the DSO e-wallet, or at the 24-hour deposit machine in the DSO HQ building.',
      'Download the renewed digital e-licence.'
    ],
    feeText: 'AED 12,000 licence renewal plus the workspace lease fee', timelineText: '1 to 2 working days',
    policy: 'If the company has late-renewal penalties or disputes the renewal invoice, do not negotiate: hand over to a DSO licensing officer (reason fee_dispute).',
    demoFeeAed: 12000, demoDays: 2,
    keywords: {
      en: ['licence renewal', 'license renewal', 'renew licence', 'renew license', 'renew trade licence', 'renew trade license', 'renew company licence', 'renew company license', 'licence expire', 'license expire', 'licence expiring', 'license expiring', 'trade licence renewal', 'trade license renewal'],
      ar: ['تجديد رخصة', 'تجديد الرخصة', 'تجديد الرخصة التجارية', 'تجديد رخصة تجارية', 'انتهاء الرخصة', 'تنتهي الرخصة', 'رخصة الشركة', 'تجديد رخصة الشركة']
    },
    clarify: d('Do you want to renew the licence, or change something on it?', 'هل تريد تجديد الرخصة، أم تعديل شيء فيها؟')
  },
  {
    id: 'licence_amendment',
    name: d('Licence amendment', 'تعديل الرخصة'),
    summary: d('Changing details on the licence: activities, company name, manager or shareholders.', 'تغيير بيانات الرخصة: الأنشطة أو اسم الشركة أو المدير أو الشركاء.'),
    voiceSummary: d(
      'You can amend your business activities, company name, manager, or shareholders through the DSO portal by submitting a board resolution and supporting IDs.',
      'يمكنك تعديل الأنشطة أو اسم الشركة أو المدير أو الشركاء عبر بوابة الواحة بتقديم قرار مجلس الإدارة والمستندات الشخصية المطلوبة.'
    ),
    audience: 'company', category: 'company', fulfilment: 'appointment',
    documents: [
      d('Notarised or signed board resolution approving the specific amendment', 'قرار مجلس الإدارة موثّقاً أو موقّعاً بالتعديل المطلوب'),
      d('Current trade licence and Memorandum of Association (MOA)', 'الرخصة التجارية الحالية وعقد التأسيس'),
      d('Passport and Emirates ID copies of new managers or shareholders, if management or ownership changes', 'نسخة من جواز السفر والهوية الإماراتية للمدير أو الشركاء الجدد عند تغيير الإدارة أو الملكية'),
      d('External regulator NOC, if adding a regulated activity', 'شهادة عدم ممانعة من الجهة التنظيمية عند إضافة نشاط خاضع للتنظيم')
    ],
    steps: [
      'Apply under "Licence Amendment" on the DSO e-services portal.',
      'Complete the DSO legal and security clearance.',
      'E-sign the MOA addendum and pay the amendment fee.',
      'Receive the amended e-licence.'
    ],
    feeText: 'AED 2,500 per amendment', timelineText: '3 to 5 working days',
    demoFeeAed: 2500, demoDays: 5,
    keywords: {
      en: ['amend licence', 'amend license', 'licence amendment', 'license amendment', 'change licence', 'change license', 'modify licence', 'modify license', 'update licence', 'update license', 'add activity', 'change activity', 'change business activity', 'change company name', 'add shareholder', 'amendment'],
      ar: ['تعديل رخصة', 'تعديل الرخصة', 'إضافة نشاط', 'تغيير النشاط', 'تغيير اسم الشركة', 'تعديل بيانات الشركة', 'إضافة شريك', 'تعديل']
    },
    clarify: d('Do you want to renew the licence, or change something on it?', 'هل تريد تجديد الرخصة، أم تعديل شيء فيها؟')
  },
  {
    id: 'noc',
    name: d('No objection certificate (NOC)', 'شهادة عدم ممانعة'),
    summary: d('A digital letter from DSO confirming it has no objection to a request.', 'خطاب رقمي من واحة دبي للسيليكون يؤكد عدم ممانعتها لطلب معين.'),
    voiceSummary: d(
      'DSO issues digital NOCs within one working day for corporate bank accounts, mainland branches, customs codes, or employee personal requests like driving licences.',
      'تصدر الواحة شهادات عدم الممانعة الرقمية خلال يوم عمل واحد لفتح الحسابات المصرفية للشركات، والفروع في البر الرئيسي، والرموز الجمركية، والطلبات الشخصية للموظفين مثل رخصة القيادة.'
    ),
    audience: 'company', category: 'company', fulfilment: 'appointment',
    documents: [
      d('NOC request letter stating the exact addressee (for example a bank or authority) and the purpose', 'خطاب طلب الشهادة يحدد الجهة المخاطَبة (مثل بنك أو جهة حكومية) والغرض'),
      d('Valid trade licence (company NOC) or passport, visa and Emirates ID (employee NOC)', 'رخصة تجارية سارية (لشهادة الشركة) أو جواز السفر والتأشيرة والهوية الإماراتية (لشهادة الموظف)'),
      d('Company signatory authorisation letter, when an employee requests it', 'خطاب تفويض من المفوّض بالتوقيع عند طلب الموظف')
    ],
    steps: [
      'Select "NOC Services" on the DSO e-services portal and choose the NOC category.',
      'Upload the supporting documents and pay with the e-wallet.',
      'Download the digitally verified DSO NOC.'
    ],
    notes: [
      'Common NOC types: opening a UAE corporate bank account; registering a Dubai customs code; opening a mainland branch or adding a DED permit; employee personal NOCs such as a UAE driving licence file, an alcohol licence or family sponsorship.'
    ],
    feeText: 'AED 250', timelineText: '1 working day',
    demoFeeAed: 250, demoDays: 1,
    keywords: {
      en: ['noc', 'n o c', 'no objection', 'no objection certificate', 'no objection letter', 'letter of no objection', 'objection letter', 'permission letter'],
      ar: ['عدم ممانعة', 'شهادة عدم ممانعة', 'خطاب عدم ممانعة', 'رسالة عدم ممانعة', 'ان او سي', 'نوك']
    }
  },
  {
    id: 'leasing',
    name: d('Leasing (commercial and residential)', 'خدمات التأجير'),
    summary: d('Commercial office and desk leases, and residential leases in DSO communities.', 'عقود إيجار المكاتب والمساحات التجارية، والإيجار السكني في مجتمعات الواحة.'),
    voiceSummary: d(
      'DSO handles both commercial office leases and residential leases in communities like Cedre Villas, Semmer Villas, and Palace Towers directly through the digital portal.',
      'تتولى الواحة عقود الإيجار التجارية والسكنية في مجتمعات مثل سيدر فيلاز وسيمر فيلاز وبالاس تاورز مباشرة عبر البوابة الرقمية.'
    ),
    audience: 'both', category: 'property', fulfilment: 'appointment',
    documents: [
      d('Trade licence (commercial lease)', 'الرخصة التجارية (للإيجار التجاري)'),
      d("Manager's passport copy (commercial lease)", 'نسخة من جواز المدير (للإيجار التجاري)'),
      d('Passport copy, UAE residence visa, Emirates ID, security deposit cheque and Ejari registration details (residential lease)', 'نسخة من جواز السفر وإقامة الإمارات والهوية الإماراتية وشيك التأمين وبيانات تسجيل إيجاري (للإيجار السكني)')
    ],
    steps: [
      'Select new lease, lease renewal, or early termination (vacating notice) on the DSO e-services portal.',
      'Review and digitally sign the e-lease contract.',
      'Complete payment and download the lease and Ejari certificate.'
    ],
    notes: [
      'Commercial workspace options (agency reference prices, not DSO tariffs): Flexi Desk up to 2 visas, about AED 18,000 a year for 36 hours a month; Fixed Desk up to 3 visas, about AED 24,000 a year; Furnished Office (12 to 50 square metres) 2 visas per desk, from about AED 47,820 a year.',
      'DSO-managed residential communities: Cedre Villas, Semmer Villas, Palace Towers and Axis Residences.'
    ],
    feeText: 'Lease admin and Ejari processing fee AED 550', timelineText: '2 working days',
    demoFeeAed: 550, demoDays: 2,
    keywords: {
      en: ['lease', 'leasing', 'rent office', 'rent an office', 'office space', 'rent space', 'office rental', 'desk space', 'coworking', 'co working', 'tenancy', 'rent', 'flexi desk', 'fixed desk', 'furnished office', 'ejari'],
      ar: ['إيجار', 'تأجير', 'استئجار', 'مكتب للإيجار', 'مساحة مكتبية', 'مساحة عمل', 'عقد إيجار', 'أبغى أستأجر', 'إيجاري']
    }
  },
  {
    id: 'access_card',
    name: d('Access / ID card', 'بطاقة الدخول'),
    summary: d('The smart card for 24/7 entry to Dtec, DSO offices, parking barriers and residential buildings.', 'البطاقة الذكية للدخول على مدار الساعة إلى دِتيك ومكاتب الواحة وبوابات المواقف والمباني السكنية.'),
    voiceSummary: d(
      'Access and ID cards give 24/7 entry to Dtec, DSO offices, parking barriers, and residential buildings. You apply on the portal and pick up the card at DSO HQ or Dtec reception.',
      'تمنحك بطاقات الدخول والهوية دخولاً على مدار الساعة إلى دِتيك ومكاتب الواحة ومواقف السيارات والمباني السكنية. تقدّم الطلب عبر البوابة وتستلم البطاقة من مقر الواحة أو استقبال دِتيك.'
    ),
    audience: 'both', category: 'access', fulfilment: 'appointment',
    documents: [
      d('Emirates ID or passport copy', 'نسخة من الهوية الإماراتية أو جواز السفر'),
      d('Valid DSO employment visa, Dtec membership agreement, or residential tenancy contract', 'تأشيرة عمل سارية من الواحة، أو اتفاقية عضوية دِتيك، أو عقد إيجار سكني'),
      d('Digital passport-style photograph', 'صورة رقمية بمواصفات صورة الجواز'),
      d('Vehicle registration card (Mulkiya) copy, only for barrier parking access', 'نسخة من رخصة المركبة (ملكية)، فقط لطلب الدخول إلى المواقف')
    ],
    steps: [
      'Submit an "Access / ID Card" request on the DSO e-services portal.',
      'Pay the card issuance or replacement fee.',
      'Collect and activate the smart card at the HALA desk in the DSO HQ or at the Dtec TechnoHub 1 reception.'
    ],
    feeText: 'AED 150 for a new card, AED 200 for a lost or damaged card replacement', timelineText: 'same day, within 24 hours',
    policy:
      'A newly issued card that fails to scan because of a technical defect within 30 days is replaced free of charge (AED 0, demo value) after inspection at reception. ' +
      'If the caller DISPUTES the AED 200 replacement fee (says they never received the card, were wrongly charged, or asks for a waiver): do not argue and do not promise a refund. Acknowledge the concern, explain that waivers and billing adjustments need human authorisation, and hand over at once (reason fee_dispute), or offer an in-person desk appointment (service desk_resolution).',
    demoFeeAed: 150, demoDays: 1,
    keywords: {
      en: ['access card', 'access id card', 'access pass', 'staff card', 'staff id', 'staff badge', 'entry card', 'door card', 'building access', 'access badge', 'badge', 'lost card', 'resident id card', 'member id card'],
      ar: ['بطاقة دخول', 'بطاقة الدخول', 'بطاقة موظف', 'بطاقة تعريف', 'كرت دخول', 'بطاقة الوصول', 'بادج', 'ضاعت البطاقة', 'بطاقة الهوية']
    }
  },
  // ------------------------------------------------------------ residents and everyone
  {
    id: 'maintenance',
    name: d('Maintenance request', 'طلب صيانة'),
    summary: d('Logging a building or unit problem so a technician can be sent.', 'تسجيل عطل في مبنى أو وحدة ليتم إرسال فني.'),
    voiceSummary: d(
      'You can log AC, plumbing, electrical, or building maintenance requests 24/7. Emergency issues are dispatched within two hours, and routine requests within 24 hours.',
      'يمكنك تسجيل طلبات صيانة التكييف أو السباكة أو الكهرباء أو المبنى على مدار الساعة. تُرسل الحالات الطارئة خلال ساعتين، والطلبات العادية خلال أربع وعشرين ساعة.'
    ),
    audience: 'both', category: 'support', fulfilment: 'ticket',
    documents: [
      d('Building or villa community name and the exact office or apartment number', 'اسم المبنى أو مجتمع الفلل ورقم المكتب أو الشقة بالتحديد'),
      d('Issue category (AC, plumbing, electrical, civil or other) and urgency (emergency or routine)', 'نوع العطل (تكييف، سباكة، كهرباء، مدني أو غيره) ودرجة الاستعجال (طارئ أو عادي)'),
      d("Requester's full name and mobile number", 'الاسم الكامل ورقم الجوال لمقدّم الطلب')
    ],
    steps: [
      'Log the request on the DSO e-services portal or with HALA.',
      'Receive an FM ticket reference number and the technician arrival window.',
      'Sign off when the repair is finished.'
    ],
    notes: ['Covered: air conditioning and cooling, electrical faults, water leaks and plumbing, elevator malfunctions, common-area cleaning and security lighting.'],
    feeText: 'AED 0, covered by the standard building or community service charges', timelineText: 'within 2 hours for emergencies, within 24 hours for routine requests',
    demoFeeAed: null, demoDays: 1,
    keywords: {
      en: ['maintenance', 'repair', 'broken', 'not working', 'fix', 'leak', 'leaking', 'water leak', 'ac', 'aircon', 'air conditioning', 'air conditioner', 'lift', 'elevator', 'plumbing', 'no electricity', 'power outage', 'technician'],
      ar: ['صيانة', 'طلب صيانة', 'تصليح', 'إصلاح', 'خربان', 'خراب', 'مكيف', 'تسريب', 'مكسور', 'معطل', 'عطل', 'ما يشتغل', 'لا يعمل', 'مصعد', 'كهرباء', 'سباكة', 'فني']
    },
    agentNote: 'Log a ticket with log_request. Ask for the building or community and the unit or office number, the category and whether it is an emergency or routine, then the name and mobile. Put the category in the details.'
  },
  {
    id: 'complaint',
    name: d('Complaint', 'شكوى'),
    summary: d('Registering a service, community or billing complaint with a tracking reference.', 'تسجيل شكوى عن الخدمة أو المجتمع أو الفواتير مع رقم متابعة.'),
    voiceSummary: d(
      'I can log a formal service or community complaint for you right away with a tracking reference, or connect you directly to a human DSO Happiness officer if it involves a fee dispute.',
      'أقدر أسجّل لك شكوى رسمية عن الخدمة أو المجتمع فوراً مع رقم متابعة، أو أحوّلك مباشرة إلى موظف إسعاد المتعاملين إذا كانت الشكوى عن اعتراض على الرسوم.'
    ),
    audience: 'both', category: 'support', fulfilment: 'ticket',
    documents: [
      d('Complainant full name and contact number or email', 'الاسم الكامل ورقم التواصل أو البريد الإلكتروني لمقدّم الشكوى'),
      d('Company name or residential unit number', 'اسم الشركة أو رقم الوحدة السكنية'),
      d('Related application or invoice number (if available) and a clear summary of the issue', 'رقم الطلب أو الفاتورة المرتبطة (إن وجد) وملخص واضح للمشكلة')
    ],
    steps: [
      'Register the complaint in the DSO Customer Happiness system.',
      'Give the caller a case reference number to track the status.'
    ],
    notes: [
      'Categories: community and residential (noise, unauthorised parking, pet and common-area rules); corporate and service (delayed licence or visa applications, portal errors); financial and billing (disputed invoices, e-wallet deductions, penalty waivers).'
    ],
    feeText: 'Free', timelineText: 'first response from a case officer within 1 working day',
    policy: 'MANDATORY ESCALATION: if the caller disputes a fee, asks for a refund or a penalty waiver, or is upset or impatient, stay calm, validate their frustration and hand over at once (reason fee_dispute or upset_caller). Do not log those as a complaint.',
    demoFeeAed: null, demoDays: 1,
    keywords: {
      en: ['complaint', 'complain', 'file a complaint', 'report a problem', 'unhappy', 'dissatisfied', 'feedback', 'bad service', 'poor service', 'noise complaint', 'suggestion'],
      ar: ['شكوى', 'أشتكي', 'تقديم شكوى', 'أريد أشتكي', 'غير راضي', 'سوء خدمة', 'ملاحظة', 'اقتراح']
    },
    agentNote: 'Logging a complaint is a service: use log_request. BUT if the complaint is a dispute about a fee or charge ("this charge is wrong", "I refuse to pay") or a refund request, do not log it: hand over with reason fee_dispute.'
  },
  {
    id: 'desk_resolution',
    name: d('In-person HALA desk appointment', 'موعد في مكتب هلا'),
    summary: d('A booked slot at the HALA desk to resolve something face to face with a DSO officer.', 'موعد محجوز في مكتب هلا لحل المسألة وجهاً لوجه مع موظف من الواحة.'),
    audience: 'both', category: 'support', fulfilment: 'appointment',
    documents: [d('Any related invoice, card or application number, if available', 'أي رقم فاتورة أو بطاقة أو طلب مرتبط، إن وجد')],
    policy: 'Offer this when a caller with a fee dispute would rather come in than wait for a hand-over. It does not promise any outcome, waiver or refund.',
    demoFeeAed: null, demoDays: null,
    keywords: {
      en: ['in person', 'face to face', 'come to the desk', 'visit the desk', 'visit reception', 'hala desk', 'meet in person', 'resolution slot', 'resolution appointment'],
      ar: ['وجهاً لوجه', 'مقابلة شخصية', 'أزور الاستقبال', 'مكتب هلا', 'أراجع بنفسي', 'موعد في الاستقبال']
    }
  },
  {
    id: 'ewallet_machine',
    name: d('24-hour e-wallet deposit machine', 'جهاز إيداع المحفظة الإلكترونية على مدار 24 ساعة'),
    summary: d('A machine in the lobby of the DSO HQ building where you can top up your DSO e-wallet at any hour.', 'جهاز في ردهة مبنى مقر واحة دبي للسيليكون الرئيسي لإيداع رصيد في محفظتك الإلكترونية في أي وقت.'),
    audience: 'both', category: 'info', fulfilment: 'info',
    documents: [],
    demoFeeAed: null, demoDays: null,
    keywords: {
      en: ['e wallet', 'ewallet', 'wallet', 'deposit machine', 'deposit', 'top up', 'topup', 'recharge wallet', 'cash deposit', 'add money', 'add balance'],
      ar: ['محفظة', 'المحفظة الإلكترونية', 'محفظة إلكترونية', 'إيداع', 'جهاز الإيداع', 'شحن المحفظة', 'شحن رصيد', 'ماكينة إيداع', 'أودع']
    },
    agentNote: 'Info only. The machine is in the lobby of the DSO HQ building and works 24 hours. You cannot check balances or take payments. Do not state fees or limits: they are not known.'
  }
]
