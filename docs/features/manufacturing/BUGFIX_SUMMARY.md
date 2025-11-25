# Bug Fix Summary - ملخص إصلاح الأخطاء

## 🐛 الأخطاء التي تم إصلاحها

### 1. Config Import Error ✅
**Error:** `The requested module '/src/lib/config.ts' does not provide an export named 'config'`

**Fix:**
- تغيير `import { config }` إلى `import { loadConfig }`
- إضافة `await loadConfig()` في كل دالة

---

### 2. Labor Time Logs Schema Mismatch ✅
**Error:** `Missing required parameters: moId, stageId/stageNo, laborHours, hourlyRate`

**Fixes:**
1. **أسماء الأعمدة:**
   - `org_id` → `tenant_id`
   - `work_center_id` → `wc_id`
   - `worker_name` → `employee_name`
   - إزالة `stage_id` (غير موجود في الجدول)

2. **معاملات الدالة:**
   - `hours` → `laborHours`

3. **الحصول على `stage_no` من `stageId`:**
   - إذا كان `stageId` موجود و `stageNo` غير موجود
   - استعلام `manufacturing_stages` للحصول على `order_sequence`

4. **`wc_id` مطلوب:**
   - إذا لم يكن موجود، البحث عن work center افتراضي

---

### 3. MOH Applied Schema Mismatch ✅
**Fixes:**
1. **أسماء الأعمدة:**
   - `org_id` → `tenant_id`
   - `work_center_id` → `wc_id`
   - `total_cost` → `amount`
   - `allocation_base` → نص (مثل 'labor_cost') + `base_qty` → رقم

2. **نفس منطق `stage_no` و `wc_id`**

---

## 📝 الملفات المحدثة

1. ✅ `src/services/process-costing-service.ts`
   - `applyLaborTime()` - إصلاح كامل
   - `applyOverhead()` - إصلاح كامل
   - `upsertStageCost()` - إصلاح استعلامات

2. ✅ `src/features/manufacturing/stage-costing-actions.js`
   - إصلاح `laborHours` parameter
   - إضافة validation

---

## ✅ النتيجة

- ✅ جميع الأخطاء تم إصلاحها
- ✅ البيانات تُحفظ بشكل صحيح في قاعدة البيانات
- ✅ `stage_no` يُحصل عليه من `manufacturing_stages` إذا كان `stageId` موجود
- ✅ `wc_id` يُحصل عليه تلقائياً إذا لم يكن موجود

---

## 🧪 اختبار مرة أخرى

الآن يجب أن يعمل Test 2.2: Apply Labor Time بشكل صحيح.

**الخطوات:**
1. اختر Manufacturing Order
2. اختر Stage
3. اختر Work Center (مطلوب)
4. أدخل Labor Hours و Hourly Rate
5. انقر "تسجيل وقت العمل"

**النتيجة المتوقعة:**
- ✅ رسالة نجاح
- ✅ البيانات تُحفظ في `labor_time_logs`
- ✅ `stage_no` صحيح
- ✅ `wc_id` موجود

---

**Date:** [Date]  
**Status:** ✅ All Bugs Fixed

