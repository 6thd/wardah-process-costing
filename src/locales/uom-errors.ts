export const uomErrorTranslations = {
  en: {
    generic: {
      title: 'Unit operation failed',
      description: 'The operation could not be completed. Review the technical details or contact support.',
    },
    productBaseRequired: {
      title: 'Base unit required',
      description: 'Set a legal base unit for this product before continuing.',
    },
    productBaseSpecific: {
      title: 'Invalid base unit',
      description: 'A product-specific unit such as a carton cannot be the legal base unit. Use a standard unit such as KG or PCS.',
    },
    conversionMissing: {
      title: 'Conversion is not configured',
      description: 'There is no active conversion factor for the selected product and unit.',
    },
    categoryMismatch: {
      title: 'Unit category mismatch',
      description: 'The selected unit is not compatible with the product base-unit category.',
    },
    crossDimension: {
      title: 'Cross-dimension conversion is not approved',
      description: 'A conversion between dimensions, such as count and mass, requires an explicit administrative approval.',
    },
    baseFactorOne: {
      title: 'Invalid base-unit factor',
      description: 'The conversion factor of the legal base unit must equal 1.',
    },
    uomUnavailable: {
      title: 'Unit unavailable',
      description: 'The selected unit is missing, inactive, invalid, or unavailable to this organization.',
    },
    bomUnresolved: {
      title: 'BOM units are incomplete',
      description: 'One or more bill-of-material lines have unresolved unit data and must be repaired before explosion.',
    },
    bomProductMissing: {
      title: 'BOM component is incomplete',
      description: 'A bill-of-material component is missing a resolved product or legal base unit.',
    },
    bomQuantityInvalid: {
      title: 'Invalid BOM quantity',
      description: 'Bill-of-material and explosion quantities must be valid positive values.',
    },
    reservationExceeded: {
      title: 'Reservation quantity exceeded',
      description: 'The requested quantity exceeds the reservation balance. Remaining quantity: {{remaining}}.',
    },
    openWipMissing: {
      title: 'No open WIP period',
      description: 'Open a stage WIP log for the current stage and period before consuming material.',
    },
    stageRequired: {
      title: 'Manufacturing stage required',
      description: 'Select the manufacturing stage because it could not be inferred uniquely.',
    },
    warehouseRequired: {
      title: 'Warehouse required',
      description: 'Select the warehouse because it could not be inferred uniquely.',
    },
    workOrderRequired: {
      title: 'Work order required',
      description: 'Select the work order because it could not be inferred uniquely.',
    },
    reservationMissing: {
      title: 'Active reservation not found',
      description: 'No active material reservation is available for this consumption line.',
    },
    quantityPositive: {
      title: 'Invalid quantity',
      description: 'The entered quantity must be greater than zero.',
    },
    quantityNonnegative: {
      title: 'Invalid quantity',
      description: 'The entered quantity cannot be negative.',
    },
    priceNonnegative: {
      title: 'Invalid price',
      description: 'The entered unit price cannot be negative.',
    },
    weightNotDeclared: {
      title: 'Product weight is not declared',
      description: 'Weight preview is unavailable until a physical product weight is configured.',
    },
    weightUomMass: {
      title: 'Invalid weight unit',
      description: 'The physical-weight unit must be an active mass unit.',
    },
    netWeightPositive: {
      title: 'Invalid net weight',
      description: 'Net weight must be greater than zero.',
    },
    grossBelowNet: {
      title: 'Invalid gross weight',
      description: 'Gross weight cannot be lower than net weight.',
    },
    idempotencyReused: {
      title: 'Document was already submitted',
      description: 'This idempotency key was previously used with different document data.',
    },
    stockMovementFailed: {
      title: 'Stock movement was not applied',
      description: 'The stock movement failed atomically and no partial inventory update was saved.',
    },
    customCodeInvalid: {
      title: 'Invalid unit code',
      description: 'Use an uppercase code that starts with a letter and contains only letters, numbers, and underscores.',
    },
    customNameSymbolRequired: {
      title: 'Unit name and symbol required',
      description: 'Enter both a unit name and a display symbol.',
    },
    categoryNotFound: {
      title: 'Unit category not found',
      description: 'Select an existing unit category.',
    },
    factorPositive: {
      title: 'Invalid conversion factor',
      description: 'A standard or product conversion factor must be greater than zero.',
    },
    productSpecificFactorNull: {
      title: 'Invalid product-specific unit',
      description: 'A product-specific unit must not define a global category conversion factor.',
    },
    decimalPlacesInvalid: {
      title: 'Invalid decimal precision',
      description: 'Decimal places must be between 0 and 12.',
    },
    systemCodeReserved: {
      title: 'Unit code is reserved',
      description: 'This code belongs to a shared system unit and cannot be reused by the organization.',
    },
    systemAliasReserved: {
      title: 'Unit alias is reserved',
      description: 'This alias belongs to a shared system unit and cannot be reused by the organization.',
    },
    productContextInvalid: {
      title: 'Invalid product-unit context',
      description: 'The product and unit context is incomplete or does not belong to the active organization.',
    },
    productNotFound: {
      title: 'Product unavailable',
      description: 'The product was not found or does not belong to the active organization.',
    },
    productBaseInvalid: {
      title: 'Product base unit is invalid',
      description: 'The configured product base unit is missing, inactive, or unavailable to the active organization.',
    },
    conversionResponseInvalid: {
      title: 'Invalid conversion response',
      description: 'The server did not return a valid legal conversion result.',
    },
    conversionSaveFailed: {
      title: 'Conversion was not saved',
      description: 'The server did not confirm that the versioned product conversion was saved.',
    },
    weightSaveFailed: {
      title: 'Product weight was not saved',
      description: 'The server did not confirm that the physical product weight was saved.',
    },
    weightLookupFailed: {
      title: 'Weight calculation failed',
      description: 'The server did not return a valid product-weight result.',
    },
    productOptionsInvalid: {
      title: 'Invalid product-unit data',
      description: 'The server returned an invalid product unit catalog response.',
    },
  },
  ar: {
    generic: {
      title: 'تعذر تنفيذ عملية الوحدة',
      description: 'لم تكتمل العملية. راجع التفاصيل التقنية أو تواصل مع الدعم.',
    },
    productBaseRequired: {
      title: 'وحدة الأساس مطلوبة',
      description: 'حدد وحدة الأساس القانونية للصنف قبل المتابعة.',
    },
    productBaseSpecific: {
      title: 'وحدة أساس غير صالحة',
      description: 'لا يمكن جعل وحدة خاصة بالصنف مثل الكرتون وحدة الأساس القانونية. استخدم وحدة معيارية مثل KG أو PCS.',
    },
    conversionMissing: {
      title: 'عامل التحويل غير مهيأ',
      description: 'لا يوجد عامل تحويل ساري للصنف والوحدة المحددين.',
    },
    categoryMismatch: {
      title: 'فئة الوحدة غير متوافقة',
      description: 'الوحدة المحددة لا تتوافق مع فئة وحدة الأساس للصنف.',
    },
    crossDimension: {
      title: 'التحويل العابر للفئات غير معتمد',
      description: 'التحويل بين أبعاد مختلفة، مثل العدد والوزن، يحتاج اعتمادًا إداريًا صريحًا.',
    },
    baseFactorOne: {
      title: 'عامل وحدة الأساس غير صالح',
      description: 'يجب أن يساوي عامل تحويل وحدة الأساس القانونية 1.',
    },
    uomUnavailable: {
      title: 'الوحدة غير متاحة',
      description: 'الوحدة المحددة غير موجودة أو موقوفة أو غير صالحة أو غير متاحة لهذه المؤسسة.',
    },
    bomUnresolved: {
      title: 'وحدات قائمة المواد غير مكتملة',
      description: 'توجد أسطر في قائمة المواد ببيانات وحدات غير محسومة ويجب إصلاحها قبل التفجير.',
    },
    bomProductMissing: {
      title: 'مكوّن قائمة المواد غير مكتمل',
      description: 'أحد مكونات قائمة المواد بلا صنف محسوم أو وحدة أساس قانونية.',
    },
    bomQuantityInvalid: {
      title: 'كمية قائمة المواد غير صالحة',
      description: 'يجب أن تكون كميات قائمة المواد والتفجير قيمًا موجبة وصالحة.',
    },
    reservationExceeded: {
      title: 'تجاوز كمية الحجز',
      description: 'الكمية المطلوبة تتجاوز رصيد الحجز. الكمية المتبقية: {{remaining}}.',
    },
    openWipMissing: {
      title: 'لا توجد فترة تحت التشغيل مفتوحة',
      description: 'افتح سجل تحت التشغيل للمرحلة والفترة الحالية قبل خصم المواد.',
    },
    stageRequired: {
      title: 'مرحلة التصنيع مطلوبة',
      description: 'حدد مرحلة التصنيع لتعذر استنتاجها بصورة وحيدة.',
    },
    warehouseRequired: {
      title: 'المخزن مطلوب',
      description: 'حدد المخزن لتعذر استنتاجه بصورة وحيدة.',
    },
    workOrderRequired: {
      title: 'أمر العمل مطلوب',
      description: 'حدد أمر العمل لتعذر استنتاجه بصورة وحيدة.',
    },
    reservationMissing: {
      title: 'لا يوجد حجز نشط',
      description: 'لا يوجد حجز مواد نشط متاح لسطر الاستهلاك هذا.',
    },
    quantityPositive: {
      title: 'الكمية غير صالحة',
      description: 'يجب أن تكون الكمية المدخلة أكبر من صفر.',
    },
    quantityNonnegative: {
      title: 'الكمية غير صالحة',
      description: 'لا يجوز أن تكون الكمية المدخلة سالبة.',
    },
    priceNonnegative: {
      title: 'السعر غير صالح',
      description: 'لا يجوز أن يكون سعر الوحدة المدخل سالبًا.',
    },
    weightNotDeclared: {
      title: 'وزن الصنف غير معرّف',
      description: 'معاينة الوزن غير متاحة حتى يتم تعريف الوزن الفيزيائي للصنف.',
    },
    weightUomMass: {
      title: 'وحدة الوزن غير صالحة',
      description: 'يجب أن تكون وحدة الوزن الفيزيائي وحدة كتلة نشطة.',
    },
    netWeightPositive: {
      title: 'الوزن الصافي غير صالح',
      description: 'يجب أن يكون الوزن الصافي أكبر من صفر.',
    },
    grossBelowNet: {
      title: 'الوزن الإجمالي غير صالح',
      description: 'لا يجوز أن يقل الوزن الإجمالي عن الوزن الصافي.',
    },
    idempotencyReused: {
      title: 'تم إرسال المستند سابقًا',
      description: 'استُخدم مفتاح منع التكرار نفسه سابقًا مع بيانات مستند مختلفة.',
    },
    stockMovementFailed: {
      title: 'لم تُنفذ الحركة المخزنية',
      description: 'فشلت الحركة المخزنية ذريًا ولم يُحفظ أي تحديث جزئي للمخزون.',
    },
    customCodeInvalid: {
      title: 'رمز الوحدة غير صالح',
      description: 'استخدم رمزًا إنجليزيًا كبيرًا يبدأ بحرف ويحتوي حروفًا وأرقامًا وشرطة سفلية فقط.',
    },
    customNameSymbolRequired: {
      title: 'اسم الوحدة ورمزها مطلوبان',
      description: 'أدخل اسم الوحدة ورمز العرض معًا.',
    },
    categoryNotFound: {
      title: 'فئة الوحدة غير موجودة',
      description: 'اختر فئة وحدات موجودة.',
    },
    factorPositive: {
      title: 'عامل التحويل غير صالح',
      description: 'يجب أن يكون عامل التحويل المعياري أو الخاص بالصنف أكبر من صفر.',
    },
    productSpecificFactorNull: {
      title: 'الوحدة الخاصة بالصنف غير صالحة',
      description: 'يجب ألا تحمل الوحدة الخاصة بالصنف عامل تحويل عام على مستوى الفئة.',
    },
    decimalPlacesInvalid: {
      title: 'دقة الكسور غير صالحة',
      description: 'يجب أن تكون المنازل العشرية بين 0 و12.',
    },
    systemCodeReserved: {
      title: 'رمز الوحدة محجوز',
      description: 'هذا الرمز تابع لوحدة نظام مشتركة ولا يمكن للمؤسسة إعادة استخدامه.',
    },
    systemAliasReserved: {
      title: 'الاسم البديل للوحدة محجوز',
      description: 'هذا الاسم البديل تابع لوحدة نظام مشتركة ولا يمكن للمؤسسة إعادة استخدامه.',
    },
    productContextInvalid: {
      title: 'سياق الصنف والوحدة غير صالح',
      description: 'بيانات الصنف والوحدة غير مكتملة أو لا تتبع المؤسسة النشطة.',
    },
    productNotFound: {
      title: 'الصنف غير متاح',
      description: 'الصنف غير موجود أو لا يتبع المؤسسة النشطة.',
    },
    productBaseInvalid: {
      title: 'وحدة أساس الصنف غير صالحة',
      description: 'وحدة أساس الصنف المهيأة غير موجودة أو موقوفة أو غير متاحة للمؤسسة النشطة.',
    },
    conversionResponseInvalid: {
      title: 'استجابة التحويل غير صالحة',
      description: 'لم يُرجع الخادم نتيجة تحويل قانونية صالحة.',
    },
    conversionSaveFailed: {
      title: 'لم يُحفظ عامل التحويل',
      description: 'لم يؤكد الخادم حفظ تحويل الصنف المؤرخ.',
    },
    weightSaveFailed: {
      title: 'لم يُحفظ وزن الصنف',
      description: 'لم يؤكد الخادم حفظ الوزن الفيزيائي للصنف.',
    },
    weightLookupFailed: {
      title: 'فشل حساب الوزن',
      description: 'لم يُرجع الخادم نتيجة صالحة لوزن الصنف.',
    },
    productOptionsInvalid: {
      title: 'بيانات وحدات الصنف غير صالحة',
      description: 'أعاد الخادم استجابة غير صالحة لكتالوج وحدات الصنف.',
    },
  },
} as const

export type UomErrorTranslationKey = keyof typeof uomErrorTranslations.en
