-- ===================================================================
-- FIX MISSING COMPONENTS - Phase 1
-- ===================================================================
-- 
-- This script fixes common issues found during verification
-- Run this AFTER running 21_diagnose_failed_checks.sql
-- ===================================================================

-- ===================================================================
-- 1. ENABLE RLS (if disabled)
-- ===================================================================

DO $$
BEGIN
    -- Check and enable RLS for manufacturing_stages
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'manufacturing_stages' AND rowsecurity = false) THEN
        ALTER TABLE public.manufacturing_stages ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✅ Enabled RLS for manufacturing_stages';
    END IF;
    
    -- Check and enable RLS for stage_wip_log
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'stage_wip_log' AND rowsecurity = false) THEN
        ALTER TABLE public.stage_wip_log ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✅ Enabled RLS for stage_wip_log';
    END IF;
    
    -- Check and enable RLS for standard_costs
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'standard_costs' AND rowsecurity = false) THEN
        ALTER TABLE public.standard_costs ENABLE ROW LEVEL SECURITY;
        RAISE NOTICE '✅ Enabled RLS for standard_costs';
    END IF;
END $$;

-- ===================================================================
-- 2. CREATE MISSING RLS POLICIES
-- ===================================================================

-- Manufacturing Stages Policy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'manufacturing_stages' 
        AND policyname = 'manufacturing_stages_tenant_isolation'
    ) THEN
        CREATE POLICY manufacturing_stages_tenant_isolation ON public.manufacturing_stages
            FOR ALL
            USING (org_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid);
        RAISE NOTICE '✅ Created RLS policy for manufacturing_stages';
    END IF;
END $$;

-- Stage WIP Log Policy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'stage_wip_log' 
        AND policyname = 'stage_wip_log_tenant_isolation'
    ) THEN
        CREATE POLICY stage_wip_log_tenant_isolation ON public.stage_wip_log
            FOR ALL
            USING (org_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid);
        RAISE NOTICE '✅ Created RLS policy for stage_wip_log';
    END IF;
END $$;

-- Standard Costs Policy
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies 
        WHERE schemaname = 'public' 
        AND tablename = 'standard_costs' 
        AND policyname = 'standard_costs_tenant_isolation'
    ) THEN
        CREATE POLICY standard_costs_tenant_isolation ON public.standard_costs
            FOR ALL
            USING (org_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'org_id')::uuid);
        RAISE NOTICE '✅ Created RLS policy for standard_costs';
    END IF;
END $$;

-- ===================================================================
-- 3. CREATE MISSING TRIGGER
-- ===================================================================

-- First, ensure the function exists
CREATE OR REPLACE FUNCTION calculate_wip_equivalent_units()
RETURNS TRIGGER AS $$
BEGIN
    -- Calculate Equivalent Units for Materials
    NEW.equivalent_units_material := 
        (NEW.units_completed * (NEW.material_completion_pct / 100.0)) +
        (NEW.units_ending_wip * (NEW.material_completion_pct / 100.0));
    
    -- Calculate Equivalent Units for Conversion (Labor + Overhead)
    NEW.equivalent_units_conversion := 
        (NEW.units_completed * (NEW.conversion_completion_pct / 100.0)) +
        (NEW.units_ending_wip * (NEW.conversion_completion_pct / 100.0));
    
    -- Calculate Cost per Equivalent Unit (Weighted Average Method)
    IF NEW.equivalent_units_material > 0 THEN
        NEW.cost_per_eu_material := 
            (NEW.cost_beginning_wip + NEW.cost_material + NEW.cost_transferred_in) / 
            NEW.equivalent_units_material;
    ELSE
        NEW.cost_per_eu_material := 0;
    END IF;
    
    IF NEW.equivalent_units_conversion > 0 THEN
        NEW.cost_per_eu_conversion := 
            (NEW.cost_labor + NEW.cost_overhead) / 
            NEW.equivalent_units_conversion;
    ELSE
        NEW.cost_per_eu_conversion := 0;
    END IF;
    
    -- Calculate Valuation
    NEW.cost_completed_transferred := 
        (NEW.units_completed * NEW.cost_per_eu_material) +
        (NEW.units_completed * NEW.cost_per_eu_conversion);
    
    NEW.cost_ending_wip := 
        (NEW.units_ending_wip * NEW.material_completion_pct / 100.0 * NEW.cost_per_eu_material) +
        (NEW.units_ending_wip * NEW.conversion_completion_pct / 100.0 * NEW.cost_per_eu_conversion);
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.triggers
        WHERE trigger_schema = 'public'
        AND trigger_name = 'trigger_calculate_wip_eu'
        AND event_object_table = 'stage_wip_log'
    ) THEN
        CREATE TRIGGER trigger_calculate_wip_eu
            BEFORE INSERT OR UPDATE ON public.stage_wip_log
            FOR EACH ROW
            EXECUTE FUNCTION calculate_wip_equivalent_units();
        RAISE NOTICE '✅ Created trigger trigger_calculate_wip_eu';
    END IF;
END $$;

-- ===================================================================
-- 4. GRANT PERMISSIONS (if missing)
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
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '✅ FIX SCRIPT COMPLETE!';
    RAISE NOTICE '════════════════════════════════════════════════════════';
    RAISE NOTICE '';
    RAISE NOTICE 'Next step: Run verification again:';
    RAISE NOTICE '  File: sql/migrations/21_diagnose_failed_checks.sql';
    RAISE NOTICE '';
    RAISE NOTICE '════════════════════════════════════════════════════════';
END $$;

