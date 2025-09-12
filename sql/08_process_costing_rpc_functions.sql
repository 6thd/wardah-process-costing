-- ===================================================================
-- ATOMIC RPC FUNCTIONS FOR PROCESS COSTING OPERATIONS
-- Transactional functions with complete process costing methodology
-- All functions are SECURITY DEFINER with explicit tenant validation
-- ===================================================================

-- ===================================================================
-- CORE PROCESS COSTING FUNCTION: UPSERT STAGE COST
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
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE(
  stage_id UUID,
  total_cost NUMERIC,
  unit_cost NUMERIC,
  transferred_in NUMERIC,
  labor_cost NUMERIC,
  overhead_cost NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_ti NUMERIC := 0;
  v_dl NUMERIC := 0;
  v_oh NUMERIC := 0;
  v_rg NUMERIC := 0;
  v_wc NUMERIC := 0;
  v_total NUMERIC;
  v_unit NUMERIC;
  v_stage_id UUID;
  v_current_tenant UUID;
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

  -- Validate work center exists and belongs to tenant
  PERFORM 1 FROM public.work_centers 
  WHERE id = p_wc AND tenant_id = p_tenant AND is_active = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work center not found or not active for tenant';
  END IF;

  -- Calculate input quantity if not provided
  IF p_input_qty IS NULL THEN
    p_input_qty := p_good_qty + COALESCE(p_scrap_qty, 0) + COALESCE(p_rework_qty, 0);
  END IF;

  -- For stages > 1, get transferred-in cost from previous stage
  IF p_stage > 1 THEN
    SELECT COALESCE(total_cost, 0) INTO v_ti
    FROM public.stage_costs
    WHERE tenant_id = p_tenant 
      AND mo_id = p_mo 
      AND stage_no = p_stage - 1
    FOR UPDATE; -- Lock previous stage to prevent concurrent modifications
    
    IF v_ti IS NULL THEN
      RAISE EXCEPTION 'Previous stage (%) not found or not completed', p_stage - 1;
    END IF;
  END IF;

  -- Calculate labor cost from labor time logs
  SELECT COALESCE(SUM(hours * hourly_rate), 0) INTO v_dl
  FROM public.labor_time_logs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND status = 'active';

  -- Calculate overhead cost from applied overhead
  SELECT COALESCE(SUM(amount), 0) INTO v_oh
  FROM public.moh_applied
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND status = 'applied';

  -- Calculate regrind/reprocessing cost (placeholder for future implementation)
  v_rg := 0;

  -- Calculate waste credit (placeholder for future implementation)
  v_wc := 0;

  -- Apply process costing formula:
  -- Total Cost = Transferred In + Direct Materials + Direct Labor + MOH + Regrind - Waste Credit
  v_total := v_ti + p_dm + v_dl + v_oh + v_rg - v_wc;

  -- Calculate unit cost
  v_unit := CASE 
    WHEN p_good_qty > 0 THEN v_total / p_good_qty 
    ELSE 0 
  END;

  -- Upsert stage cost record
  INSERT INTO public.stage_costs (
    tenant_id, mo_id, stage_no, wc_id,
    input_qty, good_qty, scrap_qty, rework_qty,
    transferred_in, dm_cost, dl_cost, moh_cost, regrind_proc_cost, waste_credit,
    total_cost, unit_cost, mode, notes,
    created_by, updated_by
  ) VALUES (
    p_tenant, p_mo, p_stage, p_wc,
    p_input_qty, p_good_qty, COALESCE(p_scrap_qty, 0), COALESCE(p_rework_qty, 0),
    v_ti, p_dm, v_dl, v_oh, v_rg, v_wc,
    v_total, v_unit, p_mode, p_notes,
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
    updated_at = now(),
    updated_by = get_current_user_id()
  RETURNING id INTO v_stage_id;

  -- Update manufacturing order current stage if this is furthest stage
  UPDATE public.manufacturing_orders 
  SET current_stage = GREATEST(COALESCE(current_stage, 1), p_stage),
      updated_at = now()
  WHERE id = p_mo 
    AND (NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'tenant_id')
         OR tenant_id = p_tenant);

  -- Return results
  RETURN QUERY
  SELECT v_stage_id, v_total, v_unit, v_ti, v_dl, v_oh;
END $$;

-- ===================================================================
-- LABOR TIME LOGGING FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION public.apply_labor_time(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER,
  p_wc UUID,
  p_hours NUMERIC,
  p_hourly_rate NUMERIC,
  p_employee_id UUID DEFAULT NULL,
  p_employee_name TEXT DEFAULT NULL,
  p_operation_code TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_log_id UUID;
  v_current_tenant UUID;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Validate parameters
  IF p_hours <= 0 THEN
    RAISE EXCEPTION 'Hours must be positive';
  END IF;
  
  IF p_hourly_rate < 0 THEN
    RAISE EXCEPTION 'Hourly rate cannot be negative';
  END IF;

  -- Validate work center
  PERFORM 1 FROM public.work_centers 
  WHERE id = p_wc AND tenant_id = p_tenant AND is_active = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work center not found or not active';
  END IF;

  -- Insert labor time log
  INSERT INTO public.labor_time_logs (
    tenant_id, mo_id, stage_no, wc_id,
    employee_id, employee_name, hours, hourly_rate,
    operation_code, notes, created_by
  ) VALUES (
    p_tenant, p_mo, p_stage, p_wc,
    p_employee_id, p_employee_name, p_hours, p_hourly_rate,
    p_operation_code, p_notes, get_current_user_id()
  )
  RETURNING id INTO v_log_id;

  -- Log audit event
  INSERT INTO public.audit_trail (
    tenant_id, event_type, table_name, record_id,
    operation, user_id
  ) VALUES (
    p_tenant, 'PROCESS', 'labor_time_logs', v_log_id,
    'apply_labor_time', get_current_user_id()
  );

  RETURN v_log_id;
END $$;

-- ===================================================================
-- OVERHEAD APPLICATION FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION public.apply_overhead(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER,
  p_wc UUID,
  p_allocation_base TEXT,
  p_base_qty NUMERIC,
  p_overhead_rate NUMERIC,
  p_overhead_type TEXT DEFAULT 'variable',
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_moh_id UUID;
  v_current_tenant UUID;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Validate parameters
  IF p_base_qty < 0 THEN
    RAISE EXCEPTION 'Base quantity cannot be negative';
  END IF;
  
  IF p_overhead_rate < 0 THEN
    RAISE EXCEPTION 'Overhead rate cannot be negative';
  END IF;

  IF p_allocation_base NOT IN ('labor_hours', 'machine_hours', 'labor_cost', 'material_cost', 'units') THEN
    RAISE EXCEPTION 'Invalid allocation base: %', p_allocation_base;
  END IF;

  -- Validate work center
  PERFORM 1 FROM public.work_centers 
  WHERE id = p_wc AND tenant_id = p_tenant AND is_active = true;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Work center not found or not active';
  END IF;

  -- Insert overhead application
  INSERT INTO public.moh_applied (
    tenant_id, mo_id, stage_no, wc_id,
    allocation_base, base_qty, overhead_rate, overhead_type,
    notes, created_by
  ) VALUES (
    p_tenant, p_mo, p_stage, p_wc,
    p_allocation_base, p_base_qty, p_overhead_rate, p_overhead_type,
    p_notes, get_current_user_id()
  )
  RETURNING id INTO v_moh_id;

  -- Log audit event
  INSERT INTO public.audit_trail (
    tenant_id, event_type, table_name, record_id,
    operation, user_id
  ) VALUES (
    p_tenant, 'PROCESS', 'moh_applied', v_moh_id,
    'apply_overhead', get_current_user_id()
  );

  RETURN v_moh_id;
END $$;

-- ===================================================================
-- BOM CONSUMPTION FUNCTION (WITH AVCO INVENTORY IMPACT)
-- ===================================================================
CREATE OR REPLACE FUNCTION public.consume_bom_materials(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER,
  p_consumption_qty NUMERIC,
  p_bom_id UUID DEFAULT NULL
)
RETURNS TABLE(
  consumed_item_id UUID,
  consumed_qty NUMERIC,
  unit_cost NUMERIC,
  total_cost NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
  v_item_id UUID;
  v_bom_record RECORD;
  v_item_record RECORD;
  v_required_qty NUMERIC;
  v_avco_cost NUMERIC;
  v_total_material_cost NUMERIC := 0;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Get item_id from manufacturing order
  SELECT item_id INTO v_item_id
  FROM public.manufacturing_orders 
  WHERE id = p_mo 
    AND (NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'tenant_id')
         OR tenant_id = p_tenant);
         
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manufacturing order not found';
  END IF;

  -- Get BOM if not provided
  IF p_bom_id IS NULL THEN
    SELECT id INTO p_bom_id
    FROM public.boms
    WHERE tenant_id = p_tenant 
      AND parent_item_id = v_item_id 
      AND is_active = true
      AND status = 'approved'
    ORDER BY effective_date DESC
    LIMIT 1;
    
    IF NOT FOUND THEN
      RAISE EXCEPTION 'No active BOM found for item';
    END IF;
  END IF;

  -- Process each BOM line for the specified stage
  FOR v_bom_record IN
    SELECT bl.component_item_id, bl.quantity, bl.scrap_factor
    FROM public.bom_lines bl
    JOIN public.boms b ON b.id = bl.bom_id
    WHERE bl.bom_id = p_bom_id 
      AND bl.stage_no = p_stage
      AND bl.tenant_id = p_tenant
      AND bl.usage_type = 'consumed'
  LOOP
    -- Calculate required quantity with scrap factor
    v_required_qty := v_bom_record.quantity * p_consumption_qty * 
                      (1 + COALESCE(v_bom_record.scrap_factor, 0) / 100);

    -- Get current item stock and cost (AVCO)
    SELECT stock_quantity, cost_price INTO v_item_record
    FROM public.items
    WHERE id = v_bom_record.component_item_id
      AND (NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'items' AND column_name = 'tenant_id')
           OR tenant_id = p_tenant)
    FOR UPDATE; -- Lock for inventory update

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Component item % not found', v_bom_record.component_item_id;
    END IF;

    -- Check sufficient stock
    IF v_item_record.stock_quantity < v_required_qty THEN
      RAISE EXCEPTION 'Insufficient stock for item %. Available: %, Required: %', 
        v_bom_record.component_item_id, v_item_record.stock_quantity, v_required_qty;
    END IF;

    -- Use current AVCO cost
    v_avco_cost := v_item_record.cost_price;

    -- Update item stock
    UPDATE public.items
    SET stock_quantity = stock_quantity - v_required_qty,
        updated_at = now()
    WHERE id = v_bom_record.component_item_id;

    -- Record inventory ledger transaction
    INSERT INTO public.inventory_ledger (
      tenant_id, item_id, move_type, ref_type, ref_id,
      qty_out, unit_cost, total_cost,
      running_balance, running_value, avg_unit_cost,
      moved_at, created_by
    ) VALUES (
      p_tenant, v_bom_record.component_item_id, 'MO_CONS', 'MO', p_mo,
      v_required_qty, v_avco_cost, v_required_qty * v_avco_cost,
      v_item_record.stock_quantity - v_required_qty,
      (v_item_record.stock_quantity - v_required_qty) * v_avco_cost,
      v_avco_cost,
      now(), get_current_user_id()
    );

    -- Return consumption details
    RETURN QUERY
    SELECT v_bom_record.component_item_id, v_required_qty, v_avco_cost, v_required_qty * v_avco_cost;

    v_total_material_cost := v_total_material_cost + (v_required_qty * v_avco_cost);
  END LOOP;

  -- Log audit event
  INSERT INTO public.audit_trail (
    tenant_id, event_type, table_name, record_id,
    operation, new_values, user_id
  ) VALUES (
    p_tenant, 'PROCESS', 'manufacturing_orders', p_mo,
    'consume_bom_materials', 
    jsonb_build_object('stage', p_stage, 'consumption_qty', p_consumption_qty, 'total_cost', v_total_material_cost),
    get_current_user_id()
  );
END $$;

-- ===================================================================
-- MANUFACTURING ORDER COMPLETION FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION public.finish_manufacturing_order(
  p_tenant UUID,
  p_mo UUID,
  p_completed_qty NUMERIC
)
RETURNS TABLE(
  mo_id UUID,
  final_unit_cost NUMERIC,
  total_production_cost NUMERIC,
  inventory_value_added NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
  v_mo_record RECORD;
  v_final_stage_cost RECORD;
  v_new_avco_cost NUMERIC;
  v_current_stock NUMERIC;
  v_current_value NUMERIC;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Validate completion quantity
  IF p_completed_qty <= 0 THEN
    RAISE EXCEPTION 'Completed quantity must be positive';
  END IF;

  -- Get manufacturing order details
  SELECT mo.*, i.stock_quantity, i.cost_price
  INTO v_mo_record
  FROM public.manufacturing_orders mo
  LEFT JOIN public.items i ON i.id = mo.item_id
  WHERE mo.id = p_mo
    AND (NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name = 'manufacturing_orders' AND column_name = 'tenant_id')
         OR mo.tenant_id = p_tenant)
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manufacturing order not found';
  END IF;

  IF v_mo_record.status = 'completed' THEN
    RAISE EXCEPTION 'Manufacturing order already completed';
  END IF;

  -- Get final stage cost (highest stage number)
  SELECT * INTO v_final_stage_cost
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo
  ORDER BY stage_no DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No stage costs found for manufacturing order';
  END IF;

  -- Calculate new AVCO cost for the item
  v_current_stock := COALESCE(v_mo_record.stock_quantity, 0);
  v_current_value := v_current_stock * COALESCE(v_mo_record.cost_price, 0);
  
  -- New AVCO = (Current Value + Production Value) / (Current Stock + New Production)
  IF (v_current_stock + p_completed_qty) > 0 THEN
    v_new_avco_cost := (v_current_value + (p_completed_qty * v_final_stage_cost.unit_cost)) / 
                       (v_current_stock + p_completed_qty);
  ELSE
    v_new_avco_cost := v_final_stage_cost.unit_cost;
  END IF;

  -- Update item stock and cost
  UPDATE public.items
  SET stock_quantity = stock_quantity + p_completed_qty,
      cost_price = v_new_avco_cost,
      updated_at = now()
  WHERE id = v_mo_record.item_id;

  -- Record inventory ledger entry for production
  INSERT INTO public.inventory_ledger (
    tenant_id, item_id, move_type, ref_type, ref_id,
    qty_in, unit_cost, total_cost,
    running_balance, running_value, avg_unit_cost,
    moved_at, created_by
  ) VALUES (
    p_tenant, v_mo_record.item_id, 'PROD_IN', 'MO', p_mo,
    p_completed_qty, v_final_stage_cost.unit_cost, p_completed_qty * v_final_stage_cost.unit_cost,
    v_current_stock + p_completed_qty,
    (v_current_stock + p_completed_qty) * v_new_avco_cost,
    v_new_avco_cost,
    now(), get_current_user_id()
  );

  -- Update manufacturing order status
  UPDATE public.manufacturing_orders
  SET status = 'completed',
      end_date = now(),
      total_cost = v_final_stage_cost.total_cost,
      updated_at = now()
  WHERE id = p_mo;

  -- Mark final stage as completed
  UPDATE public.stage_costs
  SET mode = 'completed',
      is_final = true,
      updated_at = now()
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = v_final_stage_cost.stage_no;

  -- Log audit event
  INSERT INTO public.audit_trail (
    tenant_id, event_type, table_name, record_id,
    operation, new_values, user_id
  ) VALUES (
    p_tenant, 'PROCESS', 'manufacturing_orders', p_mo,
    'finish_manufacturing_order',
    jsonb_build_object(
      'completed_qty', p_completed_qty,
      'final_unit_cost', v_final_stage_cost.unit_cost,
      'new_avco_cost', v_new_avco_cost
    ),
    get_current_user_id()
  );

  -- Return results
  RETURN QUERY
  SELECT p_mo, v_final_stage_cost.unit_cost, v_final_stage_cost.total_cost, 
         p_completed_qty * v_final_stage_cost.unit_cost;
END $$;

-- ===================================================================
-- UTILITY FUNCTIONS
-- ===================================================================

-- Function to recalculate all stage costs for a manufacturing order
CREATE OR REPLACE FUNCTION public.recalculate_mo_costs(
  p_tenant UUID,
  p_mo UUID
)
RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
  v_stage_record RECORD;
  v_count INTEGER := 0;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Recalculate each stage in sequence
  FOR v_stage_record IN
    SELECT stage_no, wc_id, good_qty, dm_cost, mode, notes
    FROM public.stage_costs
    WHERE tenant_id = p_tenant AND mo_id = p_mo
    ORDER BY stage_no
  LOOP
    PERFORM public.upsert_stage_cost(
      p_tenant, p_mo, v_stage_record.stage_no, v_stage_record.wc_id,
      v_stage_record.good_qty, v_stage_record.dm_cost, v_stage_record.mode,
      0, 0, NULL, v_stage_record.notes
    );
    
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END $$;

-- ===================================================================
-- GRANT PERMISSIONS
-- ===================================================================
GRANT EXECUTE ON FUNCTION public.upsert_stage_cost(UUID, UUID, INTEGER, UUID, NUMERIC, NUMERIC, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_labor_time(UUID, UUID, INTEGER, UUID, NUMERIC, NUMERIC, UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apply_overhead(UUID, UUID, INTEGER, UUID, TEXT, NUMERIC, NUMERIC, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_bom_materials(UUID, UUID, INTEGER, NUMERIC, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finish_manufacturing_order(UUID, UUID, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_mo_costs(UUID, UUID) TO authenticated;

-- Grant to service_role for admin operations
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ===================================================================
-- COMMENTS FOR DOCUMENTATION
-- ===================================================================
COMMENT ON FUNCTION public.upsert_stage_cost IS 'Core process costing function - calculates and updates stage costs using standard formula';
COMMENT ON FUNCTION public.apply_labor_time IS 'Records labor time and calculates labor costs for a manufacturing stage';
COMMENT ON FUNCTION public.apply_overhead IS 'Applies manufacturing overhead using various allocation bases';
COMMENT ON FUNCTION public.consume_bom_materials IS 'Consumes BOM materials with AVCO inventory impact and stock validation';
COMMENT ON FUNCTION public.finish_manufacturing_order IS 'Completes manufacturing order and updates finished goods inventory with AVCO';
COMMENT ON FUNCTION public.recalculate_mo_costs IS 'Recalculates all stage costs for a manufacturing order in sequence';