# Process Costing - Known Limitations & Roadmap

**التاريخ:** 25 ديسمبر 2025  
**الإصدار:** v1.0  
**الحالة:** ⚠️ Known Limitations (Documented)

> **خطة التنفيذ المتقدمة (2026-08):** المسار الحي للواجهة ما زال يتجاوز محرك EUP/FIFO في مواضع؛ انظر الخطة المرحلية المحكمة في\
> [`docs/features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md`](../features/manufacturing/ADVANCED_MANUFACTURING_ROADMAP.md).

---

## 📋 Current Implementation (v1.0)

### ✅ What Works Well:

- ✅ **Transferred-In Cost Calculation**: صحيح ومحمي بـ `FOR UPDATE`
- ✅ **Direct Materials Tracking**: دقيق في المرحلة الأولى
- ✅ **Direct Labor Tracking**: من `labor_time_logs` مع hourly rates
- ✅ **Manufacturing Overhead**: مرن ومتعدد الأساسات (labor_hours, machine_hours, etc.)
- ✅ **Multi-Stage Cost Accumulation**: ترحيل التكاليف بين المراحل صحيح
- ✅ **AVCO Integration**: تكامل جيد مع نظام تقييم المخزون
- ✅ **Security & Multi-Tenant**: محكم ومحمي

---

## ⚠️ Known Limitations

### 1. ~~Simplified Unit Cost Calculation~~ ✅ **FIXED**

**Previous Formula (v1.0):**
```sql
unit_cost = total_cost / good_qty  -- ❌ Old method
```

**Current Formula (v2.0 - EUP Enabled):**
```sql
eup_cc = good_qty + (wip_end_qty * wip_end_cc_completion_pct / 100)
unit_cost = total_cost / eup_cc  -- ✅ New method with EUP
-- Fallback: unit_cost = total_cost / good_qty if EUP = 0 (backward compatibility)
```

**Status:** ✅ **RESOLVED** - EUP implementation completed (Migration 67)

**Implementation:**
- ✅ Accounts for **Work-In-Process (WIP)** inventory
- ✅ Uses **Equivalent Units of Production (EUP)** - Weighted-Average method
- ✅ Complies with **IFRS/GAAP** standards for continuous manufacturing

**Example:**
```
Scenario:
- Total Cost: 10,000 SAR
- Good Units Completed: 800 units
- WIP Ending: 200 units (50% complete)

Old Calculation (v1.0):
  unit_cost = 10,000 / 800 = 12.50 SAR/unit ❌

New Calculation (v2.0 with EUP):
  EUP = 800 + (200 × 0.50) = 900 units
  unit_cost = 10,000 / 900 = 11.11 SAR/unit ✅
  
Cost Allocation:
  Completed Units: 800 × 11.11 = 8,888 SAR
  WIP Ending: 200 × 0.50 × 11.11 = 1,111 SAR
```

**Usage:**
- ✅ System now works correctly for **continuous manufacturing** with WIP
- ✅ Backward compatible: If WIP = 0, falls back to old method
- ✅ No code changes required for existing implementations (WIP params are optional)

---

### 2. ~~Scrap Accounting Not Implemented~~ ✅ **FIXED**

**Previous State:**
- ✅ `scrap_qty` field exists in `stage_costs` table
- ✅ `rework_qty` field exists
- ❌ `v_rg` (regrind cost) was hardcoded to **0**
- ❌ `v_wc` (waste credit) was hardcoded to **0**
- ❌ Scrap costs were **not allocated** to production

**Current State (v3.0):**
- ✅ **Scrap accounting fully implemented** (Migration 68)
- ✅ **Normal vs Abnormal scrap distinction** implemented
- ✅ **Normal scrap cost allocated** to good units (increases unit cost)
- ✅ **Abnormal scrap cost charged** to expense account (period cost)
- ✅ **Regrind cost** parameter added and used
- ✅ **Waste credit** parameter added and used

**Implementation:**
- ✅ Normal scrap rate stored in `work_centers.normal_scrap_rate`
- ✅ Normal scrap cost calculated and allocated to good units
- ✅ Abnormal scrap cost calculated and charged separately
- ✅ Regrind cost included in total cost calculation
- ✅ Waste credit subtracted from total cost

**Accounting Standards Compliance:**
- ✅ **Normal Scrap**: Allocated to good units (increases unit cost) ✅
- ✅ **Abnormal Scrap**: Charged to expense account (period cost) ✅

---

### 3. ~~No FIFO Support for WIP~~ ✅ **FIXED**

**Previous State:**
- ✅ Only **Weighted-Average** method (simplified)
- ❌ No **FIFO** method for WIP valuation
- ❌ No separation between beginning WIP costs and current period costs

**Current State (v4.0):**
- ✅ **FIFO method implemented** (Migration 69)
- ✅ **Beginning WIP cost separation** implemented
- ✅ **Both methods supported**: Weighted-Average and FIFO
- ✅ **Method selection** per manufacturing order

**Implementation:**
- ✅ `costing_method` field added to `manufacturing_orders` table
- ✅ FIFO EUP calculation: `eup = good_qty + ending_wip - beginning_wip`
- ✅ Beginning WIP cost tracked separately from current period cost
- ✅ Unit cost calculation differs by method:
  - **Weighted-Average**: `unit_cost = total_cost / eup` (includes beginning WIP)
  - **FIFO**: `unit_cost = current_period_cost / eup` (excludes beginning WIP)

**Accounting Standards Compliance:**
- ✅ **Weighted-Average**: Combines beginning WIP + current costs ✅
- ✅ **FIFO**: Separates beginning WIP from current period costs ✅

---

### 4. ~~No Equivalent Units Calculation~~ ✅ **FIXED**

**Previous State:**
- ❌ No EUP calculation
- ❌ No tracking of WIP completion percentages
- ❌ No distinction between materials completion % and conversion costs completion %

**Current State (v2.0):**
- ✅ **EUP calculation implemented** (Migration 67)
- ✅ **WIP completion percentages tracked** and used in calculation
- ✅ **Distinction between DM and CC completion** percentages

**Implementation:**
- ✅ EUP for Direct Materials (Stage 1 only): `eup_dm = good_qty + (wip_end_qty × wip_end_dm_completion_pct / 100)`
- ✅ EUP for Conversion Costs (Primary): `eup_cc = good_qty + (wip_end_qty × wip_end_cc_completion_pct / 100)`
- ✅ Unit cost uses `eup_cc` for calculation

**Fields (Added in Migration 66, Used in Migration 67):**
- ✅ `wip_end_qty` - Added and used
- ✅ `wip_end_dm_completion_pct` - Added and used (Stage 1 DM EUP)
- ✅ `wip_end_cc_completion_pct` - Added and used (Primary EUP for unit cost)

---

## 🗺️ Roadmap (v2.0)

### Phase 1: EUP Implementation (Q1 2026) ✅ **COMPLETED**

**Status:** ✅ Fully implemented (Migration 67)

**Tasks:**
- [x] Add WIP fields to `stage_costs` table (Migration 66)
- [x] Implement EUP calculation in `upsert_stage_cost` (Migration 67)
- [x] Update unit cost formula to use EUP
- [x] Add tests for EUP scenarios (22 tests total)
- [x] Update documentation

**Implemented Formula:**
```sql
-- Weighted-Average EUP
eup_dm = good_qty + (wip_end_qty * wip_end_dm_completion_pct / 100)  -- Stage 1 only
eup_cc = good_qty + (wip_end_qty * wip_end_cc_completion_pct / 100)  -- Primary EUP

-- Unit Cost
unit_cost = total_cost / eup_cc  -- Using conversion costs EUP
-- Fallback: unit_cost = total_cost / good_qty if EUP = 0 (backward compatibility)
```

**New Function Parameters:**
- `p_wip_end_qty` (default: 0) - Ending WIP quantity
- `p_wip_end_dm_completion_pct` (default: 0) - DM completion % (0-100)
- `p_wip_end_cc_completion_pct` (default: 0) - CC completion % (0-100)

**Return Value:**
- Added `eup` field to return set

**Timeline:** ✅ Completed 25 ديسمبر 2025

---

### Phase 2: Scrap Accounting (Q2 2026) ✅ **COMPLETED**

**Status:** ✅ Fully implemented (Migration 68)

**Tasks:**
- [x] Add `normal_scrap_rate` to `work_centers` (Migration 68)
- [x] Implement normal vs abnormal scrap logic
- [x] Allocate normal scrap cost to good units
- [x] Charge abnormal scrap to expense account
- [x] Implement regrind/reprocessing cost calculation
- [x] Implement waste credit calculation
- [x] Add scrap accounting fields to `stage_costs` table
- [x] Add tests for scrap accounting (7 new tests)

**Implemented Logic:**
```sql
-- Calculate normal vs abnormal scrap
normal_scrap_qty = MIN(good_qty * normal_scrap_rate / 100, scrap_qty)
abnormal_scrap_qty = scrap_qty - normal_scrap_qty

-- Calculate unit cost before scrap allocation
unit_cost_before_scrap = total_cost / eup

-- Normal scrap cost allocated to good units (increases unit cost)
normal_scrap_cost = normal_scrap_qty * unit_cost_before_scrap
total_cost = total_cost + normal_scrap_cost

-- Abnormal scrap cost charged to expense (period cost, excluded from unit cost)
abnormal_scrap_cost = abnormal_scrap_qty * unit_cost_before_scrap
-- NOT added to total_cost (charged separately)

-- Final unit cost (includes normal scrap)
unit_cost = total_cost / eup
```

**New Fields Added:**
- `work_centers.normal_scrap_rate` - Normal scrap rate percentage (0-100)
- `stage_costs.normal_scrap_qty` - Normal scrap quantity
- `stage_costs.abnormal_scrap_qty` - Abnormal scrap quantity
- `stage_costs.normal_scrap_cost` - Normal scrap cost (allocated to good units)
- `stage_costs.abnormal_scrap_cost` - Abnormal scrap cost (charged to expense)
- `stage_costs.regrind_cost` - Regrind/reprocessing cost
- `stage_costs.waste_credit_amount` - Waste credit amount

**New Function Parameters:**
- `p_regrind_cost` (default: 0) - Regrind/reprocessing cost
- `p_waste_credit` (default: 0) - Waste credit amount

**Return Value:**
- Added `normal_scrap_cost` and `abnormal_scrap_cost` to return set

**Timeline:** ✅ Completed 25 ديسمبر 2025

---

### Phase 3: FIFO Method (Q3 2026) ✅ **COMPLETED**

**Status:** ✅ Fully implemented (Migration 69)

**Tasks:**
- [x] Add `costing_method` field to `manufacturing_orders` (Migration 69)
- [x] Implement FIFO EUP calculation
- [x] Separate beginning WIP costs from current period costs
- [x] Update `upsert_stage_cost` to support both methods
- [x] Add beginning WIP cost fields to `stage_costs` table
- [x] Add tests for FIFO method (7 new tests)

**Implemented Formula:**
```sql
-- FIFO EUP
eup_dm = good_qty + (wip_end_qty * wip_end_dm_completion_pct / 100) 
         - (wip_beginning_qty * wip_beginning_dm_completion_pct / 100)  -- Stage 1 only
eup_cc = good_qty + (wip_end_qty * wip_end_cc_completion_pct / 100) 
         - (wip_beginning_qty * wip_beginning_cc_completion_pct / 100)

-- Unit Cost (FIFO)
unit_cost = current_period_cost / eup_cc  -- Excludes beginning WIP cost

-- Weighted-Average EUP (unchanged)
eup_cc = good_qty + (wip_end_qty * wip_end_cc_completion_pct / 100)

-- Unit Cost (Weighted-Average)
unit_cost = total_cost / eup_cc  -- Includes beginning WIP cost
```

**New Fields Added:**
- `manufacturing_orders.costing_method` - 'weighted_average' or 'fifo'
- `stage_costs.wip_beginning_cost` - Beginning WIP cost (separated in FIFO)
- `stage_costs.current_period_cost` - Current period cost (excludes beginning WIP in FIFO)

**New Function Parameters:**
- `p_wip_beginning_qty` (default: 0) - Beginning WIP quantity
- `p_wip_beginning_dm_completion_pct` (default: 0) - Beginning WIP DM completion %
- `p_wip_beginning_cc_completion_pct` (default: 0) - Beginning WIP CC completion %
- `p_wip_beginning_cost` (default: 0) - Beginning WIP cost

**Return Value:**
- Added `costing_method`, `wip_beginning_cost`, and `current_period_cost` to return set

**Timeline:** ✅ Completed 25 ديسمبر 2025

---

### Phase 4: Process Costing Dashboard (Q4 2026) ⏳

**Tasks:**
- [ ] Develop Cost of Production Report UI
- [ ] Display EUP calculation breakdown
- [ ] Show cost flow across stages
- [ ] WIP valuation dashboard
- [ ] Scrap analysis dashboard

**Timeline:** 3-4 weeks

---

## 📊 Compliance Status

| Standard | Requirement | Current Status | Notes |
|---------|------------|----------------|-------|
| **IFRS/GAAP** | Accurate WIP valuation | ✅ **Compliant** | EUP implemented (v2.0) |
| **IAS 2** | Inventory costing | ✅ Compliant | AVCO integration works |
| **Process Costing** | EUP calculation | ✅ **Implemented** | Weighted-Average method (v2.0) |
| **Scrap Accounting** | Normal vs Abnormal | ✅ **Implemented** | Normal scrap allocated, abnormal charged to expense (v3.0) |

---

## 🎯 Recommendations

### For Current Use:

1. ✅ **Discrete Manufacturing**: System works correctly
   - No WIP between stages
   - Each stage completes fully before next stage

2. ⚠️ **Continuous Manufacturing**: Use with caution
   - Manual WIP adjustments may be needed
   - Consider external calculations for WIP valuation

3. ✅ **Documentation**: Always document WIP manually
   - Track WIP quantities outside system
   - Adjust costs manually if needed

### For Future Development:

1. 🔴 **Priority 1**: Implement EUP (Phase 1)
   - Most critical for accuracy
   - Foundation for other improvements

2. 🟡 **Priority 2**: Scrap Accounting (Phase 2)
   - Important for cost accuracy
   - Required for compliance

3. 🟢 **Priority 3**: FIFO Method (Phase 3)
   - Nice to have
   - Industry-specific requirement

---

## 📚 References

- [IFRS Standards - IAS 2](https://www.ifrs.org/)
- [GAAP - Process Costing](https://www.accountingcoach.com/)
- [Cost Accounting Standards](https://www.casb.gov/)

---

**Last Updated:** 25 ديسمبر 2025  
**Next Review:** بعد تنفيذ Phase 3 (FIFO Method - Q3 2026)

---

## ✅ Recent Updates (25 ديسمبر 2025)

### Phase 1: EUP Implementation Completed ✅
- ✅ Migration 67: Implemented Weighted-Average EUP calculation
- ✅ Updated `upsert_stage_cost` function with WIP parameters
- ✅ Added 7 new EUP test cases (22 tests total)
- ✅ Backward compatible: Existing code works without changes

**Key Features:**
- EUP calculation for Direct Materials (Stage 1)
- EUP calculation for Conversion Costs (Primary)
- Automatic fallback to old method when WIP = 0
- Validation for WIP completion percentages (0-100)

### Phase 2: Scrap Accounting Completed ✅
- ✅ Migration 68: Implemented Normal vs Abnormal scrap accounting
- ✅ Added `normal_scrap_rate` to `work_centers` table
- ✅ Added scrap accounting fields to `stage_costs` table
- ✅ Implemented scrap cost allocation logic
- ✅ Added 7 new scrap accounting test cases (29 tests total)
- ✅ Backward compatible: All new parameters have default values

**Key Features:**
- Normal scrap cost allocated to good units (increases unit cost)
- Abnormal scrap cost charged to expense (period cost)
- Regrind/reprocessing cost support
- Waste credit support
- Automatic calculation based on work center normal scrap rate

### Phase 3: FIFO Method Completed ✅
- ✅ Migration 69: Implemented FIFO costing method
- ✅ Added `costing_method` to `manufacturing_orders` table
- ✅ Added beginning WIP cost fields to `stage_costs` table
- ✅ Implemented FIFO EUP calculation (subtracts beginning WIP)
- ✅ Separated beginning WIP cost from current period cost
- ✅ Added 7 new FIFO test cases (36 tests total)
- ✅ Backward compatible: Default method is Weighted-Average

**Key Features:**
- FIFO EUP calculation: `eup = good_qty + ending_wip - beginning_wip`
- Beginning WIP cost tracked separately
- Current period cost calculated separately in FIFO
- Unit cost based on current period cost only in FIFO
- Method selection per manufacturing order
