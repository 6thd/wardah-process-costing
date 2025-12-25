-- ===================================================================
-- Migration: Add Scrap Accounting Support
-- Date: 2025-12-25
-- Purpose: Add normal_scrap_rate field and implement scrap accounting logic
-- Risk Level: 🟡 Medium (adds new fields and calculation logic)
-- ===================================================================

-- ===================================================================
-- PART 1: Add normal_scrap_rate to work_centers table
-- ===================================================================

-- Add normal_scrap_rate column to work_centers
ALTER TABLE public.work_centers
ADD COLUMN IF NOT EXISTS normal_scrap_rate NUMERIC(5,2) DEFAULT 0 
CHECK (normal_scrap_rate >= 0 AND normal_scrap_rate <= 100);

-- Add comment
COMMENT ON COLUMN public.work_centers.normal_scrap_rate IS 
  'Normal scrap rate percentage (0-100) for this work center. Scrap within this rate is allocated to good units. Scrap exceeding this rate is charged as abnormal loss.';

-- ===================================================================
-- PART 2: Add scrap accounting fields to stage_costs table
-- ===================================================================

-- Add scrap accounting fields
ALTER TABLE public.stage_costs
ADD COLUMN IF NOT EXISTS normal_scrap_qty NUMERIC(18,6) DEFAULT 0 CHECK (normal_scrap_qty >= 0),
ADD COLUMN IF NOT EXISTS abnormal_scrap_qty NUMERIC(18,6) DEFAULT 0 CHECK (abnormal_scrap_qty >= 0),
ADD COLUMN IF NOT EXISTS normal_scrap_cost NUMERIC(18,6) DEFAULT 0 CHECK (normal_scrap_cost >= 0),
ADD COLUMN IF NOT EXISTS abnormal_scrap_cost NUMERIC(18,6) DEFAULT 0 CHECK (abnormal_scrap_cost >= 0),
ADD COLUMN IF NOT EXISTS regrind_cost NUMERIC(18,6) DEFAULT 0 CHECK (regrind_cost >= 0),
ADD COLUMN IF NOT EXISTS waste_credit_amount NUMERIC(18,6) DEFAULT 0 CHECK (waste_credit_amount >= 0);

-- Add comments
COMMENT ON COLUMN public.stage_costs.normal_scrap_qty IS 
  'Normal scrap quantity (within expected rate). Cost allocated to good units.';

COMMENT ON COLUMN public.stage_costs.abnormal_scrap_qty IS 
  'Abnormal scrap quantity (exceeding normal rate). Cost charged to expense account.';

COMMENT ON COLUMN public.stage_costs.normal_scrap_cost IS 
  'Cost of normal scrap allocated to good units (increases unit cost).';

COMMENT ON COLUMN public.stage_costs.abnormal_scrap_cost IS 
  'Cost of abnormal scrap charged to expense account (period cost).';

COMMENT ON COLUMN public.stage_costs.regrind_cost IS 
  'Cost of regrinding/reprocessing scrap material back into production.';

COMMENT ON COLUMN public.stage_costs.waste_credit_amount IS 
  'Credit received from selling waste/scrap material.';

-- ===================================================================
-- PART 3: Update upsert_stage_cost function with scrap accounting
-- ===================================================================

-- Drop the old function signature first to avoid ambiguity
DROP FUNCTION IF EXISTS public.upsert_stage_cost(
  UUID, UUID, INTEGER, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC
);

CREATE OR REPLACE FUNCTION public.upsert_stage_cost(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER,
  p_wc UUID,
  p_good_qty NUMERIC,
  p_dm NUMERIC DEFAULT 0,
  p_mode TEXT DEFAULT 'precosted',
  p_scrap_qty NUMERIC DEFAULT 0,
  p_rework_qty NUMERIC DEFAULT 0,
  p_input_qty NUMERIC DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  -- WIP parameters
  p_wip_end_qty NUMERIC DEFAULT 0,
  p_wip_end_dm_completion_pct NUMERIC DEFAULT 0,
  p_wip_end_cc_completion_pct NUMERIC DEFAULT 0,
  -- Scrap accounting parameters
  p_regrind_cost NUMERIC DEFAULT 0,
  p_waste_credit NUMERIC DEFAULT 0
)
RETURNS TABLE(
  stage_id UUID,
  total_cost NUMERIC,
  unit_cost NUMERIC,
  transferred_in NUMERIC,
  labor_cost NUMERIC,
  overhead_cost NUMERIC,
  eup NUMERIC,
  normal_scrap_cost NUMERIC,
  abnormal_scrap_cost NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  -- Constants
  C_SCHEMA_PUBLIC CONSTANT TEXT := 'public';
  C_COL_TENANT_ID CONSTANT TEXT := 'tenant_id';
  C_COL_ORG_ID CONSTANT TEXT := 'org_id';
  C_COL_MO_ID CONSTANT TEXT := 'mo_id';
  C_COL_MANUFACTURING_ORDER_ID CONSTANT TEXT := 'manufacturing_order_id';
  C_TABLE_WORK_CENTERS CONSTANT TEXT := 'work_centers';
  C_TABLE_STAGE_COSTS CONSTANT TEXT := 'stage_costs';
  
  v_ti NUMERIC := 0;
  v_dl NUMERIC := 0;
  v_oh NUMERIC := 0;
  v_rg NUMERIC := 0;
  v_wc NUMERIC := 0;
  v_total NUMERIC;
  v_unit NUMERIC;
  v_stage_id UUID;
  v_current_tenant UUID;
  
  -- EUP calculation variables
  v_eup_dm NUMERIC := 0;
  v_eup_cc NUMERIC := 0;
  v_eup NUMERIC := 0;
  
  -- Scrap accounting variables
  v_normal_scrap_rate NUMERIC := 0;
  v_normal_scrap_qty NUMERIC := 0;
  v_abnormal_scrap_qty NUMERIC := 0;
  v_normal_scrap_cost NUMERIC := 0;
  v_abnormal_scrap_cost NUMERIC := 0;
  v_unit_cost_before_scrap NUMERIC := 0;
  
  -- Column name detection
  v_tenant_col TEXT;
  v_mo_col TEXT;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Validate parameters
  IF p_stage <= 0 THEN
    RAISE EXCEPTION 'Stage number must be positive';
  END IF;
  
  IF p_good_qty < 0 THEN
    RAISE EXCEPTION 'Good quantity cannot be negative';
  END IF;
  
  IF p_wip_end_qty < 0 THEN
    RAISE EXCEPTION 'WIP ending quantity cannot be negative';
  END IF;
  
  IF p_wip_end_dm_completion_pct < 0 OR p_wip_end_dm_completion_pct > 100 THEN
    RAISE EXCEPTION 'WIP DM completion percentage must be between 0 and 100';
  END IF;
  
  IF p_wip_end_cc_completion_pct < 0 OR p_wip_end_cc_completion_pct > 100 THEN
    RAISE EXCEPTION 'WIP CC completion percentage must be between 0 and 100';
  END IF;
  
  IF p_scrap_qty < 0 THEN
    RAISE EXCEPTION 'Scrap quantity cannot be negative';
  END IF;
  
  IF p_regrind_cost < 0 THEN
    RAISE EXCEPTION 'Regrind cost cannot be negative';
  END IF;
  
  IF p_waste_credit < 0 THEN
    RAISE EXCEPTION 'Waste credit cannot be negative';
  END IF;

  -- Detect column names dynamically
  SELECT column_name INTO v_tenant_col
  FROM information_schema.columns
  WHERE table_schema = C_SCHEMA_PUBLIC
  AND table_name = C_TABLE_WORK_CENTERS
  AND column_name IN (C_COL_TENANT_ID, C_COL_ORG_ID)
  ORDER BY CASE column_name WHEN C_COL_TENANT_ID THEN 1 WHEN C_COL_ORG_ID THEN 2 END
  LIMIT 1;
  
  -- Get normal scrap rate from work center
  IF v_tenant_col = C_COL_TENANT_ID THEN
    SELECT COALESCE(normal_scrap_rate, 0) INTO v_normal_scrap_rate
    FROM public.work_centers
    WHERE id = p_wc AND tenant_id = p_tenant AND is_active = true;
  ELSE
    SELECT COALESCE(normal_scrap_rate, 0) INTO v_normal_scrap_rate
    FROM public.work_centers
    WHERE id = p_wc AND org_id = p_tenant AND is_active = true;
  END IF;
  
  -- Validate work center exists
  IF v_normal_scrap_rate IS NULL THEN
    RAISE EXCEPTION 'Work center not found or not active for tenant';
  END IF;

  -- Calculate input quantity if not provided
  IF p_input_qty IS NULL THEN
    p_input_qty := p_good_qty + COALESCE(p_scrap_qty, 0) + COALESCE(p_rework_qty, 0);
  END IF;

  -- Detect column names for stage_costs table
  SELECT column_name INTO v_tenant_col
  FROM information_schema.columns
  WHERE table_schema = C_SCHEMA_PUBLIC
  AND table_name = C_TABLE_STAGE_COSTS
  AND column_name IN (C_COL_TENANT_ID, C_COL_ORG_ID)
  ORDER BY CASE column_name WHEN C_COL_TENANT_ID THEN 1 WHEN C_COL_ORG_ID THEN 2 END
  LIMIT 1;
  
  SELECT column_name INTO v_mo_col
  FROM information_schema.columns
  WHERE table_schema = C_SCHEMA_PUBLIC
  AND table_name = C_TABLE_STAGE_COSTS
  AND column_name IN (C_COL_MO_ID, C_COL_MANUFACTURING_ORDER_ID)
  ORDER BY CASE column_name WHEN C_COL_MO_ID THEN 1 WHEN C_COL_MANUFACTURING_ORDER_ID THEN 2 END
  LIMIT 1;

  -- For stages > 1, get transferred-in cost from previous stage
  IF p_stage > 1 THEN
    IF v_tenant_col = C_COL_TENANT_ID AND v_mo_col = C_COL_MO_ID THEN
      SELECT COALESCE(total_cost, 0) INTO v_ti
      FROM public.stage_costs
      WHERE tenant_id = p_tenant 
        AND mo_id = p_mo 
        AND stage_no = p_stage - 1
      FOR UPDATE;
    ELSIF v_tenant_col = C_COL_ORG_ID AND v_mo_col = C_COL_MANUFACTURING_ORDER_ID THEN
      SELECT COALESCE(total_cost, 0) INTO v_ti
      FROM public.stage_costs
      WHERE org_id = p_tenant 
        AND manufacturing_order_id = p_mo 
        AND stage_number = p_stage - 1
      FOR UPDATE;
    ELSE
      BEGIN
        SELECT COALESCE(total_cost, 0) INTO v_ti
        FROM public.stage_costs
        WHERE (tenant_id = p_tenant OR org_id = p_tenant)
          AND (mo_id = p_mo OR manufacturing_order_id = p_mo)
          AND (stage_no = p_stage - 1 OR stage_number = p_stage - 1)
        LIMIT 1
        FOR UPDATE;
      EXCEPTION WHEN OTHERS THEN
        RAISE EXCEPTION 'Previous stage (%) not found or not completed', p_stage - 1;
      END;
    END IF;
    
    IF v_ti IS NULL THEN
      RAISE EXCEPTION 'Previous stage (%) not found or not completed', p_stage - 1;
    END IF;
  END IF;

  -- Calculate labor cost from labor time logs
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = C_SCHEMA_PUBLIC 
    AND table_name = 'labor_time_logs' 
    AND column_name = C_COL_TENANT_ID
  ) THEN
    SELECT COALESCE(SUM(hours * hourly_rate), 0) INTO v_dl
    FROM public.labor_time_logs
    WHERE tenant_id = p_tenant 
      AND mo_id = p_mo 
      AND stage_no = p_stage
      AND status = 'active';
  ELSE
    SELECT COALESCE(SUM(hours * hourly_rate), 0) INTO v_dl
    FROM public.labor_time_logs
    WHERE org_id = p_tenant 
      AND manufacturing_order_id = p_mo 
      AND stage_number = p_stage
      AND status = 'active';
  END IF;

  -- Calculate overhead cost from applied overhead
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = C_SCHEMA_PUBLIC 
    AND table_name = 'moh_applied' 
    AND column_name = C_COL_TENANT_ID
  ) THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_oh
    FROM public.moh_applied
    WHERE tenant_id = p_tenant 
      AND mo_id = p_mo 
      AND stage_no = p_stage
      AND status = 'applied';
  ELSE
    SELECT COALESCE(SUM(amount), 0) INTO v_oh
    FROM public.moh_applied
    WHERE org_id = p_tenant 
      AND manufacturing_order_id = p_mo 
      AND stage_number = p_stage
      AND status = 'applied';
  END IF;

  -- Calculate regrind/reprocessing cost (from parameter)
  v_rg := COALESCE(p_regrind_cost, 0);

  -- Calculate waste credit (from parameter)
  v_wc := COALESCE(p_waste_credit, 0);

  -- ===================================================================
  -- SCRAP ACCOUNTING LOGIC
  -- ===================================================================
  
  -- Calculate normal vs abnormal scrap
  IF p_good_qty > 0 AND v_normal_scrap_rate > 0 THEN
    -- Normal scrap = good_qty * normal_scrap_rate / 100
    v_normal_scrap_qty := LEAST(
      p_good_qty * v_normal_scrap_rate / 100,
      COALESCE(p_scrap_qty, 0)
    );
    
    -- Abnormal scrap = total scrap - normal scrap
    v_abnormal_scrap_qty := GREATEST(
      0,
      COALESCE(p_scrap_qty, 0) - v_normal_scrap_qty
    );
  ELSE
    -- If no normal scrap rate or no good units, all scrap is abnormal
    v_normal_scrap_qty := 0;
    v_abnormal_scrap_qty := COALESCE(p_scrap_qty, 0);
  END IF;

  -- Calculate base costs (before scrap allocation)
  -- Total Cost = Transferred In + Direct Materials + Direct Labor + MOH + Regrind - Waste Credit
  v_total := v_ti + p_dm + v_dl + v_oh + v_rg - v_wc;

  -- ===================================================================
  -- EUP CALCULATION (Weighted-Average Method)
  -- ===================================================================
  
  IF p_stage = 1 THEN
    v_eup_dm := p_good_qty + (COALESCE(p_wip_end_qty, 0) * COALESCE(p_wip_end_dm_completion_pct, 0) / 100);
  ELSE
    v_eup_dm := p_good_qty;
  END IF;
  
  v_eup_cc := p_good_qty + (COALESCE(p_wip_end_qty, 0) * COALESCE(p_wip_end_cc_completion_pct, 0) / 100);
  v_eup := v_eup_cc;

  -- Calculate unit cost before scrap allocation
  IF v_eup > 0 THEN
    v_unit_cost_before_scrap := v_total / v_eup;
  ELSIF p_good_qty > 0 THEN
    v_unit_cost_before_scrap := v_total / p_good_qty;
  ELSE
    v_unit_cost_before_scrap := 0;
  END IF;

  -- ===================================================================
  -- SCRAP COST ALLOCATION
  -- ===================================================================
  
  -- Normal scrap cost: allocated to good units (increases unit cost)
  IF v_normal_scrap_qty > 0 AND v_unit_cost_before_scrap > 0 THEN
    v_normal_scrap_cost := v_normal_scrap_qty * v_unit_cost_before_scrap;
    -- Add normal scrap cost to total cost (will be allocated to good units)
    v_total := v_total + v_normal_scrap_cost;
  END IF;
  
  -- Abnormal scrap cost: charged to expense (period cost, not included in unit cost)
  IF v_abnormal_scrap_qty > 0 AND v_unit_cost_before_scrap > 0 THEN
    v_abnormal_scrap_cost := v_abnormal_scrap_qty * v_unit_cost_before_scrap;
    -- Abnormal scrap cost is NOT added to total_cost (charged separately to expense)
  END IF;

  -- Calculate final unit cost (includes normal scrap cost)
  IF v_eup > 0 THEN
    v_unit := v_total / v_eup;
  ELSIF p_good_qty > 0 THEN
    v_unit := v_total / p_good_qty;
  ELSE
    v_unit := 0;
  END IF;

  -- Upsert stage cost record with scrap accounting fields
  IF v_tenant_col = C_COL_TENANT_ID AND v_mo_col = C_COL_MO_ID THEN
    INSERT INTO public.stage_costs (
      tenant_id, mo_id, stage_no, wc_id,
      input_qty, good_qty, scrap_qty, rework_qty,
      transferred_in, dm_cost, dl_cost, moh_cost, regrind_proc_cost, waste_credit,
      total_cost, unit_cost, mode, notes,
      wip_end_qty, wip_end_dm_completion_pct, wip_end_cc_completion_pct,
      normal_scrap_qty, abnormal_scrap_qty, normal_scrap_cost, abnormal_scrap_cost,
      regrind_cost, waste_credit_amount,
      created_by, updated_by
    ) VALUES (
      p_tenant, p_mo, p_stage, p_wc,
      p_input_qty, p_good_qty, COALESCE(p_scrap_qty, 0), COALESCE(p_rework_qty, 0),
      v_ti, p_dm, v_dl, v_oh, v_rg, v_wc,
      v_total, v_unit, p_mode, p_notes,
      COALESCE(p_wip_end_qty, 0), COALESCE(p_wip_end_dm_completion_pct, 0), COALESCE(p_wip_end_cc_completion_pct, 0),
      v_normal_scrap_qty, v_abnormal_scrap_qty, v_normal_scrap_cost, v_abnormal_scrap_cost,
      v_rg, v_wc,
      get_current_user_id(), get_current_user_id()
    )
    ON CONFLICT (tenant_id, mo_id, stage_no) DO UPDATE SET
      wc_id = EXCLUDED.wc_id,
      input_qty = EXCLUDED.input_qty,
      good_qty = EXCLUDED.good_qty,
      scrap_qty = EXCLUDED.scrap_qty,
      rework_qty = EXCLUDED.rework_qty,
      transferred_in = EXCLUDED.transferred_in,
      dm_cost = EXCLUDED.dm_cost,
      dl_cost = EXCLUDED.dl_cost,
      moh_cost = EXCLUDED.moh_cost,
      regrind_proc_cost = EXCLUDED.regrind_proc_cost,
      waste_credit = EXCLUDED.waste_credit,
      total_cost = EXCLUDED.total_cost,
      unit_cost = EXCLUDED.unit_cost,
      mode = EXCLUDED.mode,
      notes = EXCLUDED.notes,
      wip_end_qty = EXCLUDED.wip_end_qty,
      wip_end_dm_completion_pct = EXCLUDED.wip_end_dm_completion_pct,
      wip_end_cc_completion_pct = EXCLUDED.wip_end_cc_completion_pct,
      normal_scrap_qty = EXCLUDED.normal_scrap_qty,
      abnormal_scrap_qty = EXCLUDED.abnormal_scrap_qty,
      normal_scrap_cost = EXCLUDED.normal_scrap_cost,
      abnormal_scrap_cost = EXCLUDED.abnormal_scrap_cost,
      regrind_cost = EXCLUDED.regrind_cost,
      waste_credit_amount = EXCLUDED.waste_credit_amount,
      updated_at = now(),
      updated_by = get_current_user_id()
    RETURNING id INTO v_stage_id;
  ELSE
    -- Use org_id and manufacturing_order_id (similar structure)
    INSERT INTO public.stage_costs (
      org_id, manufacturing_order_id, stage_number, work_center_id,
      input_qty, good_qty, scrap_qty, rework_qty,
      transferred_in, dm_cost, dl_cost, moh_cost, regrind_proc_cost, waste_credit,
      total_cost, unit_cost, mode, notes,
      wip_end_qty, wip_end_dm_completion_pct, wip_end_cc_completion_pct,
      normal_scrap_qty, abnormal_scrap_qty, normal_scrap_cost, abnormal_scrap_cost,
      regrind_cost, waste_credit_amount,
      created_by, updated_by
    ) VALUES (
      p_tenant, p_mo, p_stage, p_wc,
      p_input_qty, p_good_qty, COALESCE(p_scrap_qty, 0), COALESCE(p_rework_qty, 0),
      v_ti, p_dm, v_dl, v_oh, v_rg, v_wc,
      v_total, v_unit, p_mode, p_notes,
      COALESCE(p_wip_end_qty, 0), COALESCE(p_wip_end_dm_completion_pct, 0), COALESCE(p_wip_end_cc_completion_pct, 0),
      v_normal_scrap_qty, v_abnormal_scrap_qty, v_normal_scrap_cost, v_abnormal_scrap_cost,
      v_rg, v_wc,
      get_current_user_id(), get_current_user_id()
    )
    ON CONFLICT (org_id, manufacturing_order_id, stage_number) DO UPDATE SET
      work_center_id = EXCLUDED.work_center_id,
      input_qty = EXCLUDED.input_qty,
      good_qty = EXCLUDED.good_qty,
      scrap_qty = EXCLUDED.scrap_qty,
      rework_qty = EXCLUDED.rework_qty,
      transferred_in = EXCLUDED.transferred_in,
      dm_cost = EXCLUDED.dm_cost,
      dl_cost = EXCLUDED.dl_cost,
      moh_cost = EXCLUDED.moh_cost,
      regrind_proc_cost = EXCLUDED.regrind_proc_cost,
      waste_credit = EXCLUDED.waste_credit,
      total_cost = EXCLUDED.total_cost,
      unit_cost = EXCLUDED.unit_cost,
      mode = EXCLUDED.mode,
      notes = EXCLUDED.notes,
      wip_end_qty = EXCLUDED.wip_end_qty,
      wip_end_dm_completion_pct = EXCLUDED.wip_end_dm_completion_pct,
      wip_end_cc_completion_pct = EXCLUDED.wip_end_cc_completion_pct,
      normal_scrap_qty = EXCLUDED.normal_scrap_qty,
      abnormal_scrap_qty = EXCLUDED.abnormal_scrap_qty,
      normal_scrap_cost = EXCLUDED.normal_scrap_cost,
      abnormal_scrap_cost = EXCLUDED.abnormal_scrap_cost,
      regrind_cost = EXCLUDED.regrind_cost,
      waste_credit_amount = EXCLUDED.waste_credit_amount,
      updated_at = now(),
      updated_by = get_current_user_id()
    RETURNING id INTO v_stage_id;
  END IF;

  -- Update manufacturing order current stage
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'manufacturing_orders' 
    AND column_name = C_COL_TENANT_ID
  ) THEN
    UPDATE public.manufacturing_orders 
    SET current_stage = GREATEST(COALESCE(current_stage, 1), p_stage),
        updated_at = now()
    WHERE id = p_mo 
      AND tenant_id = p_tenant;
  ELSE
    UPDATE public.manufacturing_orders 
    SET current_stage = GREATEST(COALESCE(current_stage, 1), p_stage),
        updated_at = now()
    WHERE id = p_mo 
      AND org_id = p_tenant;
  END IF;

  -- Return results including scrap costs
  RETURN QUERY
  SELECT v_stage_id, v_total, v_unit, v_ti, v_dl, v_oh, v_eup, v_normal_scrap_cost, v_abnormal_scrap_cost;
END $$;

-- ===================================================================
-- Update function comment
-- ===================================================================
COMMENT ON FUNCTION public.upsert_stage_cost IS 
  'Core process costing function with EUP and Scrap Accounting support. Calculates unit cost using Weighted-Average EUP method. Implements normal vs abnormal scrap accounting: normal scrap cost allocated to good units (increases unit cost), abnormal scrap cost charged to expense account (period cost). Formula: EUP = good_qty + (wip_end_qty × wip_end_cc_completion_pct / 100). Unit Cost = (total_cost + normal_scrap_cost) / EUP. Abnormal scrap cost excluded from unit cost calculation.';

-- ===================================================================
-- Migration Notes:
-- ===================================================================
-- This migration implements Scrap Accounting with Normal vs Abnormal
-- scrap distinction for accurate cost allocation.
--
-- Changes:
-- 1. Added normal_scrap_rate to work_centers table
-- 2. Added scrap accounting fields to stage_costs table
-- 3. Implemented normal vs abnormal scrap calculation
-- 4. Normal scrap cost allocated to good units (increases unit cost)
-- 5. Abnormal scrap cost charged to expense (period cost)
-- 6. Regrind cost and waste credit parameters added
-- 7. Returns normal_scrap_cost and abnormal_scrap_cost in result set
--
-- Scrap Accounting Logic:
-- - normal_scrap_qty = MIN(good_qty * normal_scrap_rate / 100, scrap_qty)
-- - abnormal_scrap_qty = scrap_qty - normal_scrap_qty
-- - normal_scrap_cost = normal_scrap_qty * unit_cost_before_scrap
-- - abnormal_scrap_cost = abnormal_scrap_qty * unit_cost_before_scrap
-- - Total cost includes normal_scrap_cost (allocated to good units)
-- - Abnormal scrap cost excluded from total_cost (charged separately)
--
-- Backward Compatibility:
-- - All new parameters have default values of 0
-- - If normal_scrap_rate = 0, all scrap is treated as abnormal
-- - Existing code continues to work without changes
--
-- Risk: 🟡 Medium - Adds new calculation logic but maintains backward compatibility
-- Testing: Run process-costing-rpc.test.ts to verify scrap accounting calculations
-- ===================================================================

