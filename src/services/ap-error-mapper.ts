export interface MappedApError {
  code: string
  title: string
  description: string
  technicalDetails?: string
}

interface ApErrorCopy {
  title: string
  description: string
}

const AP_ERRORS: Record<string, ApErrorCopy> = {
  AP_CANDIDATE_PERMISSION_DENIED: {
    title: 'لا توجد صلاحية لعرض المرشحين',
    description: 'يلزم امتلاك صلاحية قراءة أوامر الشراء وفواتير الموردين معًا لعرض الاستلامات القابلة للفوترة.',
  },
  AP_POST_PERMISSION_DENIED: {
    title: 'لا توجد صلاحية للاعتماد والترحيل',
    description: 'يمكن تجهيز الفاتورة محليًا، لكن اعتمادها وترحيلها يتطلب صلاحية اعتماد فواتير الموردين.',
  },
  AP_IDEMPOTENCY_KEY_REQUIRED: {
    title: 'تعذر تثبيت محاولة الفاتورة',
    description: 'تعذر إنشاء هوية آمنة لإعادة المحاولة. أعد فتح النموذج وحاول مرة أخرى.',
  },
  AP_IDEMPOTENCY_KEY_REUSED: {
    title: 'تغيّرت بيانات محاولة سابقة',
    description: 'استُخدمت هوية المحاولة نفسها مع بيانات مختلفة. راجع الفاتورة ثم أعد المحاولة كعملية جديدة.',
  },
  AP_DUPLICATE_VENDOR_INVOICE_NUMBER: {
    title: 'رقم فاتورة المورد مستخدم مسبقًا',
    description: 'يوجد بالفعل مستند مطابق بهذا الرقم لهذا المورد داخل المؤسسة.',
  },
  AP_LINES_REQUIRED: {
    title: 'لا توجد بنود للفوترة',
    description: 'اختر سطر استلام مقبولًا واحدًا على الأقل.',
  },
  AP_DUPLICATE_GRN_LINE: {
    title: 'سطر استلام مكرر',
    description: 'لا يمكن استخدام سطر الاستلام نفسه أكثر من مرة داخل الفاتورة.',
  },
  AP_GRN_NOT_INVOICEABLE: {
    title: 'سند الاستلام غير قابل للفوترة',
    description: 'تغيّرت حالة سند الاستلام ولم تعد تسمح بالفوترة. حدّث المرشحين وأعد المحاولة.',
  },
  AP_VENDOR_REQUIRED: {
    title: 'المورد مطلوب',
    description: 'اختر موردًا من المرشحين المتاحين قبل المتابعة.',
  },
  AP_INVOICE_NUMBER_REQUIRED: {
    title: 'رقم الفاتورة مطلوب',
    description: 'أدخل رقم فاتورة المورد كما هو في المستند الأصلي.',
  },
  AP_DUE_DATE_BEFORE_INVOICE_DATE: {
    title: 'تاريخ الاستحقاق غير صحيح',
    description: 'لا يمكن أن يكون تاريخ الاستحقاق قبل تاريخ الفاتورة.',
  },
  AP_VENDOR_MISMATCH: {
    title: 'المورد لا يطابق المستندات',
    description: 'المورد المختار لا يطابق أمر الشراء أو سند الاستلام الحالي.',
  },
  AP_PO_NOT_FOUND: {
    title: 'أمر الشراء غير متاح',
    description: 'أمر الشراء غير موجود أو غير ظاهر في المؤسسة الحالية.',
  },
  AP_PO_NOT_INVOICEABLE: {
    title: 'أمر الشراء غير قابل للفوترة',
    description: 'تغيّرت حالة أمر الشراء ولم تعد تسمح بالفوترة في المسار المطابق.',
  },
  AP_GRN_LINE_NOT_FOUND: {
    title: 'سطر الاستلام لم يعد متاحًا',
    description: 'تعذر العثور على سطر الاستلام المختار. حدّث المرشحين وأعد المحاولة.',
  },
  AP_GRN_LINE_NOT_ACCEPTED: {
    title: 'الكمية غير مقبولة للفوترة',
    description: 'لا يمكن فوترة سطر لم تعد حالته مقبولة.',
  },
  AP_GRN_LINE_WITHOUT_PO: {
    title: 'الاستلام غير مرتبط بأمر شراء',
    description: 'هذه الشريحة تدعم فقط الفواتير المطابقة لأمر شراء واستلام مقبول.',
  },
  AP_CROSS_ORG_REFERENCE: {
    title: 'مرجع خارج المؤسسة',
    description: 'أوقف النظام العملية لأن أحد المراجع لا ينتمي إلى المؤسسة الحالية.',
  },
  AP_PRODUCT_MISMATCH: {
    title: 'عدم تطابق المنتج',
    description: 'المنتج في الاستلام لا يطابق لقطة أمر الشراء.',
  },
  AP_QUANTITY_INVALID: {
    title: 'كمية غير صالحة',
    description: 'الكمية القابلة للفوترة يجب أن تكون موجبة.',
  },
  AP_QUANTITY_PRECISION: {
    title: 'دقة الكمية غير مدعومة',
    description: 'تجاوزت الكمية الدقة القانونية للمطابقة. حدّث المرشحين قبل إعادة المحاولة.',
  },
  AP_QUANTITY_EXCEEDS_RECEIPT: {
    title: 'الرصيد تغيّر أثناء العمل',
    description: 'أصبحت الكمية المتاحة أقل من المرشح المعروض، غالبًا بسبب فوترة متزامنة. حدّث المرشحين وأعد المحاولة.',
  },
  AP_PRICE_INVALID: {
    title: 'سعر غير صالح',
    description: 'لقطة سعر أمر الشراء غير صالحة للفوترة.',
  },
  AP_PRICE_VARIANCE_REQUIRES_APPROVAL: {
    title: 'السعر تغيّر عن لقطة أمر الشراء',
    description: 'الشريحة الحالية لا تسمح بفروقات السعر. حدّث المرشحين وراجع أمر الشراء.',
  },
  AP_ALLOCATION_EXCEEDS_RECEIPT: {
    title: 'تجاوز في تخصيص الاستلام',
    description: 'كشف الخادم تعارضًا في رصيد الاستلام وأوقف العملية دون إنشاء جزئي.',
  },
  AP_ALLOCATION_EXCEEDS_PO_ACCEPTED: {
    title: 'تجاوز في المقبول من أمر الشراء',
    description: 'كشف الخادم تعارضًا بين تخصيصات الفاتورة والكمية المقبولة في أمر الشراء.',
  },
  AP_ZERO_INVOICE: {
    title: 'إجمالي الفاتورة غير صالح',
    description: 'لا يمكن اعتماد فاتورة بإجمالي صفري أو سالب.',
  },
  AP_ACCOUNT_MAPPING_MISSING: {
    title: 'إعدادات القيد المحاسبي غير مكتملة',
    description: 'لا توجد خريطة محاسبية مكتملة لفاتورة المورد المطابقة. لم يتم إنشاء الفاتورة أو القيد جزئيًا.',
  },
  AP_ACCOUNT_MAPPING_INCONSISTENT: {
    title: 'إعدادات الحسابات متعارضة',
    description: 'خريطتا البضاعة والضريبة لا تستخدمان حساب الذمم الدائنة نفسه. أوقف الخادم العملية بالكامل.',
  },
  AP_ACCOUNT_NOT_FOUND: {
    title: 'حساب محاسبي غير متاح',
    description: 'أحد الحسابات المحددة في خريطة القيد غير موجود أو لم يعد صالحًا للمسار.',
  },
  AP_MATCHED_INVOICE_ID_MISSING: {
    title: 'استجابة الفاتورة غير مكتملة',
    description: 'لم يعد الخادم معرّف الفاتورة بعد العملية الذرية. لم يتم اعتبار العملية ناجحة.',
  },
  AP_CANDIDATE_RESPONSE_INVALID: {
    title: 'استجابة المرشحين غير صالحة',
    description: 'تعذر قراءة قائمة الاستلامات القابلة للفوترة بشكل آمن.',
  },
  AP_MATCHED_INVOICE_RESPONSE_INVALID: {
    title: 'استجابة الاعتماد غير مكتملة',
    description: 'لم يؤكد الخادم إنشاء الفاتورة والقيد معًا، لذلك لم يتم عرض نجاح للمستخدم.',
  },
  ORG_NOT_RESOLVED: {
    title: 'تعذر تحديد المؤسسة',
    description: 'لم يتمكن النظام من تحديد المؤسسة الحالية بشكل موثوق.',
  },
  PERIOD_CLOSED: {
    title: 'الفترة المحاسبية مغلقة',
    description: 'تاريخ الفاتورة يقع في فترة محاسبية مغلقة ولا يمكن الترحيل إليها.',
  },
}

function errorMessage(error: unknown): string {
  if (typeof error === 'string') return error
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string') return message
  }
  return String(error ?? '')
}

function extractCode(message: string): string {
  const firstLine = (message.trim().split(/\r?\n/, 1)[0] ?? '').trim()
  return (firstLine.split(':', 1)[0] ?? '').trim().toUpperCase()
}

export function mapApError(error: unknown): MappedApError {
  const message = errorMessage(error)
  const code = extractCode(message)
  const copy = AP_ERRORS[code]

  if (copy) {
    return {
      code,
      ...copy,
      technicalDetails: message || undefined,
    }
  }

  return {
    code: code || 'UNKNOWN_AP_ERROR',
    title: 'تعذر إكمال فاتورة المورد',
    description: 'لم يكتمل الاعتماد والترحيل، ولم يتم تسجيل نجاح جزئي. أعد المحاولة أو تواصل مع الدعم إذا استمرت المشكلة.',
    technicalDetails: message || undefined,
  }
}

export function isApError(error: unknown): boolean {
  const code = extractCode(errorMessage(error))
  return code.startsWith('AP_') || code === 'ORG_NOT_RESOLVED' || code === 'PERIOD_CLOSED'
}

export const AP_ERROR_CODES = Object.freeze(Object.keys(AP_ERRORS))
