export interface UomErrorCopy {
  title: string
  description: string
}

type LocalizedUomErrorCopy = readonly [
  enTitle: string,
  enDescription: string,
  arTitle: string,
  arDescription: string,
]

const UOM_ERROR_COPY = {
  generic: ['Unit operation failed', 'The operation could not be completed. Review the technical details or contact support.', 'تعذر تنفيذ عملية الوحدة', 'لم تكتمل العملية. راجع التفاصيل التقنية أو تواصل مع الدعم.'],
  productBaseRequired: ['Base unit required', 'Set a legal base unit for this product before continuing.', 'وحدة الأساس مطلوبة', 'حدد وحدة الأساس القانونية للصنف قبل المتابعة.'],
  productBaseSpecific: ['Invalid base unit', 'A product-specific unit such as a carton cannot be the legal base unit. Use a standard unit such as KG or PCS.', 'وحدة أساس غير صالحة', 'لا يمكن جعل وحدة خاصة بالصنف مثل الكرتون وحدة الأساس القانونية. استخدم وحدة معيارية مثل KG أو PCS.'],
  conversionMissing: ['Conversion is not configured', 'There is no active conversion factor for the selected product and unit.', 'عامل التحويل غير مهيأ', 'لا يوجد عامل تحويل ساري للصنف والوحدة المحددين.'],
  categoryMismatch: ['Unit category mismatch', 'The selected unit is not compatible with the product base-unit category.', 'فئة الوحدة غير متوافقة', 'الوحدة المحددة لا تتوافق مع فئة وحدة الأساس للصنف.'],
  crossDimension: ['Cross-dimension conversion is not approved', 'A conversion between dimensions, such as count and mass, requires an explicit administrative approval.', 'التحويل العابر للفئات غير معتمد', 'التحويل بين أبعاد مختلفة، مثل العدد والوزن، يحتاج اعتمادًا إداريًا صريحًا.'],
  baseFactorOne: ['Invalid base-unit factor', 'The conversion factor of the legal base unit must equal 1.', 'عامل وحدة الأساس غير صالح', 'يجب أن يساوي عامل تحويل وحدة الأساس القانونية 1.'],
  uomUnavailable: ['Unit unavailable', 'The selected unit is missing, inactive, invalid, or unavailable to this organization.', 'الوحدة غير متاحة', 'الوحدة المحددة غير موجودة أو موقوفة أو غير صالحة أو غير متاحة لهذه المؤسسة.'],
  bomUnresolved: ['BOM units are incomplete', 'One or more bill-of-material lines have unresolved unit data and must be repaired before explosion.', 'وحدات قائمة المواد غير مكتملة', 'توجد أسطر في قائمة المواد ببيانات وحدات غير محسومة ويجب إصلاحها قبل التفجير.'],
  bomProductMissing: ['BOM component is incomplete', 'A bill-of-material component is missing a resolved product or legal base unit.', 'مكوّن قائمة المواد غير مكتمل', 'أحد مكونات قائمة المواد بلا صنف محسوم أو وحدة أساس قانونية.'],
  bomQuantityInvalid: ['Invalid BOM quantity', 'Bill-of-material and explosion quantities must be valid positive values.', 'كمية قائمة المواد غير صالحة', 'يجب أن تكون كميات قائمة المواد والتفجير قيمًا موجبة وصالحة.'],
  reservationExceeded: ['Reservation quantity exceeded', 'The requested quantity exceeds the reservation balance. Remaining quantity: {{remaining}}.', 'تجاوز كمية الحجز', 'الكمية المطلوبة تتجاوز رصيد الحجز. الكمية المتبقية: {{remaining}}.'],
  openWipMissing: ['No open WIP period', 'Open a stage WIP log for the current stage and period before consuming material.', 'لا توجد فترة تحت التشغيل مفتوحة', 'افتح سجل تحت التشغيل للمرحلة والفترة الحالية قبل خصم المواد.'],
  stageRequired: ['Manufacturing stage required', 'Select the manufacturing stage because it could not be inferred uniquely.', 'مرحلة التصنيع مطلوبة', 'حدد مرحلة التصنيع لتعذر استنتاجها بصورة وحيدة.'],
  warehouseRequired: ['Warehouse required', 'Select the warehouse because it could not be inferred uniquely.', 'المخزن مطلوب', 'حدد المخزن لتعذر استنتاجه بصورة وحيدة.'],
  workOrderRequired: ['Work order required', 'Select the work order because it could not be inferred uniquely.', 'أمر العمل مطلوب', 'حدد أمر العمل لتعذر استنتاجه بصورة وحيدة.'],
  reservationMissing: ['Active reservation not found', 'No active material reservation is available for this consumption line.', 'لا يوجد حجز نشط', 'لا يوجد حجز مواد نشط متاح لسطر الاستهلاك هذا.'],
  quantityPositive: ['Invalid quantity', 'The entered quantity must be greater than zero.', 'الكمية غير صالحة', 'يجب أن تكون الكمية المدخلة أكبر من صفر.'],
  quantityNonnegative: ['Invalid quantity', 'The entered quantity cannot be negative.', 'الكمية غير صالحة', 'لا يجوز أن تكون الكمية المدخلة سالبة.'],
  priceNonnegative: ['Invalid price', 'The entered unit price cannot be negative.', 'السعر غير صالح', 'لا يجوز أن يكون سعر الوحدة المدخل سالبًا.'],
  weightNotDeclared: ['Product weight is not declared', 'Weight preview is unavailable until a physical product weight is configured.', 'وزن الصنف غير معرّف', 'معاينة الوزن غير متاحة حتى يتم تعريف الوزن الفيزيائي للصنف.'],
  weightUomMass: ['Invalid weight unit', 'The physical-weight unit must be an active mass unit.', 'وحدة الوزن غير صالحة', 'يجب أن تكون وحدة الوزن الفيزيائي وحدة كتلة نشطة.'],
  netWeightPositive: ['Invalid net weight', 'Net weight must be greater than zero.', 'الوزن الصافي غير صالح', 'يجب أن يكون الوزن الصافي أكبر من صفر.'],
  grossBelowNet: ['Invalid gross weight', 'Gross weight cannot be lower than net weight.', 'الوزن الإجمالي غير صالح', 'لا يجوز أن يقل الوزن الإجمالي عن الوزن الصافي.'],
  idempotencyReused: ['Document was already submitted', 'This idempotency key was previously used with different document data.', 'تم إرسال المستند سابقًا', 'استُخدم مفتاح منع التكرار نفسه سابقًا مع بيانات مستند مختلفة.'],
  stockMovementFailed: ['Stock movement was not applied', 'The stock movement failed atomically and no partial inventory update was saved.', 'لم تُنفذ الحركة المخزنية', 'فشلت الحركة المخزنية ذريًا ولم يُحفظ أي تحديث جزئي للمخزون.'],
  customCodeInvalid: ['Invalid unit code', 'Use an uppercase code that starts with a letter and contains only letters, numbers, and underscores.', 'رمز الوحدة غير صالح', 'استخدم رمزًا إنجليزيًا كبيرًا يبدأ بحرف ويحتوي حروفًا وأرقامًا وشرطة سفلية فقط.'],
  customNameSymbolRequired: ['Unit name and symbol required', 'Enter both a unit name and a display symbol.', 'اسم الوحدة ورمزها مطلوبان', 'أدخل اسم الوحدة ورمز العرض معًا.'],
  categoryNotFound: ['Unit category not found', 'Select an existing unit category.', 'فئة الوحدة غير موجودة', 'اختر فئة وحدات موجودة.'],
  factorPositive: ['Invalid conversion factor', 'A standard or product conversion factor must be greater than zero.', 'عامل التحويل غير صالح', 'يجب أن يكون عامل التحويل المعياري أو الخاص بالصنف أكبر من صفر.'],
  productSpecificFactorNull: ['Invalid product-specific unit', 'A product-specific unit must not define a global category conversion factor.', 'الوحدة الخاصة بالصنف غير صالحة', 'يجب ألا تحمل الوحدة الخاصة بالصنف عامل تحويل عام على مستوى الفئة.'],
  decimalPlacesInvalid: ['Invalid decimal precision', 'Decimal places must be between 0 and 12.', 'دقة الكسور غير صالحة', 'يجب أن تكون المنازل العشرية بين 0 و12.'],
  systemCodeReserved: ['Unit code is reserved', 'This code belongs to a shared system unit and cannot be reused by the organization.', 'رمز الوحدة محجوز', 'هذا الرمز تابع لوحدة نظام مشتركة ولا يمكن للمؤسسة إعادة استخدامه.'],
  systemAliasReserved: ['Unit alias is reserved', 'This alias belongs to a shared system unit and cannot be reused by the organization.', 'الاسم البديل للوحدة محجوز', 'هذا الاسم البديل تابع لوحدة نظام مشتركة ولا يمكن للمؤسسة إعادة استخدامه.'],
  productContextInvalid: ['Invalid product-unit context', 'The product and unit context is incomplete or does not belong to the active organization.', 'سياق الصنف والوحدة غير صالح', 'بيانات الصنف والوحدة غير مكتملة أو لا تتبع المؤسسة النشطة.'],
  productNotFound: ['Product unavailable', 'The product was not found or does not belong to the active organization.', 'الصنف غير متاح', 'الصنف غير موجود أو لا يتبع المؤسسة النشطة.'],
  productBaseInvalid: ['Product base unit is invalid', 'The configured product base unit is missing, inactive, or unavailable to the active organization.', 'وحدة أساس الصنف غير صالحة', 'وحدة أساس الصنف المهيأة غير موجودة أو موقوفة أو غير متاحة للمؤسسة النشطة.'],
  conversionResponseInvalid: ['Invalid conversion response', 'The server did not return a valid legal conversion result.', 'استجابة التحويل غير صالحة', 'لم يُرجع الخادم نتيجة تحويل قانونية صالحة.'],
  conversionSaveFailed: ['Conversion was not saved', 'The server did not confirm that the versioned product conversion was saved.', 'لم يُحفظ عامل التحويل', 'لم يؤكد الخادم حفظ تحويل الصنف المؤرخ.'],
  weightSaveFailed: ['Product weight was not saved', 'The server did not confirm that the physical product weight was saved.', 'لم يُحفظ وزن الصنف', 'لم يؤكد الخادم حفظ الوزن الفيزيائي للصنف.'],
  weightLookupFailed: ['Weight calculation failed', 'The server did not return a valid product-weight result.', 'فشل حساب الوزن', 'لم يُرجع الخادم نتيجة صالحة لوزن الصنف.'],
  productOptionsInvalid: ['Invalid product-unit data', 'The server returned an invalid product unit catalog response.', 'بيانات وحدات الصنف غير صالحة', 'أعاد الخادم استجابة غير صالحة لكتالوج وحدات الصنف.'],
  baseUomLocked: ['Base unit is locked', 'This product already has stock movements, so its legal base unit can no longer be changed.', 'وحدة الأساس مقفلة', 'يملك هذا الصنف حركات مخزون بالفعل، لذلك لا يمكن تغيير وحدة الأساس القانونية بعد الآن.'],
  baseUomUnchanged: ['Base unit unchanged', 'The selected unit is already the product base unit.', 'وحدة الأساس دون تغيير', 'الوحدة المحددة هي وحدة الأساس الحالية للصنف بالفعل.'],
  baseUomAssignFailed: ['Base unit was not assigned', 'The server did not confirm that the product base unit was assigned.', 'لم تُعيَّن وحدة الأساس', 'لم يؤكد الخادم تعيين وحدة الأساس للصنف.'],
  backfillIssueUnavailable: ['Issue unavailable', 'The backfill issue was not found, is not open, or does not belong to the active organization.', 'المشكلة غير متاحة', 'مشكلة المواءمة غير موجودة أو ليست مفتوحة أو لا تتبع المؤسسة النشطة.'],
  backfillActionFailed: ['Action was not applied', 'The server did not confirm the backfill issue update.', 'لم يُطبَّق الإجراء', 'لم يؤكد الخادم تحديث مشكلة المواءمة.'],
  backfillSourceNotResolved: ['Fix the source first', 'This issue cannot be resolved until its underlying record is actually repaired — assign the product base unit, map the item, or complete the BOM line.', 'أصلح المصدر أولًا', 'لا يمكن حل هذه المشكلة حتى يُصلَح سجلها الأساسي فعليًا — عيّن وحدة أساس الصنف، أو اربط العنصر، أو أكمل سطر قائمة المواد.'],
  ignoreNoteRequired: ['A reason is required', 'Enter a reason before ignoring this issue.', 'السبب مطلوب', 'أدخل سبب التجاهل قبل تجاهل هذه المشكلة.'],
} as const satisfies Record<string, LocalizedUomErrorCopy>

export type UomErrorTranslationKey = keyof typeof UOM_ERROR_COPY

type UomErrorTranslationCatalog = Record<UomErrorTranslationKey, UomErrorCopy>

function buildCatalog(language: 'en' | 'ar'): UomErrorTranslationCatalog {
  return Object.fromEntries(
    Object.entries(UOM_ERROR_COPY).map(([key, copy]) => {
      const [enTitle, enDescription, arTitle, arDescription] = copy
      const localized = language === 'en'
        ? { title: enTitle, description: enDescription }
        : { title: arTitle, description: arDescription }
      return [key, localized]
    }),
  ) as UomErrorTranslationCatalog
}

export const uomErrorTranslations = {
  en: buildCatalog('en'),
  ar: buildCatalog('ar'),
} as const
