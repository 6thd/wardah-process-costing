# 📊 Process Costing Plan Review - Gemini 3.0 Plan Analysis

> **تصحيح مؤرَّخ — 2026-09-25 (`main@0761d567`):** هذه المراجعة وثيقة تخطيط تاريخية،
> وجدول «Current State» فيها **قديم**. تصحيحات الحالة الراهنة:
>
> - **`stage_wip_log` موجود** في Baseline cutoff 189 (`000_schema_baseline_20260905_184634.sql`)،
>   وله عمود محسوب `cost_total`. وتكتب فيه `rpc_consume_reserved_materials_v2` تكلفة المواد
>   داخل معاملة الاستهلاك الذرية. عبارة «❌ غير موجود» في الجدول أدناه لم تعد صحيحة.
> - **وجود البنية/المحرك في SQL ≠ اكتمال مسار Process Costing الحي.** على مخطط cutoff 189
>   يفشل `upsert_stage_cost` بـ`42702 costing_method ambiguous`، ويفشل
>   `rpc_cost_of_production_report` على صف قانوني. ويكتب مسار الواجهة الحي أعمدة وجداول
>   غير موجودة. التتبّع في #260، والأدلة في `docs/db/manufacturing-inventory-red-20260925/`.
> - المرجع الحالي هو `ADVANCED_MANUFACTURING_ROADMAP.md` (MFG-P1)، وكذلك
>   `CANONICAL_MANUFACTURING_EXECUTION_CONTRACT.md` §22.

## 🎯 Executive Summary

**الخطة الجديدة ممتازة وتكمل الخطة السابقة بشكل أفضل!** ⭐⭐⭐⭐⭐

### ✅ **نقاط القوة:**
1. **أكثر تفصيلاً**: جداول محددة (`manufacturing_stages`, `stage_wip_log`, `standard_costs`)
2. **Weighted Average Method**: واضح ومحدد
3. **GL Integration**: جدول محاسبي واضح
4. **Implementation Phases**: خطوات عملية

### ⚠️ **تحسينات مقترحة:**
1. **Integration مع الوضع الحالي**: بعض الجداول موجودة بالفعل
2. **Migration Strategy**: كيفية الانتقال من `stage_costs` إلى `stage_wip_log`
3. **Backward Compatibility**: الحفاظ على البيانات الموجودة

---

## 📋 Current State vs. Proposed Changes

### 1. **Database Schema Comparison**

#### ✅ **ما هو موجود حالياً:**

| Table | Status | Notes |
|-------|--------|-------|
| `stage_costs` | ✅ موجود | لكن structure مختلف |
| `equivalent_units` | ✅ موجود | في SQL functions |
| `variance_analysis` | ✅ موجود | في SQL functions |
| `products.standard_cost` | ✅ موجود | لكن ليس per stage |
| `work_centers` | ✅ موجود | يمكن استخدامه كـ stages |

#### ❌ **ما ينقص (مطلوب في الخطة):**

| Table | Status | Priority | Notes |
|-------|--------|----------|-------|
| `manufacturing_stages` | ❌ غير موجود | **HIGH** | مفيد جداً للـ standardization |
| `stage_wip_log` | ❌ غير موجود | **HIGH** | مطلوب للـ period-based tracking |
| `standard_costs` | ❌ غير موجود | **MEDIUM** | يمكن استخدام `products.standard_cost` + stage mapping |

---

## 🔍 Detailed Analysis

### **1. manufacturing_stages Table** ⭐⭐⭐⭐⭐

#### ✅ **مطلوب بشدة:**

**الخطة المقترحة:**
```sql
CREATE TABLE manufacturing_stages (
    id UUID PRIMARY KEY,
    name VARCHAR(255), -- 'Mixing', 'Molding', 'Assembly'
    order_sequence INTEGER,
    description TEXT
);
```

**تحسينات مقترحة:**
```sql
CREATE TABLE manufacturing_stages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    code VARCHAR(50) NOT NULL, -- 'STG-001', 'STG-002'
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255), -- Arabic name
    order_sequence INTEGER NOT NULL,
    description TEXT,
    work_center_id UUID REFERENCES work_centers(id), -- Link to work center
    wip_gl_account_id UUID REFERENCES gl_accounts(id), -- WIP GL account for this stage
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(org_id, code),
    UNIQUE(org_id, order_sequence) -- Prevent duplicate sequences
);
```

**السبب:**
- ✅ `org_id` للـ multi-tenant support
- ✅ `code` للـ reference
- ✅ `work_center_id` للربط مع work centers الموجودة
- ✅ `wip_gl_account_id` للربط المباشر مع GL
- ✅ `name_ar` للدعم العربي

---

### **2. stage_wip_log Table** ⭐⭐⭐⭐⭐

#### ✅ **مطلوب بشدة - هذا هو الأهم!**

**الخطة المقترحة:**
```sql
CREATE TABLE stage_wip_log (
    id UUID PRIMARY KEY,
    mo_id UUID,
    stage_id UUID,
    period_start DATE,
    period_end DATE,
    units_beginning, units_started, units_completed, units_ending,
    cost_material, cost_conversion,
    equivalent_units_material, equivalent_units_conversion
);
```

**تحسينات مقترحة:**
```sql
CREATE TABLE stage_wip_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES manufacturing_stages(id),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Units tracking
    units_beginning_wip DECIMAL(18,6) DEFAULT 0,
    units_started DECIMAL(18,6) DEFAULT 0,
    units_completed DECIMAL(18,6) DEFAULT 0,
    units_ending_wip DECIMAL(18,6) DEFAULT 0,
    units_transferred_out DECIMAL(18,6) DEFAULT 0,
    units_transferred_in DECIMAL(18,6) DEFAULT 0,
    
    -- Completion percentages
    material_completion_pct DECIMAL(5,2) DEFAULT 100, -- For ending WIP
    conversion_completion_pct DECIMAL(5,2) DEFAULT 100, -- For ending WIP
    
    -- Costs
    cost_beginning_wip DECIMAL(18,6) DEFAULT 0, -- Beginning WIP cost
    cost_material DECIMAL(18,6) DEFAULT 0, -- Material costs added this period
    cost_labor DECIMAL(18,6) DEFAULT 0, -- Labor costs added this period
    cost_overhead DECIMAL(18,6) DEFAULT 0, -- Overhead costs added this period
    cost_transferred_in DECIMAL(18,6) DEFAULT 0, -- Cost from previous stage
    cost_total DECIMAL(18,6) GENERATED ALWAYS AS (
        cost_beginning_wip + cost_material + cost_labor + 
        cost_overhead + cost_transferred_in
    ) STORED,
    
    -- Equivalent Units (calculated)
    equivalent_units_material DECIMAL(18,6) DEFAULT 0,
    equivalent_units_conversion DECIMAL(18,6) DEFAULT 0,
    
    -- Cost per Equivalent Unit (calculated)
    cost_per_eu_material DECIMAL(18,6) DEFAULT 0,
    cost_per_eu_conversion DECIMAL(18,6) DEFAULT 0,
    
    -- Valuation
    cost_completed_transferred DECIMAL(18,6) DEFAULT 0,
    cost_ending_wip DECIMAL(18,6) DEFAULT 0,
    
    -- Status
    is_closed BOOLEAN DEFAULT false, -- Period closed
    closed_at TIMESTAMPTZ,
    closed_by UUID,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    CHECK (period_start <= period_end),
    CHECK (units_beginning_wip + units_started = units_completed + units_ending_wip + units_transferred_out),
    UNIQUE(org_id, mo_id, stage_id, period_start, period_end)
);
```

**السبب:**
- ✅ **Period-based tracking**: مطلوب للـ monthly/period reporting
- ✅ **Complete cost breakdown**: Material, Labor, Overhead منفصلة
- ✅ **Transferred costs**: لتتبع cost flow بين المراحل
- ✅ **Equivalent Units**: محسوبة ومخزنة
- ✅ **Valuation**: Completed vs Ending WIP
- ✅ **Period closing**: لتأمين البيانات

---

### **3. standard_costs Table** ⭐⭐⭐⭐

#### ✅ **مفيد لكن يمكن تحسينه:**

**الخطة المقترحة:**
```sql
CREATE TABLE standard_costs (
    item_id UUID,
    stage_id UUID,
    material_cost_per_unit,
    labor_cost_per_unit,
    overhead_cost_per_unit
);
```

**تحسينات مقترحة:**
```sql
CREATE TABLE standard_costs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id),
    stage_id UUID NOT NULL REFERENCES manufacturing_stages(id),
    
    -- Standard costs per unit
    material_cost_per_unit DECIMAL(18,6) DEFAULT 0,
    labor_cost_per_unit DECIMAL(18,6) DEFAULT 0,
    overhead_cost_per_unit DECIMAL(18,6) DEFAULT 0,
    total_cost_per_unit DECIMAL(18,6) GENERATED ALWAYS AS (
        material_cost_per_unit + labor_cost_per_unit + overhead_cost_per_unit
    ) STORED,
    
    -- Standard quantities (for variance analysis)
    standard_material_qty DECIMAL(18,6) DEFAULT 0, -- Standard material qty per unit
    standard_labor_hours DECIMAL(8,2) DEFAULT 0, -- Standard labor hours per unit
    
    -- Effective dates
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN DEFAULT true,
    
    -- Approval
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    UNIQUE(org_id, product_id, stage_id, effective_from)
);
```

**السبب:**
- ✅ **Per stage**: كل stage له standard costs
- ✅ **Effective dates**: لتتبع التغييرات
- ✅ **Standard quantities**: للـ variance analysis
- ✅ **Approval workflow**: لتأمين standard costs

---

## 🔄 Migration Strategy

### **من `stage_costs` إلى `stage_wip_log`:**

**المشكلة:** `stage_costs` موجودة بالفعل وقد تحتوي على بيانات

**الحل:**
```sql
-- Step 1: Create new tables
-- (manufacturing_stages, stage_wip_log, standard_costs)

-- Step 2: Migrate existing data
INSERT INTO manufacturing_stages (org_id, code, name, order_sequence)
SELECT DISTINCT 
    org_id,
    'STG-' || LPAD(stage_no::text, 3, '0') as code,
    'Stage ' || stage_no as name,
    stage_no as order_sequence
FROM stage_costs
WHERE stage_no IS NOT NULL
ON CONFLICT DO NOTHING;

-- Step 3: Create initial WIP logs from stage_costs
INSERT INTO stage_wip_log (
    org_id, mo_id, stage_id, period_start, period_end,
    units_completed, cost_material, cost_labor, cost_overhead
)
SELECT 
    sc.org_id,
    sc.mo_id,
    ms.id as stage_id,
    DATE_TRUNC('month', sc.created_at)::DATE as period_start,
    (DATE_TRUNC('month', sc.created_at) + INTERVAL '1 month - 1 day')::DATE as period_end,
    sc.good_quantity as units_completed,
    sc.dm_cost as cost_material,
    sc.dl_cost as cost_labor,
    sc.moh_cost as cost_overhead
FROM stage_costs sc
JOIN manufacturing_stages ms ON ms.order_sequence = sc.stage_no
WHERE sc.org_id = ms.org_id;

-- Step 4: Keep stage_costs for backward compatibility (deprecated)
-- Add migration flag
ALTER TABLE stage_costs ADD COLUMN migrated_to_wip_log BOOLEAN DEFAULT false;
```

---

## 📊 GL Integration - Enhanced

### **الخطة المقترحة ممتازة!** ✅

لكن يمكن تحسينها:

```typescript
// Enhanced GL Integration Service
class ManufacturingAccountingService {
  
  // 1. Material Issuance → WIP
  async postMaterialToWIP(moId: string, stageId: string, materialCost: number) {
    const stage = await getManufacturingStage(stageId);
    const rawMaterialsAccount = await getGLAccount('1130'); // Raw Materials
    
    return await createJournalEntry({
      description: `Material Issuance - MO ${moId} - Stage ${stage.name}`,
      lines: [
        { account: stage.wip_gl_account_id, debit: materialCost, credit: 0 },
        { account: rawMaterialsAccount.id, debit: 0, credit: materialCost }
      ],
      reference_type: 'MATERIAL_ISSUANCE',
      reference_id: moId
    });
  }
  
  // 2. Labor → WIP
  async postLaborToWIP(moId: string, stageId: string, laborCost: number) {
    const stage = await getManufacturingStage(stageId);
    const wagesPayableAccount = await getGLAccount('2200'); // Wages Payable
    
    return await createJournalEntry({
      description: `Direct Labor - MO ${moId} - Stage ${stage.name}`,
      lines: [
        { account: stage.wip_gl_account_id, debit: laborCost, credit: 0 },
        { account: wagesPayableAccount.id, debit: 0, credit: laborCost }
      ],
      reference_type: 'LABOR_ALLOCATION',
      reference_id: moId
    });
  }
  
  // 3. Overhead → WIP
  async postOverheadToWIP(moId: string, stageId: string, overheadCost: number) {
    const stage = await getManufacturingStage(stageId);
    const overheadControlAccount = await getGLAccount('5100'); // Manufacturing Overhead Control
    
    return await createJournalEntry({
      description: `Factory Overhead - MO ${moId} - Stage ${stage.name}`,
      lines: [
        { account: stage.wip_gl_account_id, debit: overheadCost, credit: 0 },
        { account: overheadControlAccount.id, debit: 0, credit: overheadCost }
      ],
      reference_type: 'OVERHEAD_ALLOCATION',
      reference_id: moId
    });
  }
  
  // 4. Stage Transfer
  async postStageTransfer(
    moId: string, 
    fromStageId: string, 
    toStageId: string, 
    transferCost: number
  ) {
    const fromStage = await getManufacturingStage(fromStageId);
    const toStage = await getManufacturingStage(toStageId);
    
    return await createJournalEntry({
      description: `Stage Transfer - MO ${moId} - ${fromStage.name} → ${toStage.name}`,
      lines: [
        { account: toStage.wip_gl_account_id, debit: transferCost, credit: 0 },
        { account: fromStage.wip_gl_account_id, debit: 0, credit: transferCost }
      ],
      reference_type: 'STAGE_TRANSFER',
      reference_id: moId
    });
  }
  
  // 5. Completion → Finished Goods
  async postCompletionToFG(moId: string, finalStageId: string, totalCost: number) {
    const finalStage = await getManufacturingStage(finalStageId);
    const fgAccount = await getGLAccount('1140'); // Finished Goods Inventory
    
    return await createJournalEntry({
      description: `Production Completion - MO ${moId}`,
      lines: [
        { account: fgAccount.id, debit: totalCost, credit: 0 },
        { account: finalStage.wip_gl_account_id, debit: 0, credit: totalCost }
      ],
      reference_type: 'PRODUCTION_COMPLETION',
      reference_id: moId
    });
  }
}
```

---

## 🎯 Implementation Phases - Enhanced

### **Phase 1: Foundation & Schema (Week 1-2)** ✅

**Tasks:**
1. ✅ Create `manufacturing_stages` table (with enhancements)
2. ✅ Create `stage_wip_log` table (with enhancements)
3. ✅ Create `standard_costs` table (with enhancements)
4. ✅ Create migration script from `stage_costs`
5. ✅ Update `supabase-service.ts` with new tables

**Deliverables:**
- ✅ Database schema complete
- ✅ Migration script tested
- ✅ Backward compatibility maintained

---

### **Phase 2: Core Logic (Week 3-4)** ✅

**Tasks:**
1. ✅ Implement `EquivalentUnitsService` (replace mocks)
2. ✅ Implement `CostAllocationService` for overheads
3. ✅ Implement `WIPValuationService` (Weighted Average Method)
4. ✅ Implement `CostTransferService` (Stage to Stage)

**Deliverables:**
- ✅ Equivalent Units calculations working
- ✅ Cost accumulation automated
- ✅ Cost transfer automated

---

### **Phase 3: GL Integration (Week 5-6)** ✅

**Tasks:**
1. ✅ Create `ManufacturingAccountingService`
2. ✅ Implement automated GL entries:
   - Material → WIP
   - Labor → WIP
   - Overhead → WIP
   - Stage → Stage
   - WIP → Finished Goods
3. ✅ Connect `StageCostingPanel` "Post to GL" button
4. ✅ Add GL account mapping to `manufacturing_stages`

**Deliverables:**
- ✅ All GL entries automated
- ✅ Real-time GL integration
- ✅ Audit trail complete

---

### **Phase 4: UI/Reporting (Week 7-8)** ✅

**Tasks:**
1. ✅ Connect `EquivalentUnitsDashboard` to real data
2. ✅ Implement `VarianceAlerts` with real comparisons
3. ✅ Create WIP Valuation Reports
4. ✅ Create Cost Flow Visualization
5. ✅ Create Period Closing UI

**Deliverables:**
- ✅ All dashboards working with real data
- ✅ Reports complete
- ✅ User experience polished

---

## ✅ Final Recommendations

### **الخطة ممتازة!** ⭐⭐⭐⭐⭐

**نقاط القوة:**
- ✅ شاملة ومفصلة
- ✅ GL Integration واضح
- ✅ Implementation phases منطقية
- ✅ Weighted Average Method محدد

**تحسينات مقترحة:**
1. ✅ **Add `org_id`** لجميع الجداول (multi-tenant)
2. ✅ **Link to `work_centers`** في `manufacturing_stages`
3. ✅ **Add GL account mapping** في `manufacturing_stages`
4. ✅ **Add period closing** في `stage_wip_log`
5. ✅ **Migration strategy** من `stage_costs`
6. ✅ **Backward compatibility** plan

**التوصية:** ✅ **نعم، ابدأ التنفيذ مع التحسينات المقترحة!**

---

## 📝 Next Steps

1. ✅ **Review & Approve** هذا التحليل
2. ✅ **Create Enhanced Schema** مع التحسينات
3. ✅ **Create Migration Script** من `stage_costs`
4. ✅ **Start Phase 1 Implementation**

---

**تاريخ المراجعة:** 2025-01-20  
**المراجع:** AI Assistant (Auto)  
**الحالة:** ✅ **APPROVED with Enhancements**

