# Phase 1 Testing Results - نتائج اختبار المرحلة الأولى

**Date:** 2025-01-20  
**Tester:** [Your Name]  
**Start Time:** [Time]  
**Status:** ⏳ In Progress

## 🐛 Bugs Fixed During Testing

### Bug 1: work_centers query uses tenant_id instead of org_id
**Error:** `GET .../work_centers?select=id&tenant_id=eq.00000000-0000-0000-0000-000000000001&limit=1 400 (Bad Request)`

**Fix:** Changed `.eq('tenant_id', orgId)` to `.eq('org_id', orgId)` in `process-costing-service.ts` (lines 100, 192)

**Files Modified:**
- `src/services/process-costing-service.ts`

### Bug 2: stage_costs query fails with 400 error
**Error:** `Failed to load resource: the server responded with a status of 400`

**Fix:** Removed `.order()` with `nullsFirst` parameter and implemented in-memory sorting instead

**Files Modified:**
- `src/hooks/useStageCosts.ts`

---

## 📋 Pre-Testing Checklist

- [ ] Dev server running (`npm run dev`)
- [ ] Logged in to system
- [ ] DevTools open (F12)
- [ ] Supabase SQL Editor ready
- [ ] Test data script executed: `sql/migrations/31_test_data_setup.sql`
- [ ] Testing guide open: `docs/features/manufacturing/PHASE1_TESTING_STEPS.md`

---

## 🧪 Test Results

### 1️⃣ Manufacturing Stages List

**Test:** Verify 5 stages exist and display correctly

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Navigate to `/manufacturing/stages`
2. Verify 5 stages appear:
   - MIX - الخلط
   - MOLD - القولبة
   - ASSEMBLY - التجميع
   - QC - مراقبة الجودة
   - PACK - التعبئة

**Expected:**
- ✅ Stages appear in table
- ✅ Order is correct (1, 2, 3, 4, 5)
- ✅ No console errors

**SQL Verification:**
```sql
SELECT code, name_ar, order_sequence, is_active 
FROM manufacturing_stages 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY order_sequence;
```
**Result:** ___ rows (Expected: 5)

**Notes:**
_________________________________________________

---

### 2️⃣ Stage Costing Panel

#### Test 2.1: Stage Selection Dropdown

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Navigate to `/manufacturing/process-costing`
2. Find "المرحلة" field
3. Click dropdown

**Expected:**
- ✅ Dropdown shows 5 stages from database
- ✅ Stages ordered by `order_sequence`
- ✅ Displays: Code - Name (Arabic) - Order

**Notes:**
_________________________________________________

---

#### Test 2.2: Apply Labor Time

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Select Manufacturing Order
2. Select Stage (e.g., "MIX - الخلط")
3. Select Work Center
4. Enter:
   - Labor Hours: `8`
   - Hourly Rate: `50`
5. Click "تسجيل وقت العمل"

**Expected:**
- ✅ Success message: "تم تسجيل وقت العمل: 400.00 ريال"
- ✅ No console errors

**SQL Verification:**
```sql
SELECT 
  mo_id,
  stage_id,
  stage_no,
  hours,
  hourly_rate,
  total_cost,
  created_at
FROM labor_time_logs
WHERE mo_id = '<selected_mo_id>'
ORDER BY created_at DESC
LIMIT 1;
```
**Result:** 
- stage_id: _______
- hours: _______
- hourly_rate: _______
- total_cost: _______

**Notes:**
_________________________________________________

---

#### Test 2.3: Apply Overhead

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Select Manufacturing Order
2. Select Stage
3. Select Work Center
4. Enter:
   - Overhead Rate: `25`
5. Click "تطبيق التكاليف غير المباشرة"

**Expected:**
- ✅ Success message appears
- ✅ No console errors

**Notes:**
_________________________________________________

---

#### Test 2.4: Calculate Stage Cost

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Select Manufacturing Order
2. Select Stage
3. Select Work Center
4. Enter:
   - Good Quantity: `100`
   - Direct Material Cost: `500`
   - Direct Labor Cost: `400`
   - Overhead Cost: `100`
5. Click "احتساب تكلفة المرحلة"

**Expected:**
- ✅ Success message with total cost
- ✅ Stage cost calculated correctly
- ✅ No console errors

**Notes:**
_________________________________________________

---

### 3️⃣ Equivalent Units Dashboard

#### Test 3.1: Stage Selection

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Navigate to `/manufacturing/equivalent-units`
2. Find stage dropdown
3. Click dropdown

**Expected:**
- ✅ Shows stages from database (not hardcoded)
- ✅ Stages ordered correctly

**Notes:**
_________________________________________________

---

#### Test 3.2: Calculate Equivalent Units

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Select Manufacturing Order
2. Select Stage
3. Enter values:
   - Beginning WIP: `10`
   - Units Started: `100`
   - Units Completed: `90`
4. Click "Calculate"

**Expected:**
- ✅ Calculation works correctly
- ✅ Results displayed

**Notes:**
_________________________________________________

---

### 4️⃣ WIP Log UI

#### Test 4.1: Access Page

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Navigate to `/manufacturing/wip-log`

**Expected:**
- ✅ Page loads without errors
- ✅ UI displays correctly

**Notes:**
_________________________________________________

---

#### Test 4.2: Filter by Manufacturing Order

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Select MO from filter dropdown
2. Verify results filtered

**Expected:**
- ✅ Only selected MO's WIP logs shown
- ✅ Filter works correctly

**Notes:**
_________________________________________________

---

#### Test 4.3: Filter by Stage

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Select Stage from filter dropdown
2. Verify results filtered

**Expected:**
- ✅ Only selected stage's WIP logs shown
- ✅ Filter works correctly

**Notes:**
_________________________________________________

---

#### Test 4.4: Filter by Date Range

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Select date range
2. Verify results filtered

**Expected:**
- ✅ Only logs within date range shown
- ✅ Date filter works correctly

**Notes:**
_________________________________________________

---

### 5️⃣ Standard Costs UI

#### Test 5.1: Access Page

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Navigate to `/manufacturing/standard-costs`

**Expected:**
- ✅ Page loads without errors
- ✅ UI displays correctly

**Notes:**
_________________________________________________

---

#### Test 5.2: Create Standard Cost

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Click "Create" button
2. Fill form:
   - Product: Select product
   - Stage: Select stage
   - Standard Material Cost: `100`
   - Standard Labor Cost: `50`
   - Standard Overhead Cost: `25`
3. Click "Save"

**Expected:**
- ✅ Success message
- ✅ New standard cost appears in list
- ✅ No console errors

**Notes:**
_________________________________________________

---

#### Test 5.3: Filter Standard Costs

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Test Product filter
2. Test Stage filter
3. Test Active Status filter

**Expected:**
- ✅ All filters work correctly
- ✅ Results update properly

**Notes:**
_________________________________________________

---

#### Test 5.4: Edit Standard Cost

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Click "Edit" on existing standard cost
2. Modify values
3. Click "Save"

**Expected:**
- ✅ Success message
- ✅ Changes reflected in list
- ✅ No console errors

**Notes:**
_________________________________________________

---

#### Test 5.5: Delete Standard Cost

- [ ] **PASS** [ ] **FAIL**

**Steps:**
1. Click "Delete" on existing standard cost
2. Confirm deletion

**Expected:**
- ✅ Success message
- ✅ Item removed from list
- ✅ No console errors

**Notes:**
_________________________________________________

---

## 📊 Summary

**Total Tests:** 16  
**Passed:** ___ / 16  
**Failed:** ___ / 16  
**Pass Rate:** ___ %

**Critical Issues:** ___  
**Minor Issues:** ___

**Status:**
- [ ] ✅ **READY** - All tests passed, ready for migration
- [ ] ⚠️ **NEEDS WORK** - Some issues found, needs fixes
- [ ] ❌ **BLOCKED** - Critical issues prevent progress

---

## 🐛 Issues Found

### Critical Issues:
1. _________________________________________________
2. _________________________________________________
3. _________________________________________________

### Minor Issues:
1. _________________________________________________
2. _________________________________________________
3. _________________________________________________

---

## ✅ Next Steps

- [ ] Fix critical issues
- [ ] Re-test failed tests
- [ ] Document fixes
- [ ] Proceed to Phase 1 Migration

---

**End Time:** [Time]  
**Duration:** ___ minutes  
**Tester Signature:** _________________

