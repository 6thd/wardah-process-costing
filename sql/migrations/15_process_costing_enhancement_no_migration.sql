-- ===================================================================
-- PROCESS COSTING ENHANCEMENT - Phase 1: Schema Only (No Migration)
-- ===================================================================
-- 
-- Use this version if stage_costs table is EMPTY (0 records)
-- This creates the new tables without attempting data migration
-- ===================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===================================================================
-- 1. MANUFACTURING STAGES TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.manufacturing_stages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- Stage identification
    code VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    name_ar VARCHAR(255),
    description TEXT,
    
    -- Sequence and ordering
    order_sequence INTEGER NOT NULL CHECK (order_sequence > 0),
    
    -- Integration with existing tables
    work_center_id UUID REFERENCES work_centers(id),
    wip_gl_account_id UUID REFERENCES gl_accounts(id),
    
    -- Status
    is_active BOOLEAN DEFAULT true,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    UNIQUE(org_id, code),
    UNIQUE(org_id, order_sequence)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_manufacturing_stages_org ON public.manufacturing_stages(org_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_stages_sequence ON public.manufacturing_stages(org_id, order_sequence);
CREATE INDEX IF NOT EXISTS idx_manufacturing_stages_work_center ON public.manufacturing_stages(work_center_id);
CREATE INDEX IF NOT EXISTS idx_manufacturing_stages_gl_account ON public.manufacturing_stages(wip_gl_account_id);

-- Comments
COMMENT ON TABLE public.manufacturing_stages IS 'Standard production stages for process costing with GL account mapping';
COMMENT ON COLUMN public.manufacturing_stages.wip_gl_account_id IS 'GL account for WIP inventory at this stage';

-- ===================================================================
-- 2. STAGE WIP LOG TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.stage_wip_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- References
    mo_id UUID NOT NULL REFERENCES manufacturing_orders(id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES manufacturing_stages(id),
    
    -- Period tracking
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    
    -- Units tracking
    units_beginning_wip DECIMAL(18,6) DEFAULT 0 CHECK (units_beginning_wip >= 0),
    units_started DECIMAL(18,6) DEFAULT 0 CHECK (units_started >= 0),
    units_completed DECIMAL(18,6) DEFAULT 0 CHECK (units_completed >= 0),
    units_ending_wip DECIMAL(18,6) DEFAULT 0 CHECK (units_ending_wip >= 0),
    units_transferred_out DECIMAL(18,6) DEFAULT 0 CHECK (units_transferred_out >= 0),
    units_transferred_in DECIMAL(18,6) DEFAULT 0 CHECK (units_transferred_in >= 0),
    
    -- Completion percentages
    material_completion_pct DECIMAL(5,2) DEFAULT 100 CHECK (material_completion_pct >= 0 AND material_completion_pct <= 100),
    conversion_completion_pct DECIMAL(5,2) DEFAULT 100 CHECK (conversion_completion_pct >= 0 AND conversion_completion_pct <= 100),
    
    -- Cost breakdown
    cost_beginning_wip DECIMAL(18,6) DEFAULT 0,
    cost_material DECIMAL(18,6) DEFAULT 0 CHECK (cost_material >= 0),
    cost_labor DECIMAL(18,6) DEFAULT 0 CHECK (cost_labor >= 0),
    cost_overhead DECIMAL(18,6) DEFAULT 0 CHECK (cost_overhead >= 0),
    cost_transferred_in DECIMAL(18,6) DEFAULT 0 CHECK (cost_transferred_in >= 0),
    
    -- Calculated total cost
    cost_total DECIMAL(18,6) GENERATED ALWAYS AS (
        cost_beginning_wip + cost_material + cost_labor + cost_overhead + cost_transferred_in
    ) STORED,
    
    -- Equivalent Units (calculated)
    equivalent_units_material DECIMAL(18,6) DEFAULT 0 CHECK (equivalent_units_material >= 0),
    equivalent_units_conversion DECIMAL(18,6) DEFAULT 0 CHECK (equivalent_units_conversion >= 0),
    
    -- Cost per Equivalent Unit (calculated)
    cost_per_eu_material DECIMAL(18,6) DEFAULT 0 CHECK (cost_per_eu_material >= 0),
    cost_per_eu_conversion DECIMAL(18,6) DEFAULT 0 CHECK (cost_per_eu_conversion >= 0),
    
    -- Valuation
    cost_completed_transferred DECIMAL(18,6) DEFAULT 0 CHECK (cost_completed_transferred >= 0),
    cost_ending_wip DECIMAL(18,6) DEFAULT 0 CHECK (cost_ending_wip >= 0),
    
    -- Period status
    is_closed BOOLEAN DEFAULT false,
    closed_at TIMESTAMPTZ,
    closed_by UUID,
    
    -- Notes
    notes TEXT,
    batch_number VARCHAR(100),
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CHECK (period_start <= period_end),
    CHECK (units_beginning_wip + units_started = units_completed + units_ending_wip + units_transferred_out),
    UNIQUE(org_id, mo_id, stage_id, period_start, period_end)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_stage_wip_log_org_mo ON public.stage_wip_log(org_id, mo_id);
CREATE INDEX IF NOT EXISTS idx_stage_wip_log_stage ON public.stage_wip_log(stage_id);
CREATE INDEX IF NOT EXISTS idx_stage_wip_log_period ON public.stage_wip_log(org_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_stage_wip_log_closed ON public.stage_wip_log(org_id, is_closed);

-- Comments
COMMENT ON TABLE public.stage_wip_log IS 'Period-based WIP tracking with Weighted Average Method for process costing';

-- ===================================================================
-- 3. STANDARD COSTS TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS public.standard_costs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    
    -- References
    product_id UUID NOT NULL REFERENCES products(id),
    stage_id UUID NOT NULL REFERENCES manufacturing_stages(id),
    
    -- Standard costs per unit
    material_cost_per_unit DECIMAL(18,6) DEFAULT 0 CHECK (material_cost_per_unit >= 0),
    labor_cost_per_unit DECIMAL(18,6) DEFAULT 0 CHECK (labor_cost_per_unit >= 0),
    overhead_cost_per_unit DECIMAL(18,6) DEFAULT 0 CHECK (overhead_cost_per_unit >= 0),
    
    -- Calculated total
    total_cost_per_unit DECIMAL(18,6) GENERATED ALWAYS AS (
        material_cost_per_unit + labor_cost_per_unit + overhead_cost_per_unit
    ) STORED,
    
    -- Standard quantities
    standard_material_qty DECIMAL(18,6) DEFAULT 0 CHECK (standard_material_qty >= 0),
    standard_labor_hours DECIMAL(8,2) DEFAULT 0 CHECK (standard_labor_hours >= 0),
    
    -- Effective dates
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN DEFAULT true,
    
    -- Approval
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    
    -- Notes
    notes TEXT,
    
    -- Audit
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by UUID,
    updated_by UUID,
    
    -- Constraints
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    UNIQUE(org_id, product_id, stage_id, effective_from)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_standard_costs_org_product ON public.standard_costs(org_id, product_id);
CREATE INDEX IF NOT EXISTS idx_standard_costs_stage ON public.standard_costs(stage_id);
CREATE INDEX IF NOT EXISTS idx_standard_costs_effective ON public.standard_costs(org_id, effective_from, effective_to);
CREATE INDEX IF NOT EXISTS idx_standard_costs_active ON public.standard_costs(org_id, is_active);

-- Comments
COMMENT ON TABLE public.standard_costs IS 'Standard costs per stage for variance analysis';

-- ===================================================================
-- 4. TRIGGERS FOR AUTOMATED CALCULATIONS
-- ===================================================================

-- Trigger function to calculate equivalent units and cost per EU
CREATE OR REPLACE FUNCTION calculate_wip_equivalent_units()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate equivalent units for materials
    NEW.equivalent_units_material := 
        NEW.units_completed + 
        (NEW.units_ending_wip * NEW.material_completion_pct / 100);
    
    -- Calculate equivalent units for conversion costs
    NEW.equivalent_units_conversion := 
        NEW.units_completed + 
        (NEW.units_ending_wip * NEW.conversion_completion_pct / 100);
    
    -- Calculate cost per equivalent unit (Weighted Average Method)
    IF NEW.equivalent_units_material > 0 THEN
        NEW.cost_per_eu_material := 
            (NEW.cost_beginning_wip + NEW.cost_material + NEW.cost_transferred_in) / 
            NEW.equivalent_units_material;
    ELSE
        NEW.cost_per_eu_material := 0;
    END IF;
    
    IF NEW.equivalent_units_conversion > 0 THEN
        NEW.cost_per_eu_conversion := 
            (NEW.cost_beginning_wip + NEW.cost_labor + NEW.cost_overhead) / 
            NEW.equivalent_units_conversion;
    ELSE
        NEW.cost_per_eu_conversion := 0;
    END IF;
    
    -- Calculate valuation (Weighted Average Method)
    NEW.cost_completed_transferred := 
        (NEW.units_completed * NEW.cost_per_eu_material) +
        (NEW.units_completed * NEW.cost_per_eu_conversion);
    
    NEW.cost_ending_wip := 
        (NEW.units_ending_wip * NEW.material_completion_pct / 100 * NEW.cost_per_eu_material) +
        (NEW.units_ending_wip * NEW.conversion_completion_pct / 100 * NEW.cost_per_eu_conversion);
    
    NEW.updated_at := NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger
DROP TRIGGER IF EXISTS trigger_calculate_wip_eu ON public.stage_wip_log;
CREATE TRIGGER trigger_calculate_wip_eu
    BEFORE INSERT OR UPDATE ON public.stage_wip_log
    FOR EACH ROW
    EXECUTE FUNCTION calculate_wip_equivalent_units();

-- ===================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- ===================================================================

ALTER TABLE public.manufacturing_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_wip_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.standard_costs ENABLE ROW LEVEL SECURITY;

-- Manufacturing Stages Policies
DROP POLICY IF EXISTS manufacturing_stages_tenant_isolation ON public.manufacturing_stages;
CREATE POLICY manufacturing_stages_tenant_isolation ON public.manufacturing_stages
    FOR ALL
    USING (org_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid);

-- Stage WIP Log Policies
DROP POLICY IF EXISTS stage_wip_log_tenant_isolation ON public.stage_wip_log;
CREATE POLICY stage_wip_log_tenant_isolation ON public.stage_wip_log
    FOR ALL
    USING (org_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid);

-- Standard Costs Policies
DROP POLICY IF EXISTS standard_costs_tenant_isolation ON public.standard_costs;
CREATE POLICY standard_costs_tenant_isolation ON public.standard_costs
    FOR ALL
    USING (org_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid);

-- ===================================================================
-- 6. GRANT PERMISSIONS
-- ===================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manufacturing_stages TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stage_wip_log TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.standard_costs TO authenticated;

-- ===================================================================
-- SUCCESS MESSAGE
-- ===================================================================

DO $$
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '========================================';
    RAISE NOTICE '✅ SCHEMA CREATION COMPLETE!';
    RAISE NOTICE '========================================';
    RAISE NOTICE 'Created tables:';
    RAISE NOTICE '  ✅ manufacturing_stages';
    RAISE NOTICE '  ✅ stage_wip_log';
    RAISE NOTICE '  ✅ standard_costs';
    RAISE NOTICE '';
    RAISE NOTICE 'Note: stage_costs table was empty (0 records)';
    RAISE NOTICE '      No data migration needed - start using new structure!';
    RAISE NOTICE '========================================';
END $$;

