# Phase 1 Testing Checklist - قائمة التحقق من الاختبار

## ✅ First Priority (High) - أولوية عالية

### 1. Stage Costing Panel Testing
**Status:** ⏳ Ready for Testing

**Test Steps:**
1. ✅ Navigate to `/manufacturing/process-costing`
2. ⏳ Select a Manufacturing Order
3. ⏳ Select a Manufacturing Stage from dropdown (should show stages from DB)
4. ⏳ Select Work Center
5. ⏳ Enter quantities (good, scrap, rework)
6. ⏳ Enter direct material cost
7. ⏳ Click "تسجيل وقت العمل" (Apply Labor Time)
   - Enter labor hours and rate
   - Should save to `labor_time_logs` with `stage_id`
8. ⏳ Click "تطبيق التكاليف غير المباشرة" (Apply Overhead)
   - Should save to `moh_applied` with `stage_id`
9. ⏳ Click "احتساب تكلفة المرحلة" (Calculate Stage Cost)
   - Should calculate and save to `stage_costs` with `stage_id`
10. ⏳ Verify stage cost appears in history table below
11. ⏳ Verify stage name shows correctly (from `manufacturing_stages`)

**Expected Results:**
- ✅ Dropdown shows stages from database (not hardcoded)
- ✅ Stage selection works with UUID
- ✅ Labor time saved with `stage_id`
- ✅ Overhead saved with `stage_id`
- ✅ Stage cost calculated and saved
- ✅ Stage name displayed correctly in history

---

### 2. Equivalent Units Dashboard Testing
**Status:** ⏳ Ready for Testing

**Test Steps:**
1. ✅ Navigate to `/manufacturing/process-costing`
2. ⏳ Switch to "Equivalent Units" tab
3. ⏳ Select a Manufacturing Order
4. ⏳ Select a Manufacturing Stage from dropdown (should show stages from DB)
5. ⏳ Enter unit quantities
6. ⏳ Enter completion percentages
7. ⏳ Click "Calculate Equivalent Units"
8. ⏳ Verify calculations are correct
9. ⏳ Verify stage name shows correctly

**Expected Results:**
- ✅ Dropdown shows stages from database (not hardcoded)
- ✅ Stage selection works with UUID
- ✅ Calculations are accurate
- ✅ Stage name displayed correctly

---

### 3. Backend Service Testing
**Status:** ✅ Implementation Complete

**What Was Done:**
- ✅ Created `process-costing-service.ts` with full implementation
- ✅ Supports both `stageId` (new) and `stageNo` (old) for backward compatibility
- ✅ `applyLaborTime()` - saves to `labor_time_logs` with `stage_id`
- ✅ `applyOverhead()` - saves to `moh_applied` with `stage_id`
- ✅ `upsertStageCost()` - saves to `stage_costs` with `stage_id` or `stage_number`
- ✅ `getStageCosts()` - retrieves from `stage_costs`

**Test Steps:**
1. ⏳ Test `applyLaborTime()` with `stageId`
2. ⏳ Test `applyLaborTime()` with `stageNo` (backward compatibility)
3. ⏳ Test `applyOverhead()` with `stageId`
4. ⏳ Test `applyOverhead()` with `stageNo` (backward compatibility)
5. ⏳ Test `upsertStageCost()` with `stageId`
6. ⏳ Test `upsertStageCost()` with `stageNo` (backward compatibility)
7. ⏳ Test `getStageCosts()` returns data with `stage_id` if available

**Expected Results:**
- ✅ All functions work with `stageId`
- ✅ All functions work with `stageNo` (fallback)
- ✅ Data saved correctly to database
- ✅ No errors in console

---

## 📋 Second Priority (Medium) - أولوية متوسطة

### 4. WIP Log UI Component
**Status:** ⏳ TODO

**What Needs to Be Done:**
- ⏳ Create `stage-wip-log-list.tsx` component
- ⏳ Create route `/manufacturing/wip-log`
- ⏳ Add menu item in sidebar
- ⏳ Connect to `stageWipLogService`

---

### 5. Standard Costs UI Component
**Status:** ⏳ TODO

**What Needs to Be Done:**
- ⏳ Create `standard-costs-list.tsx` component
- ⏳ Create route `/manufacturing/standard-costs`
- ⏳ Add menu item in sidebar
- ⏳ Connect to `standardCostsService`

---

## 🎯 Testing Summary

| Component | Implementation | Testing | Status |
|-----------|---------------|---------|--------|
| Process Costing Service | ✅ Complete | ⏳ Pending | 🔄 Ready |
| Stage Costing Panel | ✅ Updated | ⏳ Pending | 🔄 Ready |
| Equivalent Units Dashboard | ✅ Updated | ⏳ Pending | 🔄 Ready |
| WIP Log UI | ❌ Not Created | ❌ N/A | ⏳ TODO |
| Standard Costs UI | ❌ Not Created | ❌ N/A | ⏳ TODO |

---

## 🚀 Next Steps

1. **Test Stage Costing Panel** - Verify everything works with new stages
2. **Test Equivalent Units Dashboard** - Verify dynamic stage loading
3. **Create WIP Log UI** - Build component for `stage_wip_log`
4. **Create Standard Costs UI** - Build component for `standard_costs`

---

**Last Updated:** [Date]  
**Status:** 🔄 Ready for Testing

