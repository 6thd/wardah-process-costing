# Phase 1 Testing Guide - دليل الاختبار النهائي

## 🧪 Testing Checklist - قائمة التحقق من الاختبار

### 1. Stage Costing Panel Testing

#### Test 1.1: Stage Selection Dropdown
**Steps:**
1. Navigate to `/manufacturing/process-costing`
2. Look for "المرحلة" (Stage) field
3. Click on the dropdown

**Expected Results:**
- ✅ Dropdown shows 5 stages from database:
  - MIX - الخلط (الترتيب: 1)
  - MOLD - القولبة (الترتيب: 2)
  - ASSEMBLY - التجميع (الترتيب: 3)
  - QC - مراقبة الجودة (الترتيب: 4)
  - PACK - التعبئة (الترتيب: 5)
- ✅ Stages are sorted by `order_sequence`
- ✅ Only active stages are shown

**If Failed:**
- Check console for errors
- Verify `useManufacturingStages()` hook is working
- Check RLS policies on `manufacturing_stages` table

---

#### Test 1.2: Apply Labor Time with Stage ID
**Steps:**
1. Select a Manufacturing Order
2. Select a Stage from dropdown (e.g., "MIX - الخلط")
3. Select Work Center
4. Enter labor hours (e.g., 8)
5. Enter hourly rate (e.g., 50)
6. Click "تسجيل وقت العمل" (Apply Labor Time)

**Expected Results:**
- ✅ Success toast: "تم تسجيل وقت العمل: 400.00 ريال"
- ✅ Data saved to `labor_time_logs` table
- ✅ `stage_id` field contains UUID of selected stage
- ✅ `stage_no` field may be null or contain fallback value

**Verify in Database:**
```sql
SELECT * FROM labor_time_logs 
WHERE mo_id = '<selected_mo_id>' 
ORDER BY created_at DESC 
LIMIT 1;
```

**Check:**
- `stage_id` should be UUID (not null)
- `hours` = 8
- `hourly_rate` = 50
- `total_cost` = 400

---

#### Test 1.3: Apply Overhead with Stage ID
**Steps:**
1. Select a Manufacturing Order
2. Select a Stage from dropdown
3. Enter labor hours and rate (if not already entered)
4. Click "تطبيق التكاليف غير المباشرة" (Apply Overhead)
5. Overhead should be calculated automatically

**Expected Results:**
- ✅ Success toast: "تم تطبيق التكاليف غير المباشرة: XX.XX ريال"
- ✅ Data saved to `moh_applied` table
- ✅ `stage_id` field contains UUID of selected stage

**Verify in Database:**
```sql
SELECT * FROM moh_applied 
WHERE mo_id = '<selected_mo_id>' 
ORDER BY created_at DESC 
LIMIT 1;
```

---

#### Test 1.4: Calculate Stage Cost with Stage ID
**Steps:**
1. Select a Manufacturing Order
2. Select a Stage from dropdown
3. Enter quantities (good, scrap, rework)
4. Enter direct material cost
5. Click "احتساب تكلفة المرحلة" (Calculate Stage Cost)

**Expected Results:**
- ✅ Success toast: "تم احتساب [Stage Name]: XX.XX ريال"
- ✅ Data saved to `stage_costs` table
- ✅ `stage_id` field contains UUID of selected stage
- ✅ Stage cost appears in history table below
- ✅ Stage name displays correctly (from `manufacturing_stages`)

**Verify in Database:**
```sql
SELECT sc.*, ms.name, ms.name_ar 
FROM stage_costs sc
LEFT JOIN manufacturing_stages ms ON sc.stage_id = ms.id
WHERE sc.manufacturing_order_id = '<selected_mo_id>'
ORDER BY sc.created_at DESC
LIMIT 1;
```

**Check:**
- `stage_id` should be UUID
- `total_cost` should be calculated correctly
- `unit_cost` = `total_cost` / `good_quantity`
- Stage name should display in UI

---

### 2. Equivalent Units Dashboard Testing

#### Test 2.1: Stage Selection Dropdown
**Steps:**
1. Navigate to `/manufacturing/process-costing`
2. Switch to "Equivalent Units" tab
3. Look for "Stage" dropdown

**Expected Results:**
- ✅ Dropdown shows stages from database (not hardcoded)
- ✅ Same 5 stages as in Stage Costing Panel
- ✅ Stages sorted by `order_sequence`

**If Failed:**
- Check console for errors
- Verify `useManufacturingStages()` hook is working

---

#### Test 2.2: Select Stage and Calculate
**Steps:**
1. Select a Manufacturing Order
2. Select a Stage from dropdown
3. Enter unit quantities
4. Enter completion percentages
5. Click "Calculate Equivalent Units"

**Expected Results:**
- ✅ Calculations are performed
- ✅ Results display correctly
- ✅ Stage name shows in results (if applicable)

---

### 3. WIP Log UI Component Testing

#### Test 3.1: Access WIP Log Page
**Steps:**
1. Navigate to `/manufacturing/wip-log`
2. Or click "سجلات WIP" in sidebar menu

**Expected Results:**
- ✅ Page loads without errors
- ✅ Title: "سجلات العمل قيد التنفيذ (WIP Log)"
- ✅ Filters section visible
- ✅ Table visible (may be empty)

---

#### Test 3.2: Filter by Manufacturing Order
**Steps:**
1. In "أمر التصنيع" dropdown, select an order
2. Wait for data to load

**Expected Results:**
- ✅ Table shows only WIP logs for selected order
- ✅ No errors in console

---

#### Test 3.3: Filter by Stage
**Steps:**
1. In "المرحلة" dropdown, select a stage
2. Wait for data to load

**Expected Results:**
- ✅ Table shows only WIP logs for selected stage
- ✅ Stage name displays correctly in table

---

#### Test 3.4: Filter by Date Range
**Steps:**
1. Select "من تاريخ" (From Date)
2. Select "إلى تاريخ" (To Date)
3. Wait for data to load

**Expected Results:**
- ✅ Table shows only WIP logs within date range
- ✅ No errors

---

## 🔍 Debugging Tips

### Console Errors
If you see errors in console:
1. Check browser console (F12)
2. Look for:
   - RLS policy errors
   - Missing table errors
   - Network errors

### Common Issues

#### Issue: Stages not showing in dropdown
**Solution:**
- Check RLS policies: Run `sql/migrations/30_fix_rls_allow_default_org.sql`
- Verify stages exist: `SELECT * FROM manufacturing_stages WHERE org_id = '00000000-0000-0000-0000-000000000001'`

#### Issue: `stage_id` is null in database
**Solution:**
- Verify dropdown is using `stageId` (not `stageNumber`)
- Check `process-costing-service.ts` implementation
- Verify form data is being passed correctly

#### Issue: WIP Log page shows no data
**Solution:**
- Check if `stage_wip_log` table has data
- Verify RLS policies allow access
- Check filters are not too restrictive

---

## ✅ Success Criteria

### Stage Costing Panel:
- ✅ Dropdown shows stages from database
- ✅ Labor time saves with `stage_id`
- ✅ Overhead saves with `stage_id`
- ✅ Stage cost calculates and saves with `stage_id`
- ✅ Stage name displays correctly in history

### Equivalent Units Dashboard:
- ✅ Dropdown shows stages from database
- ✅ Calculations work correctly
- ✅ Stage selection works

### WIP Log UI:
- ✅ Page loads without errors
- ✅ Filters work correctly
- ✅ Data displays correctly
- ✅ Stage names show correctly

---

## 📝 Test Results Template

```
Date: [Date]
Tester: [Name]

Stage Costing Panel:
- [ ] Test 1.1: Stage Selection Dropdown - PASS/FAIL
- [ ] Test 1.2: Apply Labor Time - PASS/FAIL
- [ ] Test 1.3: Apply Overhead - PASS/FAIL
- [ ] Test 1.4: Calculate Stage Cost - PASS/FAIL

Equivalent Units Dashboard:
- [ ] Test 2.1: Stage Selection Dropdown - PASS/FAIL
- [ ] Test 2.2: Calculate - PASS/FAIL

WIP Log UI:
- [ ] Test 3.1: Access Page - PASS/FAIL
- [ ] Test 3.2: Filter by MO - PASS/FAIL
- [ ] Test 3.3: Filter by Stage - PASS/FAIL
- [ ] Test 3.4: Filter by Date - PASS/FAIL

Notes:
[Any issues or observations]
```

---

**Last Updated:** [Date]  
**Status:** Ready for Testing

