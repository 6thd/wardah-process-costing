# Architecture Decision Records (ADRs)

## ما هو ADR؟

**ADR** (Architecture Decision Record) هو توثيق للقرارات المعمارية المهمة مع السياق والعواقب.

### لماذا نستخدم ADRs؟

1. ✅ **ذاكرة جماعية**: لماذا اتخذنا هذا القرار؟
2. ✅ **Onboarding**: المطورون الجدد يفهمون السياق
3. ✅ **Audit Trail**: تتبع تطور المعمارية
4. ✅ **منع إعادة النقاشات**: القرارات موثقة

---

## القرارات المعمارية

### ✅ مقبولة (Accepted)

| #ID | Title | Date | Status |
|-----|-------|------|--------|
| [ADR-001](./ADR-001-Clean-Architecture.md) | تبني Clean Architecture | 2025-12-13 | ✅ Accepted |
| [ADR-002](./ADR-002-CQRS-Pattern.md) | تبني CQRS Pattern | 2025-12-13 | ✅ Accepted |
| [ADR-003](./ADR-003-Process-Costing-Implementation.md) | Process Costing Implementation (EUP, Scrap, FIFO) | 2025-12-25 | ✅ Accepted |

**مرتبط بالتنفيذ:** [خطة التصنيع المتقدمة — إغلاق فجوات المحرك/الواجهة](../features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md) · [Known Limitations](./PROCESS_COSTING_LIMITATIONS.md)

### ⏳ قيد المراجعة (Proposed)

_لا يوجد حالياً_

### ❌ مرفوضة (Rejected)

_لا يوجد حالياً_

### 🔄 مستبدلة (Superseded)

_لا يوجد حالياً_

---

## تنسيق ADR

كل ADR يجب أن يحتوي على:

```markdown
# ADR-XXX: عنوان القرار

**التاريخ:** YYYY-MM-DD
**الحالة:** ✅ مقبول | ⏳ مقترح | ❌ مرفوض | 🔄 مستبدل
**صاحب القرار:** اسم الفريق/الشخص
**مرتبط بـ:** [ADR-YYY](./ADR-YYY.md)

---

## السياق والمشكلة

ما هي المشكلة التي نحاول حلها؟

## القرار

ما القرار الذي اتخذناه؟

## البدائل المدروسة

### البديل 1
- المزايا
- العيوب

### البديل 2
- المزايا
- العيوب

## النتائج

### الإيجابيات
- ...

### السلبيات
- ...

## المراجع

- روابط خارجية
```

---

## إرشادات كتابة ADR

### ✅ ما يجب فعله:

1. **اكتب بوضوح**: استخدم لغة بسيطة
2. **اذكر السياق**: لماذا احتجنا هذا القرار؟
3. **قارن البدائل**: ما الخيارات الأخرى؟
4. **كن صريحاً**: اذكر العيوب أيضاً
5. **أضف أمثلة**: كود توضيحي

### ❌ ما يجب تجنبه:

1. لا تكتب ADR للقرارات التافهة
2. لا تعدّل ADRs القديمة (أنشئ واحد جديد)
3. لا تحذف ADRs (mark as superseded)

---

## متى نكتب ADR؟

اكتب ADR عندما:

- ✅ تغيير في المعمارية الأساسية
- ✅ اختيار Framework/Library رئيسي
- ✅ قرار يصعب عكسه لاحقاً
- ✅ قرار يؤثر على الفريق بأكمله
- ✅ قرار مكلف (وقت أو مال)

**أمثلة:**
- ✅ تبني Clean Architecture
- ✅ اختيار CQRS
- ✅ اختيار قاعدة بيانات
- ✅ استراتيجية Testing
- ✅ CI/CD Pipeline

لا تكتب ADR لـ:
- ❌ اختيار CSS Framework
- ❌ تغيير اسم متغير
- ❌ إضافة feature بسيطة

---

## ADRs القادمة (Backlog)

1. **ADR-003**: Event Sourcing Strategy
2. **ADR-004**: Multi-Tenancy Implementation
3. **ADR-005**: Cache Strategy (Redis vs In-Memory)
4. **ADR-006**: Testing Strategy (Unit/Integration/E2E)
5. **ADR-007**: Deployment Strategy (Docker/K8s)

---

## المساهمة

### لإضافة ADR جديد:

1. انسخ Template من الأعلى
2. أنشئ ملف `ADR-XXX-YourTitle.md`
3. املأ جميع الأقسام
4. أضف رابط في هذا الملف
5. أنشئ PR للمراجعة

### للطعن في ADR موجود:

1. افتح Discussion في GitHub
2. إذا تم قبول التغيير، أنشئ ADR جديد يستبدل القديم
3. حدث الـ Status للقديم إلى `🔄 Superseded by ADR-XXX`

---

## الحالة الحالية

**Total ADRs:** 3  
**Accepted:** 3  
**Proposed:** 0  
**Rejected:** 0  
**Superseded:** 0  

**Architecture Compliance:** 95% ✅

---

## 🏭 Manufacturing Services Tests (25 ديسمبر 2025)

تم إضافة **154 اختبار** شامل لخدمات التصنيع:

- ✅ Order Management (23 tests)
- ✅ Helper Functions (43 tests)
- ✅ BOM Alternative Service (22 tests)
- ✅ BOM Costing Service (22 tests)
- ✅ BOM Routing Service (19 tests)
- ✅ BOM Tree Service (25 tests)

**النتائج:**
- جميع الاختبارات تمر بنجاح (100%)
- التغطية المتوقعة: ~50%+ (من 0%)
- متوافق مع معايير SonarQube

للمزيد من التفاصيل، راجع [`docs/testing/MANUFACTURING_TESTS_SUMMARY.md`](../testing/MANUFACTURING_TESTS_SUMMARY.md)

---

## 🎯 Process Costing Implementation (25 ديسمبر 2025)

تم بنجاح تطبيق نظام **Process Costing** متكامل يتبع أفضل الممارسات المحاسبية:

### ✅ المراحل المكتملة:

1. **المرحلة 1: التثبيت والتهيئة** ✅
   - Migration 66: إضافة حقول WIP
   - تهيئة البنية لـ EUP implementation

2. **المرحلة 2: تطبيق EUP (Weighted-Average)** ✅
   - Migration 67: تطبيق EUP calculation
   - 7 اختبارات EUP جديدة (22 إجمالي)

3. **المرحلة 3: Scrap Accounting** ✅
   - Migration 68: تطبيق Normal vs Abnormal scrap
   - 7 اختبارات Scrap Accounting جديدة (29 إجمالي)

4. **المرحلة 4: FIFO Method** ✅
   - Migration 69: تطبيق FIFO costing method
   - 7 اختبارات FIFO جديدة (36 إجمالي)

### 📊 الإحصائيات:
- **Migrations:** 4 (66, 67, 68, 69)
- **الاختبارات:** 36 (جميعها نجحت)
- **الحقول الجديدة:** 18 حقل
- **الميزات:** EUP + Scrap Accounting + FIFO

### 📚 التوثيق:
- [`PROCESS_COSTING_IMPROVEMENT_PLAN.md`](./PROCESS_COSTING_IMPROVEMENT_PLAN.md) - خطة التحسين
- [`PROCESS_COSTING_LIMITATIONS.md`](./PROCESS_COSTING_LIMITATIONS.md) - Known Limitations & Roadmap
- [`EUP_IMPLEMENTATION_SUMMARY.md`](./EUP_IMPLEMENTATION_SUMMARY.md) - ملخص EUP
- [`SCRAP_ACCOUNTING_SUMMARY.md`](./SCRAP_ACCOUNTING_SUMMARY.md) - ملخص Scrap Accounting
- [`FIFO_METHOD_SUMMARY.md`](./FIFO_METHOD_SUMMARY.md) - ملخص FIFO Method
- [`PROCESS_COSTING_COMPLETE_SUMMARY.md`](./PROCESS_COSTING_COMPLETE_SUMMARY.md) - ملخص شامل

---

**آخر تحديث:** 25 ديسمبر 2025
