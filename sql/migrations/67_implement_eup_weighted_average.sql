-- ===================================================================
-- Migration: Implement EUP (Equivalent Units of Production) - Weighted Average
-- Date: 2025-12-25
-- Purpose: Update upsert_stage_cost to calculate EUP and use it for unit_cost
-- Risk Level: 🟡 Medium (changes calculation logic, but backward compatible)
-- ===================================================================

-- ===================================================================
-- PART 1: Update upsert_stage_cost function with EUP support
-- ===================================================================

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
  -- New WIP parameters (optional, defaults to 0 for backward compatibility)
  p_wip_end_qty NUMERIC DEFAULT 0,
  p_wip_end_dm_completion_pct NUMERIC DEFAULT 0,
  p_wip_end_cc_completion_pct NUMERIC DEFAULT 0
)
RETURNS TABLE(
  stage_id UUID,
  total_cost NUMERIC,
  unit_cost NUMERIC,
  transferred_in NUMERIC,
  labor_cost NUMERIC,
  overhead_cost NUMERIC,
  eup NUMERIC  -- New: Return EUP value
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  -- Constants for column names and schema
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
  v_eup_dm NUMERIC := 0;  -- Equivalent Units for Direct Materials
  v_eup_cc NUMERIC := 0;  -- Equivalent Units for Conversion Costs (Labor + Overhead)
  v_eup NUMERIC := 0;      -- Final EUP (using conversion costs EUP)
  
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

  -- Detect column names dynamically
  SELECT column_name INTO v_tenant_col
  FROM information_schema.columns
  WHERE table_schema = C_SCHEMA_PUBLIC
  AND table_name = C_TABLE_WORK_CENTERS
  AND column_name IN (C_COL_TENANT_ID, C_COL_ORG_ID)
  ORDER BY CASE column_name WHEN C_COL_TENANT_ID THEN 1 WHEN C_COL_ORG_ID THEN 2 END
  LIMIT 1;
  
  -- Validate work center exists and belongs to tenant
  IF v_tenant_col = C_COL_TENANT_ID THEN
    PERFORM 1 FROM public.work_centers 
    WHERE id = p_wc AND tenant_id = p_tenant AND is_active = true;
  ELSE
    PERFORM 1 FROM public.work_centers 
    WHERE id = p_wc AND org_id = p_tenant AND is_active = true;
  END IF;
  
  IF NOT FOUND THEN
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
    ELSIF v_tenant_col = 'org_id' AND v_mo_col = 'manufacturing_order_id' THEN
      SELECT COALESCE(total_cost, 0) INTO v_ti
      FROM public.stage_costs
      WHERE org_id = p_tenant 
        AND manufacturing_order_id = p_mo 
        AND stage_number = p_stage - 1
      FOR UPDATE;
    ELSE
      -- Try both combinations
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

  -- Calculate regrind/reprocessing cost (placeholder for future implementation)
  v_rg := 0;

  -- Calculate waste credit (placeholder for future implementation)
  v_wc := 0;

  -- Apply process costing formula:
  -- Total Cost = Transferred In + Direct Materials + Direct Labor + MOH + Regrind - Waste Credit
  v_total := v_ti + p_dm + v_dl + v_oh + v_rg - v_wc;

  -- ===================================================================
  -- EUP CALCULATION (Weighted-Average Method)
  -- ===================================================================
  -- Equivalent Units = Units Completed + (WIP Ending × Completion %)
  
  -- EUP for Direct Materials
  -- Note: For stages > 1, DM is typically 0 (already included in transferred-in)
  IF p_stage = 1 THEN
    v_eup_dm := p_good_qty + (COALESCE(p_wip_end_qty, 0) * COALESCE(p_wip_end_dm_completion_pct, 0) / 100);
  ELSE
    -- Stages > 1: DM is 0, so EUP_DM = good_qty (transferred-in already includes DM)
    v_eup_dm := p_good_qty;
  END IF;
  
  -- EUP for Conversion Costs (Labor + Overhead)
  -- This is the primary EUP used for unit cost calculation
  v_eup_cc := p_good_qty + (COALESCE(p_wip_end_qty, 0) * COALESCE(p_wip_end_cc_completion_pct, 0) / 100);
  
  -- Use Conversion Costs EUP as the primary EUP
  v_eup := v_eup_cc;

  -- Calculate unit cost using EUP
  -- If EUP = 0, fallback to good_qty (backward compatibility)
  IF v_eup > 0 THEN
    v_unit := v_total / v_eup;
  ELSIF p_good_qty > 0 THEN
    -- Fallback to old method if no WIP (backward compatibility)
    v_unit := v_total / p_good_qty;
  ELSE
    v_unit := 0;
  END IF;

  -- Upsert stage cost record with WIP fields
  IF v_tenant_col = C_COL_TENANT_ID AND v_mo_col = C_COL_MO_ID THEN
    INSERT INTO public.stage_costs (
      tenant_id, mo_id, stage_no, wc_id,
      input_qty, good_qty, scrap_qty, rework_qty,
      transferred_in, dm_cost, dl_cost, moh_cost, regrind_proc_cost, waste_credit,
      total_cost, unit_cost, mode, notes,
      wip_end_qty, wip_end_dm_completion_pct, wip_end_cc_completion_pct,
      created_by, updated_by
    ) VALUES (
      p_tenant, p_mo, p_stage, p_wc,
      p_input_qty, p_good_qty, COALESCE(p_scrap_qty, 0), COALESCE(p_rework_qty, 0),
      v_ti, p_dm, v_dl, v_oh, v_rg, v_wc,
      v_total, v_unit, p_mode, p_notes,
      COALESCE(p_wip_end_qty, 0), COALESCE(p_wip_end_dm_completion_pct, 0), COALESCE(p_wip_end_cc_completion_pct, 0),
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
      updated_at = now(),
      updated_by = get_current_user_id()
    RETURNING id INTO v_stage_id;
  ELSE
    -- Use org_id and manufacturing_order_id
    INSERT INTO public.stage_costs (
      org_id, manufacturing_order_id, stage_number, work_center_id,
      input_qty, good_qty, scrap_qty, rework_qty,
      transferred_in, dm_cost, dl_cost, moh_cost, regrind_proc_cost, waste_credit,
      total_cost, unit_cost, mode, notes,
      wip_end_qty, wip_end_dm_completion_pct, wip_end_cc_completion_pct,
      created_by, updated_by
    ) VALUES (
      p_tenant, p_mo, p_stage, p_wc,
      p_input_qty, p_good_qty, COALESCE(p_scrap_qty, 0), COALESCE(p_rework_qty, 0),
      v_ti, p_dm, v_dl, v_oh, v_rg, v_wc,
      v_total, v_unit, p_mode, p_notes,
      COALESCE(p_wip_end_qty, 0), COALESCE(p_wip_end_dm_completion_pct, 0), COALESCE(p_wip_end_cc_completion_pct, 0),
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
      updated_at = now(),
      updated_by = get_current_user_id()
    RETURNING id INTO v_stage_id;
  END IF;

  -- Update manufacturing order current stage if this is furthest stage
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

  -- Return results including EUP
  RETURN QUERY
  SELECT v_stage_id, v_total, v_unit, v_ti, v_dl, v_oh, v_eup;
END $$;

-- ===================================================================
-- Update function comment
-- ===================================================================
COMMENT ON FUNCTION public.upsert_stage_cost IS 
  'Core process costing function with EUP (Equivalent Units of Production) support. Calculates unit cost using Weighted-Average EUP method. Formula: EUP = good_qty + (wip_end_qty × wip_end_cc_completion_pct / 100). Unit Cost = total_cost / EUP (or total_cost / good_qty if EUP = 0 for backward compatibility)';

-- ===================================================================
-- Migration Notes:
-- ===================================================================
-- This migration implements EUP (Equivalent Units of Production) using
-- Weighted-Average method for accurate unit cost calculation in continuous
-- manufacturing environments with WIP inventory.
--
-- Changes:
-- 1. Added WIP parameters (p_wip_end_qty, p_wip_end_dm_completion_pct, p_wip_end_cc_completion_pct)
-- 2. Calculates EUP for Direct Materials and Conversion Costs
-- 3. Uses EUP_CC (Conversion Costs EUP) for unit cost calculation
-- 4. Falls back to good_qty if EUP = 0 (backward compatibility)
-- 5. Saves WIP fields in stage_costs table
-- 6. Returns EUP value in result set
--
-- Backward Compatibility:
-- - All WIP parameters have default values of 0
-- - If WIP = 0, calculation falls back to old method (unit_cost = total_cost / good_qty)
-- - Existing code will continue to work without changes
--
-- Risk: 🟡 Medium - Changes calculation logic but maintains backward compatibility
-- Testing: Run process-costing-rpc.test.ts to verify EUP calculations
-- ===================================================================

