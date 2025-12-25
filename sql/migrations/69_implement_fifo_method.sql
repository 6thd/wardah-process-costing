-- ===================================================================
-- Migration: Implement FIFO Method for Process Costing
-- Date: 2025-12-25
-- Purpose: Add FIFO costing method support alongside Weighted-Average
-- Risk Level: 🟡 Medium (adds new calculation logic, but backward compatible)
-- ===================================================================

-- ===================================================================
-- PART 1: Add costing_method to manufacturing_orders table
-- ===================================================================

-- Add costing_method column to manufacturing_orders
-- Note: Cannot use constants in DEFAULT expression, must use literals directly
ALTER TABLE public.manufacturing_orders
ADD COLUMN IF NOT EXISTS costing_method TEXT DEFAULT 'weighted_average' -- NOSONAR: PostgreSQL requires literals in DEFAULT
CHECK (costing_method IN ('weighted_average', 'fifo')); -- NOSONAR: PostgreSQL requires literals in CHECK

-- Add comment
COMMENT ON COLUMN public.manufacturing_orders.costing_method IS 
  'Costing method for this manufacturing order: weighted_average (combines beginning WIP + current costs) or fifo (separates beginning WIP from current period costs).';

-- ===================================================================
-- PART 2: Add beginning WIP cost fields to stage_costs table
-- ===================================================================

-- Add beginning WIP cost fields (for FIFO method)
ALTER TABLE public.stage_costs
ADD COLUMN IF NOT EXISTS wip_beginning_cost NUMERIC(18,6) DEFAULT 0 CHECK (wip_beginning_cost >= 0),
ADD COLUMN IF NOT EXISTS current_period_cost NUMERIC(18,6) DEFAULT 0 CHECK (current_period_cost >= 0);

-- Add comments
COMMENT ON COLUMN public.stage_costs.wip_beginning_cost IS 
  'Beginning WIP cost (for FIFO method). Separated from current period costs.';

COMMENT ON COLUMN public.stage_costs.current_period_cost IS 
  'Current period cost (for FIFO method). Excludes beginning WIP cost.';

-- ===================================================================
-- PART 3: Update upsert_stage_cost function with FIFO support
-- ===================================================================

-- Drop the old function signature first to avoid ambiguity
DROP FUNCTION IF EXISTS public.upsert_stage_cost(
  UUID, UUID, INTEGER, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC
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
  p_waste_credit NUMERIC DEFAULT 0,
  -- Beginning WIP parameters (for FIFO method)
  p_wip_beginning_qty NUMERIC DEFAULT 0,
  p_wip_beginning_dm_completion_pct NUMERIC DEFAULT 0,
  p_wip_beginning_cc_completion_pct NUMERIC DEFAULT 0,
  p_wip_beginning_cost NUMERIC DEFAULT 0
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
  abnormal_scrap_cost NUMERIC,
  costing_method TEXT,
  wip_beginning_cost NUMERIC,
  current_period_cost NUMERIC
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
  C_TABLE_MANUFACTURING_ORDERS CONSTANT TEXT := 'manufacturing_orders';
  C_METHOD_WEIGHTED_AVG CONSTANT TEXT := 'weighted_average';
  C_METHOD_FIFO CONSTANT TEXT := 'fifo';
  
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
  
  -- FIFO variables
  v_costing_method TEXT := C_METHOD_WEIGHTED_AVG;
  v_wip_beginning_cost NUMERIC := 0;
  v_current_period_cost NUMERIC := 0;
  v_wip_beginning_eup_dm NUMERIC := 0;
  v_wip_beginning_eup_cc NUMERIC := 0;
  
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
  
  IF p_wip_beginning_qty < 0 THEN
    RAISE EXCEPTION 'WIP beginning quantity cannot be negative';
  END IF;
  
  IF p_wip_end_dm_completion_pct < 0 OR p_wip_end_dm_completion_pct > 100 THEN
    RAISE EXCEPTION 'WIP DM completion percentage must be between 0 and 100';
  END IF;
  
  IF p_wip_end_cc_completion_pct < 0 OR p_wip_end_cc_completion_pct > 100 THEN
    RAISE EXCEPTION 'WIP CC completion percentage must be between 0 and 100';
  END IF;
  
  IF p_wip_beginning_dm_completion_pct < 0 OR p_wip_beginning_dm_completion_pct > 100 THEN
    RAISE EXCEPTION 'WIP beginning DM completion percentage must be between 0 and 100';
  END IF;
  
  IF p_wip_beginning_cc_completion_pct < 0 OR p_wip_beginning_cc_completion_pct > 100 THEN
    RAISE EXCEPTION 'WIP beginning CC completion percentage must be between 0 and 100';
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
  
  IF p_wip_beginning_cost < 0 THEN
    RAISE EXCEPTION 'WIP beginning cost cannot be negative';
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

  -- Get costing method from manufacturing order
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = C_SCHEMA_PUBLIC
    AND table_name = C_TABLE_MANUFACTURING_ORDERS 
    AND column_name = 'costing_method'
  ) THEN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_schema = C_SCHEMA_PUBLIC
      AND table_name = C_TABLE_MANUFACTURING_ORDERS 
      AND column_name = C_COL_TENANT_ID
    ) THEN
      SELECT COALESCE(costing_method, C_METHOD_WEIGHTED_AVG) INTO v_costing_method
      FROM public.manufacturing_orders
      WHERE id = p_mo AND tenant_id = p_tenant;
    ELSE
      SELECT COALESCE(costing_method, C_METHOD_WEIGHTED_AVG) INTO v_costing_method
      FROM public.manufacturing_orders
      WHERE id = p_mo AND org_id = p_tenant;
    END IF;
  END IF;
  
  -- Validate costing method
  IF v_costing_method NOT IN (C_METHOD_WEIGHTED_AVG, C_METHOD_FIFO) THEN
    v_costing_method := C_METHOD_WEIGHTED_AVG;
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
    v_normal_scrap_qty := LEAST(
      p_good_qty * v_normal_scrap_rate / 100,
      COALESCE(p_scrap_qty, 0)
    );
    v_abnormal_scrap_qty := GREATEST(
      0,
      COALESCE(p_scrap_qty, 0) - v_normal_scrap_qty
    );
  ELSE
    v_normal_scrap_qty := 0;
    v_abnormal_scrap_qty := COALESCE(p_scrap_qty, 0);
  END IF;

  -- Calculate base costs (before scrap allocation)
  -- Total Cost = Transferred In + Direct Materials + Direct Labor + MOH + Regrind - Waste Credit
  v_total := v_ti + p_dm + v_dl + v_oh + v_rg - v_wc;

  -- ===================================================================
  -- EUP CALCULATION (Weighted-Average vs FIFO)
  -- ===================================================================
  
  IF v_costing_method = C_METHOD_FIFO THEN
    -- FIFO Method: Separate beginning WIP from current period
    
    -- Beginning WIP EUP (to be subtracted)
    IF p_stage = 1 THEN
      v_wip_beginning_eup_dm := COALESCE(p_wip_beginning_qty, 0) * COALESCE(p_wip_beginning_dm_completion_pct, 0) / 100;
    ELSE
      v_wip_beginning_eup_dm := 0; -- Stages > 1: DM already in transferred-in
    END IF;
    v_wip_beginning_eup_cc := COALESCE(p_wip_beginning_qty, 0) * COALESCE(p_wip_beginning_cc_completion_pct, 0) / 100;
    
    -- FIFO EUP = Units Completed + Ending WIP - Beginning WIP
    IF p_stage = 1 THEN
      v_eup_dm := p_good_qty + (COALESCE(p_wip_end_qty, 0) * COALESCE(p_wip_end_dm_completion_pct, 0) / 100) - v_wip_beginning_eup_dm;
    ELSE
      v_eup_dm := p_good_qty; -- Stages > 1: DM already in transferred-in
    END IF;
    v_eup_cc := p_good_qty + (COALESCE(p_wip_end_qty, 0) * COALESCE(p_wip_end_cc_completion_pct, 0) / 100) - v_wip_beginning_eup_cc;
    
    -- Use Conversion Costs EUP as primary
    v_eup := v_eup_cc;
    
    -- Separate beginning WIP cost from current period cost
    v_wip_beginning_cost := COALESCE(p_wip_beginning_cost, 0);
    v_current_period_cost := v_total; -- Current period costs only
    
    -- Calculate unit cost using current period costs only
    IF v_eup > 0 THEN
      v_unit_cost_before_scrap := v_current_period_cost / v_eup;
    ELSIF p_good_qty > 0 THEN
      v_unit_cost_before_scrap := v_current_period_cost / p_good_qty;
    ELSE
      v_unit_cost_before_scrap := 0;
    END IF;
    
  ELSE
    -- Weighted-Average Method: Combine beginning WIP + current costs
    
    -- Beginning WIP cost is included in total_cost (via transferred-in or parameter)
    IF p_stage = 1 AND COALESCE(p_wip_beginning_cost, 0) > 0 THEN
      -- Add beginning WIP cost to total for weighted-average
      v_total := v_total + COALESCE(p_wip_beginning_cost, 0);
    END IF;
    
    -- Weighted-Average EUP = Units Completed + Ending WIP
    IF p_stage = 1 THEN
      v_eup_dm := p_good_qty + (COALESCE(p_wip_end_qty, 0) * COALESCE(p_wip_end_dm_completion_pct, 0) / 100);
    ELSE
      v_eup_dm := p_good_qty;
    END IF;
    v_eup_cc := p_good_qty + (COALESCE(p_wip_end_qty, 0) * COALESCE(p_wip_end_cc_completion_pct, 0) / 100);
    v_eup := v_eup_cc;
    
    -- Beginning WIP cost is part of total_cost in weighted-average
    v_wip_beginning_cost := COALESCE(p_wip_beginning_cost, 0);
    v_current_period_cost := v_total - v_wip_beginning_cost;
    
    -- Calculate unit cost using total cost (includes beginning WIP)
    IF v_eup > 0 THEN
      v_unit_cost_before_scrap := v_total / v_eup;
    ELSIF p_good_qty > 0 THEN
      v_unit_cost_before_scrap := v_total / p_good_qty;
    ELSE
      v_unit_cost_before_scrap := 0;
    END IF;
  END IF;

  -- ===================================================================
  -- SCRAP COST ALLOCATION
  -- ===================================================================
  
  -- Normal scrap cost: allocated to good units (increases unit cost)
  IF v_normal_scrap_qty > 0 AND v_unit_cost_before_scrap > 0 THEN
    v_normal_scrap_cost := v_normal_scrap_qty * v_unit_cost_before_scrap;
    v_total := v_total + v_normal_scrap_cost;
  END IF;
  
  -- Abnormal scrap cost: charged to expense (period cost, not included in unit cost)
  IF v_abnormal_scrap_qty > 0 AND v_unit_cost_before_scrap > 0 THEN
    v_abnormal_scrap_cost := v_abnormal_scrap_qty * v_unit_cost_before_scrap;
  END IF;

  -- Calculate final unit cost (includes normal scrap cost)
  IF v_eup > 0 THEN
    v_unit := v_total / v_eup;
  ELSIF p_good_qty > 0 THEN
    v_unit := v_total / p_good_qty;
  ELSE
    v_unit := 0;
  END IF;

  -- Upsert stage cost record with FIFO support
  IF v_tenant_col = C_COL_TENANT_ID AND v_mo_col = C_COL_MO_ID THEN
    INSERT INTO public.stage_costs (
      tenant_id, mo_id, stage_no, wc_id,
      input_qty, good_qty, scrap_qty, rework_qty,
      transferred_in, dm_cost, dl_cost, moh_cost, regrind_proc_cost, waste_credit,
      total_cost, unit_cost, mode, notes,
      wip_end_qty, wip_end_dm_completion_pct, wip_end_cc_completion_pct,
      wip_beginning_qty, wip_beginning_dm_completion_pct, wip_beginning_cc_completion_pct,
      normal_scrap_qty, abnormal_scrap_qty, normal_scrap_cost, abnormal_scrap_cost,
      regrind_cost, waste_credit_amount,
      wip_beginning_cost, current_period_cost,
      created_by, updated_by
    ) VALUES (
      p_tenant, p_mo, p_stage, p_wc,
      p_input_qty, p_good_qty, COALESCE(p_scrap_qty, 0), COALESCE(p_rework_qty, 0),
      v_ti, p_dm, v_dl, v_oh, v_rg, v_wc,
      v_total, v_unit, p_mode, p_notes,
      COALESCE(p_wip_end_qty, 0), COALESCE(p_wip_end_dm_completion_pct, 0), COALESCE(p_wip_end_cc_completion_pct, 0),
      COALESCE(p_wip_beginning_qty, 0), COALESCE(p_wip_beginning_dm_completion_pct, 0), COALESCE(p_wip_beginning_cc_completion_pct, 0),
      v_normal_scrap_qty, v_abnormal_scrap_qty, v_normal_scrap_cost, v_abnormal_scrap_cost,
      v_rg, v_wc,
      v_wip_beginning_cost, v_current_period_cost,
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
      wip_beginning_qty = EXCLUDED.wip_beginning_qty,
      wip_beginning_dm_completion_pct = EXCLUDED.wip_beginning_dm_completion_pct,
      wip_beginning_cc_completion_pct = EXCLUDED.wip_beginning_cc_completion_pct,
      normal_scrap_qty = EXCLUDED.normal_scrap_qty,
      abnormal_scrap_qty = EXCLUDED.abnormal_scrap_qty,
      normal_scrap_cost = EXCLUDED.normal_scrap_cost,
      abnormal_scrap_cost = EXCLUDED.abnormal_scrap_cost,
      regrind_cost = EXCLUDED.regrind_cost,
      waste_credit_amount = EXCLUDED.waste_credit_amount,
      wip_beginning_cost = EXCLUDED.wip_beginning_cost,
      current_period_cost = EXCLUDED.current_period_cost,
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
      wip_beginning_qty, wip_beginning_dm_completion_pct, wip_beginning_cc_completion_pct,
      normal_scrap_qty, abnormal_scrap_qty, normal_scrap_cost, abnormal_scrap_cost,
      regrind_cost, waste_credit_amount,
      wip_beginning_cost, current_period_cost,
      created_by, updated_by
    ) VALUES (
      p_tenant, p_mo, p_stage, p_wc,
      p_input_qty, p_good_qty, COALESCE(p_scrap_qty, 0), COALESCE(p_rework_qty, 0),
      v_ti, p_dm, v_dl, v_oh, v_rg, v_wc,
      v_total, v_unit, p_mode, p_notes,
      COALESCE(p_wip_end_qty, 0), COALESCE(p_wip_end_dm_completion_pct, 0), COALESCE(p_wip_end_cc_completion_pct, 0),
      COALESCE(p_wip_beginning_qty, 0), COALESCE(p_wip_beginning_dm_completion_pct, 0), COALESCE(p_wip_beginning_cc_completion_pct, 0),
      v_normal_scrap_qty, v_abnormal_scrap_qty, v_normal_scrap_cost, v_abnormal_scrap_cost,
      v_rg, v_wc,
      v_wip_beginning_cost, v_current_period_cost,
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
      wip_beginning_qty = EXCLUDED.wip_beginning_qty,
      wip_beginning_dm_completion_pct = EXCLUDED.wip_beginning_dm_completion_pct,
      wip_beginning_cc_completion_pct = EXCLUDED.wip_beginning_cc_completion_pct,
      normal_scrap_qty = EXCLUDED.normal_scrap_qty,
      abnormal_scrap_qty = EXCLUDED.abnormal_scrap_qty,
      normal_scrap_cost = EXCLUDED.normal_scrap_cost,
      abnormal_scrap_cost = EXCLUDED.abnormal_scrap_cost,
      regrind_cost = EXCLUDED.regrind_cost,
      waste_credit_amount = EXCLUDED.waste_credit_amount,
      wip_beginning_cost = EXCLUDED.wip_beginning_cost,
      current_period_cost = EXCLUDED.current_period_cost,
      updated_at = now(),
      updated_by = get_current_user_id()
    RETURNING id INTO v_stage_id;
  END IF;

  -- Update manufacturing order current stage
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = C_SCHEMA_PUBLIC
    AND table_name = C_TABLE_MANUFACTURING_ORDERS 
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

  -- Return results including FIFO fields
  RETURN QUERY
  SELECT v_stage_id, v_total, v_unit, v_ti, v_dl, v_oh, v_eup, v_normal_scrap_cost, v_abnormal_scrap_cost, 
         v_costing_method, v_wip_beginning_cost, v_current_period_cost;
END $$;

-- ===================================================================
-- Update function comment
-- ===================================================================
COMMENT ON FUNCTION public.upsert_stage_cost IS 
  'Core process costing function with EUP, Scrap Accounting, and FIFO method support. Supports both Weighted-Average (combines beginning WIP + current costs) and FIFO (separates beginning WIP from current period costs) methods. Calculates unit cost using Weighted-Average or FIFO EUP method. Implements normal vs abnormal scrap accounting: normal scrap cost allocated to good units (increases unit cost), abnormal scrap cost charged to expense account (period cost). Formula Weighted-Average: EUP = good_qty + (wip_end_qty × wip_end_cc_completion_pct / 100). Formula FIFO: EUP = good_qty + (wip_end_qty × wip_end_cc_completion_pct / 100) - (wip_beginning_qty × wip_beginning_cc_completion_pct / 100). Unit Cost Weighted-Average = total_cost / EUP. Unit Cost FIFO = current_period_cost / EUP.';

-- ===================================================================
-- Migration Notes:
-- ===================================================================
-- This migration implements FIFO (First-In-First-Out) costing method
-- alongside the existing Weighted-Average method for process costing.
--
-- Changes:
-- 1. Added costing_method to manufacturing_orders table
-- 2. Added wip_beginning_cost and current_period_cost fields to stage_costs
-- 3. Implemented FIFO EUP calculation (subtracts beginning WIP EUP)
-- 4. Separated beginning WIP cost from current period cost in FIFO method
-- 5. Updated unit cost calculation to use current_period_cost for FIFO
-- 6. Returns costing_method, wip_beginning_cost, and current_period_cost
--
-- FIFO Method Logic:
-- - EUP = good_qty + (wip_end_qty × wip_end_cc_completion_pct / 100) 
--         - (wip_beginning_qty × wip_beginning_cc_completion_pct / 100)
-- - Unit Cost = current_period_cost / EUP (excludes beginning WIP cost)
-- - Beginning WIP cost tracked separately
--
-- Weighted-Average Method Logic (unchanged):
-- - EUP = good_qty + (wip_end_qty × wip_end_cc_completion_pct / 100)
-- - Unit Cost = total_cost / EUP (includes beginning WIP cost)
--
-- Backward Compatibility:
-- - Default costing_method is 'weighted_average'
-- - All new parameters have default values of 0
-- - Existing code continues to work without changes
-- - If costing_method not specified, uses Weighted-Average
--
-- Risk: 🟡 Medium - Adds new calculation logic but maintains backward compatibility
-- Testing: Run process-costing-rpc.test.ts to verify FIFO calculations
-- ===================================================================

