# Bug Fix: Labor Time Logs Schema Mismatch

## 🐛 المشكلة

**Error:**
```
Error: Missing required parameters: moId, stageId/stageNo, laborHours, hourlyRate
```

**السبب:**
1. `process-costing-service.ts` كان يستخدم أسماء أعمدة خاطئة:
   - `org_id` بدلاً من `tenant_id`
   - `work_center_id` بدلاً من `wc_id`
   - `worker_name` بدلاً من `employee_name`
   - `stage_id` غير موجود في الجدول (فقط `stage_no`)

2. `stage-costing-actions.js` كان يرسل `hours` بدلاً من `laborHours`

3. الجدول `labor_time_logs` يتطلب `wc_id` (مطلوب)

## ✅ الحل

### 1. إصلاح أسماء الأعمدة في `process-costing-service.ts`:

**قبل:**
```typescript
.insert({
  org_id: orgId,
  work_center_id: workCenterId,
  worker_name: employeeName,
  stage_id: stageId
})
```

**بعد:**
```typescript
.insert({
  tenant_id: orgId,  // Fixed
  wc_id: workCenterId,  // Fixed
  employee_name: employeeName,  // Fixed
  stage_no: targetStageNo  // Fixed: get from manufacturing_stages if stageId provided
})
```

### 2. إصلاح معاملات الدالة في `stage-costing-actions.js`:

**قبل:**
```javascript
hours: laborHours
```

**بعد:**
```javascript
laborHours: laborHours
```

### 3. إضافة منطق للحصول على `stage_no` من `stageId`:

```typescript
// Get stage_no from stageId if needed
let targetStageNo = stageNo
if (stageId && !stageNo) {
  const { data: stage } = await supabase
    .from('manufacturing_stages')
    .select('order_sequence')
    .eq('id', stageId)
    .single()
  
  if (stage) {
    targetStageNo = stage.order_sequence
  }
}
```

### 4. إصلاح `moh_applied` أيضاً:

- `org_id` → `tenant_id`
- `work_center_id` → `wc_id`
- `total_cost` → `amount`
- `allocation_base` → `allocation_base` (نص) + `base_qty` (رقم)

## 📝 التغييرات

### `src/services/process-costing-service.ts`:
- ✅ `applyLaborTime()` - إصلاح أسماء الأعمدة
- ✅ `applyOverhead()` - إصلاح أسماء الأعمدة
- ✅ `upsertStageCost()` - إصلاح استعلامات labor و overhead

### `src/features/manufacturing/stage-costing-actions.js`:
- ✅ إصلاح `laborHours` parameter
- ✅ إضافة validation للـ `moId` و `stageId`

## ✅ النتيجة

- ✅ الخطأ تم إصلاحه
- ✅ البيانات تُحفظ بشكل صحيح في قاعدة البيانات
- ✅ `stage_no` يُحصل عليه من `manufacturing_stages` إذا كان `stageId` موجود

---

**Date:** [Date]  
**Status:** ✅ Fixed

