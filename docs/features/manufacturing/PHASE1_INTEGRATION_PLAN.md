# Phase 1 Integration Plan - خطة الربط والتكامل

## 📋 Overview - نظرة عامة

This document outlines what needs to be connected and what's implemented in the backend but not yet used in the UI.

---

## ✅ What's Implemented (Backend)

### 1. Database Tables
- ✅ `manufacturing_stages` - Created and has data
- ✅ `stage_wip_log` - Created (empty, ready to use)
- ✅ `standard_costs` - Created (empty, ready to use)

### 2. Services (Backend)
- ✅ `manufacturingStagesService` - ✅ Used in UI
- ✅ `stageWipLogService` - ❌ NOT used in UI
- ✅ `standardCostsService` - ❌ NOT used in UI

### 3. UI Components
- ✅ `ManufacturingStagesList` - Created and working
- ❌ WIP Log UI - NOT created
- ❌ Standard Costs UI - NOT created

---

## ❌ What Needs to be Updated

### 1. **Stage Costing Panel** (`stage-costing-panel.tsx`)
**Current Issue:**
- Uses `stageNumber` (number: 1, 2, 3...)
- Should use `stage_id` (UUID from `manufacturing_stages`)

**Files to Update:**
- `src/features/manufacturing/stage-costing-panel.tsx`
- `src/features/manufacturing/stage-costing-actions.js`

**Changes Needed:**
1. Replace `stageNumber: number` with `stageId: string`
2. Load stages from `useManufacturingStages()` hook
3. Show stage dropdown instead of number input
4. Update backend calls to use `stage_id`

---

### 2. **Equivalent Units Dashboard** (`equivalent-units-dashboard.tsx`)
**Current Issue:**
- Hardcoded stages in Select dropdown:
  ```tsx
  <SelectItem value="10">Stage 10 - Rolling</SelectItem>
  <SelectItem value="20">Stage 20 - Transparency Processing</SelectItem>
  ```
- Should load from `manufacturing_stages` table

**Changes Needed:**
1. Use `useManufacturingStages()` hook
2. Populate dropdown from database
3. Use `stage_id` instead of hardcoded numbers

---

### 3. **Stage WIP Log Service** - Not Used in UI
**Current Status:**
- ✅ Service exists: `stageWipLogService`
- ❌ No UI component to use it

**Needed:**
- Create WIP Log UI component
- Add route: `/manufacturing/wip-log`
- Connect to `stageWipLogService`

---

### 4. **Standard Costs Service** - Not Used in UI
**Current Status:**
- ✅ Service exists: `standardCostsService`
- ❌ No UI component to use it

**Needed:**
- Create Standard Costs UI component
- Add route: `/manufacturing/standard-costs`
- Connect to `standardCostsService`

---

## 🔗 Integration Points

### 1. Manufacturing Orders → Stages
**Connection:**
- When creating/editing MO, allow selecting stages
- Track which stages the MO will go through

### 2. Stage Costing → Stages
**Connection:**
- Replace `stageNumber` with `stage_id`
- Load stages dynamically from database
- Show stage name instead of number

### 3. Work Centers → Stages
**Connection:**
- Link work centers to stages (already supported in schema)
- Show which work center is used for which stage

### 4. BOM → Stages
**Connection:**
- Associate materials/components with specific stages
- Track material usage per stage

---

## 📝 Implementation Priority

### Priority 1 (Critical):
1. ✅ Create Manufacturing Stages List UI - **DONE**
2. ⏳ Update Stage Costing Panel to use `stage_id` - **TODO**
3. ⏳ Update Equivalent Units Dashboard to use stages from DB - **TODO**

### Priority 2 (Important):
4. ⏳ Create WIP Log UI component
5. ⏳ Create Standard Costs UI component

### Priority 3 (Nice to Have):
6. ⏳ Add stage selection to Manufacturing Orders
7. ⏳ Link Work Centers to Stages in UI
8. ⏳ Add GL Account linking to Stages in UI

---

**Last Updated:** [Date]  
**Status:** ⏳ Integration In Progress

