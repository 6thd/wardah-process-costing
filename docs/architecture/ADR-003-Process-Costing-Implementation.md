# ADR-003: Process Costing Implementation (EUP, Scrap Accounting, FIFO)

**التاريخ:** 25 ديسمبر 2025  
**الحالة:** ✅ مقبول  
**صاحب القرار:** Development Team  
**مرتبط بـ:** [ADR-001](./ADR-001-Clean-Architecture.md)

---

## السياق والمشكلة

نظام Process Costing الحالي كان مبسطاً ولا يتبع أفضل الممارسات المحاسبية:

### المشاكل الرئيسية:
1. **لا يدعم EUP (Equivalent Units of Production)**
   - حساب تكلفة الوحدة: `unit_cost = total_cost / good_qty`
   - لا يأخذ في الاعتبار WIP inventory
   - غير دقيق في بيئات التصنيع المستمرة

2. **لا يدعم Scrap Accounting**
   - `scrap_qty` موجود لكن غير مستخدم في الحساب
   - لا يوجد تمييز بين Normal و Abnormal scrap
   - تكاليف الهالك غير مخصصة بشكل صحيح

3. **لا يدعم FIFO Method**
   - فقط Weighted-Average method
   - لا يوجد فصل بين Beginning WIP costs و Current period costs
   - محدودية في المرونة المحاسبية

### التأثير:
- ⚠️ قد لا يلتزم مع IFRS/GAAP في بيئات التصنيع المستمرة
- ⚠️ تقييم WIP غير دقيق
- ⚠️ تكاليف الهالك غير محسوبة بشكل صحيح

---

## القرار

تطبيق نظام Process Costing متكامل يتبع أفضل الممارسات المحاسبية والصناعية:

### المراحل:
1. **المرحلة 1:** إضافة حقول WIP (تهيئة البنية)
2. **المرحلة 2:** تطبيق EUP (Weighted-Average method)
3. **المرحلة 3:** تطبيق Scrap Accounting (Normal vs Abnormal)
4. **المرحلة 4:** تطبيق FIFO Method (Beginning WIP separation)

### التقنيات المستخدمة:
- **PostgreSQL Functions**: منطق التكلفة على مستوى قاعدة البيانات
- **Dynamic Column Detection**: دعم `tenant_id`/`org_id` و `mo_id`/`manufacturing_order_id`
- **Backward Compatibility**: جميع المعاملات الجديدة اختيارية

---

## البدائل المدروسة

### البديل 1: تطبيق كل شيء دفعة واحدة
**المزايا:**
- تنفيذ سريع

**العيوب:**
- مخاطر عالية (breaking changes)
- صعوبة في الاختبار
- صعوبة في التتبع

**القرار:** ❌ رفض - مخاطر عالية جداً

---

### البديل 2: تطبيق متدرج (المختار) ✅
**المزايا:**
- مخاطر منخفضة
- اختبار شامل لكل مرحلة
- Backward compatibility محفوظة
- سهولة التتبع والتصحيح

**العيوب:**
- يستغرق وقتاً أطول
- يحتاج تخطيط دقيق

**القرار:** ✅ قبول - الأفضل للمشروع

---

### البديل 3: استخدام Library خارجي
**المزايا:**
- تطبيق سريع
- ميزات جاهزة

**العيوب:**
- عدم المرونة
- تكاليف إضافية
- صعوبة التخصيص
- اعتماد على طرف ثالث

**القرار:** ❌ رفض - نحتاج تحكم كامل

---

## النتائج

### الإيجابيات ✅

1. **دقة محاسبية عالية**
   - متوافق مع IFRS/GAAP
   - دعم كامل لـ WIP valuation
   - حساب دقيق لتكاليف الهالك

2. **مرونة في الطرق**
   - دعم Weighted-Average و FIFO
   - اختيار الطريقة لكل أمر تصنيع
   - قابل للتوسع لطرق أخرى لاحقاً

3. **استقرار عالي**
   - 36 اختبار (جميعها نجحت)
   - Backward compatible 100%
   - لا breaking changes

4. **أداء جيد**
   - منطق التكلفة على مستوى قاعدة البيانات
   - استعلامات محسّنة
   - Indexes مناسبة

### السلبيات ⚠️

1. **تعقيد إضافي**
   - دالة `upsert_stage_cost` أصبحت معقدة
   - معاملات كثيرة (19 معامل)
   - يحتاج فهم عميق للمفاهيم المحاسبية

2. **وقت التنفيذ**
   - ~13 ساعة إجمالي
   - 4 migrations
   - توثيق شامل

3. **صيانة**
   - يحتاج فريق فاهم للمفاهيم المحاسبية
   - تحديثات قد تحتاج خبرة محاسبية

---

## التنفيذ

### Migrations:
- ✅ Migration 66: WIP Fields
- ✅ Migration 67: EUP Implementation
- ✅ Migration 68: Scrap Accounting
- ✅ Migration 69: FIFO Method

### الاختبارات:
- ✅ 36 اختبار (جميعها نجحت)
- ✅ Coverage شامل
- ✅ Edge cases covered

### التوثيق:
- ✅ خطة التحسين
- ✅ Known Limitations
- ✅ Implementation Summaries
- ✅ Complete Summary

---

## المراجع

- [IFRS Standards - IAS 2](https://www.ifrs.org/)
- [GAAP - Process Costing](https://www.accountingcoach.com/)
- [Cost Accounting Standards](https://www.casb.gov/)
- [`PROCESS_COSTING_COMPLETE_SUMMARY.md`](./PROCESS_COSTING_COMPLETE_SUMMARY.md)

---

**Status:** ✅ **Accepted**  
**Implementation Date:** 25 ديسمبر 2025  
**Version:** v4.0

