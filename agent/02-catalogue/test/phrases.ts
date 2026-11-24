/** What callers actually say, per service. Used by the matcher tests and by the evals. */
export const PHRASES: Record<string, { en: string[]; ar: string[] }> = {
  visa_new: {
    en: [
      'I need a visa for my new employee',
      'we just hired someone and need a new employment visa',
      'how do I get a work visa for a new hire',
      'I want to sponsor a new employee visa',
      'new visa please',
      'we are recruiting a developer and need his visa processed',
      'apply for an employment visa',
      'hiring a new employee, what do I need for the visa'
    ],
    ar: [
      'أحتاج تأشيرة لموظف جديد',
      'أريد تأشيرة عمل جديدة',
      'عندنا موظف جديد ونبغى له فيزا',
      'كيف أستخرج تأشيرة جديدة',
      'توظيف موظف جديد وأحتاج تأشيرة',
      'أبغى فيزا عمل لموظف جديد',
      'استقدام موظف جديد',
      'طلب تأشيرة موظف جديد'
    ]
  },
  visa_renewal: {
    en: [
      'I need to renew an employee visa',
      'visa renewal',
      "how do I renew my employee's work visa",
      'our visa is expiring next week',
      'renew employment visa please',
      'I want to extend a visa',
      'renewing the residency of one of our staff',
      'my visa expires soon and I need to renew it'
    ],
    ar: [
      'أريد تجديد تأشيرة عمل لموظف',
      'تجديد تأشيرة',
      'أحتاج تجديد فيزا موظف',
      'تأشيرتي تنتهي الأسبوع القادم وأريد تجديدها',
      'أبغى أجدد إقامة موظف',
      'كيف أجدد تأشيرة عمل',
      'تجديد الإقامة لموظف عندنا',
      'تمديد تأشيرة موظف'
    ]
  },
  visa_cancel: {
    en: [
      'I want to cancel an employee visa',
      'visa cancellation',
      'our employee resigned and we need to cancel his visa',
      'cancel work visa please',
      'an employee is leaving, how do I cancel the visa',
      'terminate the visa of a staff member',
      'cancel the employment visa',
      'how can I cancel a visa for someone who resigned'
    ],
    ar: [
      'أريد إلغاء تأشيرة موظف',
      'إلغاء فيزا',
      'موظف استقال ونريد إلغاء تأشيرته',
      'كيف ألغي تأشيرة عمل',
      'أبغى ألغي إقامة موظف',
      'إلغاء تأشيرة عمل',
      'إنهاء تأشيرة موظف',
      'استقالة موظف وأحتاج إلغاء الفيزا'
    ]
  },
  establishment_card: {
    en: [
      'I need an establishment card',
      'how do I renew the establishment card',
      'company immigration card',
      'new establishment card for our company',
      'establishment registration',
      'I want the company card for immigration',
      'where do I get the establishment card',
      'what is needed for an establishment card'
    ],
    ar: [
      'أحتاج بطاقة المنشأة',
      'كيف أجدد بطاقة المنشأة',
      'بطاقة الشركة للهجرة',
      'أريد بطاقة منشأة جديدة',
      'تسجيل المنشأة',
      'ما المطلوب لبطاقة المنشأة',
      'أبغى كرت المنشأة',
      'بطاقة الهجرة للشركة'
    ]
  },
  licence_renewal: {
    en: [
      'I need to renew our trade licence',
      'licence renewal',
      'our license is expiring',
      'how do I renew the company licence',
      'renew license please',
      'trade license renewal for next year',
      'renewing my business licence',
      'the licence expires this month'
    ],
    ar: [
      'أريد تجديد الرخصة التجارية',
      'تجديد الرخصة',
      'رخصة الشركة تنتهي قريباً',
      'كيف أجدد رخصة الشركة',
      'أبغى أجدد الرخصة',
      'تجديد رخصة تجارية',
      'انتهت الرخصة وأحتاج تجديدها',
      'أحتاج تجديد رخصة شركتنا'
    ]
  },
  licence_amendment: {
    en: [
      'I need to amend our licence',
      'licence amendment',
      'we want to add an activity to the license',
      'how do I change the company name',
      'add a shareholder to the licence',
      'modify the trade licence',
      'update our license details',
      'change our business activity'
    ],
    ar: [
      'أريد تعديل الرخصة',
      'تعديل رخصة الشركة',
      'نبغى نضيف نشاط للرخصة',
      'كيف أغير اسم الشركة',
      'إضافة شريك للرخصة',
      'أحتاج تعديل بيانات الشركة',
      'تغيير النشاط التجاري',
      'أريد تعديل رخصتنا التجارية'
    ]
  },
  noc: {
    en: [
      'I need an NOC',
      'no objection certificate please',
      'how do I get a no objection letter',
      'we need a letter of no objection for an employee',
      'NOC for transfer',
      'can you issue a no objection certificate',
      'request an NOC letter',
      'what do I need for a no objection'
    ],
    ar: [
      'أحتاج شهادة عدم ممانعة',
      'أريد خطاب عدم ممانعة',
      'كيف أستخرج شهادة عدم ممانعة',
      'طلب عدم ممانعة لموظف',
      'أبغى عدم ممانعة',
      'نحتاج رسالة عدم ممانعة',
      'استخراج شهادة عدم ممانعة',
      'أريد ان او سي'
    ]
  },
  leasing: {
    en: [
      'I want to rent an office',
      'leasing enquiry',
      'do you have office space available',
      'how much to lease a desk',
      'we are looking for coworking space',
      'I would like to rent space in DSO',
      'office rental options',
      'tenancy for a small startup'
    ],
    ar: [
      'أريد استئجار مكتب',
      'استفسار عن التأجير',
      'هل عندكم مساحة مكتبية',
      'أبغى أستأجر مكتب',
      'أحتاج مكتب للإيجار',
      'عقد إيجار لشركتنا',
      'أبحث عن مساحة عمل',
      'تأجير مكاتب في الواحة'
    ]
  },
  access_card: {
    en: [
      'how do I get an access card',
      'I need a staff badge for a new employee',
      'my access card is lost',
      'I want an entry card for the building',
      'access pass for an employee',
      'door card please',
      'I need a staff ID',
      'building access for my team'
    ],
    ar: [
      'كيف أحصل على بطاقة دخول',
      'أحتاج بطاقة دخول لموظف',
      'ضاعت بطاقة الدخول',
      'أريد بطاقة موظف',
      'بطاقة الوصول للمبنى',
      'أبغى كرت دخول',
      'أحتاج بادج للموظفين',
      'بطاقة تعريف للدخول'
    ]
  },
  maintenance: {
    en: [
      'my AC is broken',
      'there is a water leak in my unit',
      'the lift is not working',
      'I need a maintenance request',
      'the lights in the office are not working',
      'can you send a technician, the aircon stopped',
      'something is broken in the apartment',
      'we have no electricity in the office'
    ],
    ar: [
      'أحتاج طلب صيانة',
      'المكيف خربان',
      'في تسريب مياه في الوحدة',
      'المصعد معطل',
      'ما يشتغل المكيف في المكتب',
      'أبغى فني لإصلاح عطل',
      'الكهرباء مقطوعة في الشقة',
      'عندي عطل في السباكة'
    ]
  },
  complaint: {
    en: [
      'I want to file a complaint',
      'I would like to complain about the noise',
      'I am unhappy with the service',
      'I need to report a problem',
      'I have some feedback about the reception',
      'poor service yesterday and I want to complain',
      'I have a suggestion',
      'I want to make a complaint'
    ],
    ar: [
      'أريد تقديم شكوى',
      'أبغى أشتكي',
      'أنا غير راضي عن الخدمة',
      'عندي ملاحظة على الاستقبال',
      'أريد أن أقدم شكوى عن الضوضاء',
      'سوء خدمة وأريد أشتكي',
      'عندي اقتراح',
      'كيف أقدم شكوى'
    ]
  },
  ewallet_machine: {
    en: [
      'where is the e-wallet deposit machine',
      'how can I top up my wallet',
      'I want to deposit money in my e wallet',
      'is there a cash deposit machine',
      'where can I recharge my wallet',
      'ewallet top up at night',
      'I need to add balance to my wallet',
      'deposit machine location'
    ],
    ar: [
      'وين جهاز إيداع المحفظة',
      'كيف أشحن المحفظة الإلكترونية',
      'أبغى أودع في المحفظة',
      'أين ماكينة الإيداع',
      'أريد شحن رصيد المحفظة',
      'هل يوجد جهاز إيداع',
      'شحن المحفظة في الليل',
      'أحتاج إيداع في محفظتي الإلكترونية'
    ]
  }
}
