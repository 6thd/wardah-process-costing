-- ===================================================================
-- Migration: Add WIP Fields to stage_costs (Preparation for EUP)
-- Date: 2025-12-25
-- Purpose: Add fields for WIP tracking without changing calculation logic
-- Risk Level: ⚪ Zero (only adds columns, no logic changes)
-- ===================================================================

-- Add WIP tracking fields for Ending WIP
ALTER TABLE public.stage_costs
ADD COLUMN IF NOT EXISTS wip_end_qty NUMERIC(18,6) DEFAULT 0 CHECK (wip_end_qty >= 0),
ADD COLUMN IF NOT EXISTS wip_end_dm_completion_pct NUMERIC(5,2) DEFAULT 0 CHECK (wip_end_dm_completion_pct >= 0 AND wip_end_dm_completion_pct <= 100),
ADD COLUMN IF NOT EXISTS wip_end_cc_completion_pct NUMERIC(5,2) DEFAULT 0 CHECK (wip_end_cc_completion_pct >= 0 AND wip_end_cc_completion_pct <= 100);

-- Add WIP tracking fields for Beginning WIP (for FIFO method)
ALTER TABLE public.stage_costs
ADD COLUMN IF NOT EXISTS wip_beginning_qty NUMERIC(18,6) DEFAULT 0 CHECK (wip_beginning_qty >= 0),
ADD COLUMN IF NOT EXISTS wip_beginning_dm_completion_pct NUMERIC(5,2) DEFAULT 0 CHECK (wip_beginning_dm_completion_pct >= 0 AND wip_beginning_dm_completion_pct <= 100),
ADD COLUMN IF NOT EXISTS wip_beginning_cc_completion_pct NUMERIC(5,2) DEFAULT 0 CHECK (wip_beginning_cc_completion_pct >= 0 AND wip_beginning_cc_completion_pct <= 100);

-- Add index for WIP queries (for future EUP calculations)
-- Dynamically detect which columns exist (org_id vs tenant_id, mo_id vs manufacturing_order_id)
DO $$
DECLARE
    v_tenant_col TEXT;
    v_mo_col TEXT;
BEGIN
    -- Determine tenant column (prefer tenant_id, fallback to org_id)
    SELECT column_name INTO v_tenant_col
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'stage_costs'
    AND column_name IN ('tenant_id', 'org_id')
    ORDER BY 
      CASE column_name 
        WHEN 'tenant_id' THEN 1
        WHEN 'org_id' THEN 2
      END
    LIMIT 1;
    
    -- Determine MO column (prefer mo_id, fallback to manufacturing_order_id)
    SELECT column_name INTO v_mo_col
    FROM information_schema.columns
    WHERE table_schema = 'public'
    AND table_name = 'stage_costs'
    AND column_name IN ('mo_id', 'manufacturing_order_id')
    ORDER BY 
      CASE column_name 
        WHEN 'mo_id' THEN 1
        WHEN 'manufacturing_order_id' THEN 2
      END
    LIMIT 1;
    
    -- Create index if both columns exist
    IF v_tenant_col IS NOT NULL AND v_mo_col IS NOT NULL THEN
        EXECUTE format(
            'CREATE INDEX IF NOT EXISTS idx_stage_costs_wip ON public.stage_costs(%I, %I) WHERE wip_end_qty > 0 OR wip_beginning_qty > 0',
            v_tenant_col,
            v_mo_col
        );
        RAISE NOTICE 'Created index idx_stage_costs_wip on (%, %)', v_tenant_col, v_mo_col;
    ELSE
        RAISE NOTICE 'Could not create index: tenant_col=%, mo_col=%', v_tenant_col, v_mo_col;
    END IF;
END $$;

-- Add comments for documentation
COMMENT ON COLUMN public.stage_costs.wip_end_qty IS 
  'Ending WIP quantity for this stage (for EUP calculation). Currently not used in unit_cost calculation.';

COMMENT ON COLUMN public.stage_costs.wip_end_dm_completion_pct IS 
  'Direct Materials completion percentage for ending WIP (0-100). Used for EUP calculation.';

COMMENT ON COLUMN public.stage_costs.wip_end_cc_completion_pct IS 
  'Conversion Costs (Labor + Overhead) completion percentage for ending WIP (0-100). Used for EUP calculation.';

COMMENT ON COLUMN public.stage_costs.wip_beginning_qty IS 
  'Beginning WIP quantity (for FIFO method). Currently not used.';

COMMENT ON COLUMN public.stage_costs.wip_beginning_dm_completion_pct IS 
  'Direct Materials completion percentage for beginning WIP (for FIFO method).';

COMMENT ON COLUMN public.stage_costs.wip_beginning_cc_completion_pct IS 
  'Conversion Costs completion percentage for beginning WIP (for FIFO method).';

-- ===================================================================
-- Migration Notes:
-- ===================================================================
-- This migration adds WIP tracking fields without changing any calculation logic.
-- The fields are prepared for future EUP (Equivalent Units of Production) implementation.
-- 
-- Current behavior (unchanged):
--   unit_cost = total_cost / good_qty
--
-- Future behavior (after EUP implementation):
--   eup = good_qty + (wip_end_qty * completion_pct)
--   unit_cost = total_cost / eup
--
-- Risk: ⚪ Zero - Only adds columns with default values
-- Testing: Run existing tests to ensure no regressions
-- ===================================================================

