-- ===================================================================
-- EQUIVALENT UNITS RPC FUNCTIONS
-- Atomic functions for equivalent units calculations and variance analysis
-- ===================================================================

-- ===================================================================
-- CALCULATE EQUIVALENT UNITS FOR A STAGE
-- ===================================================================
CREATE OR REPLACE FUNCTION public.calculate_equivalent_units(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER,
  p_beginning_wip NUMERIC DEFAULT 0,
  p_units_started NUMERIC DEFAULT 0,
  p_units_completed NUMERIC DEFAULT 0,
  p_ending_wip NUMERIC DEFAULT 0,
  p_material_completion_pct NUMERIC DEFAULT 100,
  p_conversion_completion_pct NUMERIC DEFAULT 100
)
RETURNS TABLE(
  equivalent_units_material NUMERIC,
  equivalent_units_conversion NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Validate parameters
  IF p_beginning_wip < 0 THEN
    RAISE EXCEPTION 'Beginning WIP units cannot be negative';
  END IF;
  
  IF p_units_started < 0 THEN
    RAISE EXCEPTION 'Units started cannot be negative';
  END IF;
  
  IF p_units_completed < 0 THEN
    RAISE EXCEPTION 'Units completed cannot be negative';
  END IF;
  
  IF p_ending_wip < 0 THEN
    RAISE EXCEPTION 'Ending WIP units cannot be negative';
  END IF;
  
  IF p_material_completion_pct < 0 OR p_material_completion_pct > 100 THEN
    RAISE EXCEPTION 'Material completion percentage must be between 0 and 100';
  END IF;
  
  IF p_conversion_completion_pct < 0 OR p_conversion_completion_pct > 100 THEN
    RAISE EXCEPTION 'Conversion completion percentage must be between 0 and 100';
  END IF;

  -- Validate manufacturing order exists
  PERFORM 1 FROM public.manufacturing_orders 
  WHERE id = p_mo AND tenant_id = p_tenant;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manufacturing order not found for tenant';
  END IF;

  -- Insert or update equivalent units record
  INSERT INTO public.equivalent_units (
    tenant_id, mo_id, stage_no, calculation_date,
    beginning_wip_units, units_started, units_completed, ending_wip_units,
    material_completion_percentage, conversion_completion_percentage,
    created_by
  ) VALUES (
    p_tenant, p_mo, p_stage, CURRENT_DATE,
    p_beginning_wip, p_units_started, p_units_completed, p_ending_wip,
    p_material_completion_pct, p_conversion_completion_pct,
    get_current_user_id()
  )
  ON CONFLICT (tenant_id, mo_id, stage_no, calculation_date) DO UPDATE SET
    beginning_wip_units = EXCLUDED.beginning_wip_units,
    units_started = EXCLUDED.units_started,
    units_completed = EXCLUDED.units_completed,
    ending_wip_units = EXCLUDED.ending_wip_units,
    material_completion_percentage = EXCLUDED.material_completion_percentage,
    conversion_completion_percentage = EXCLUDED.conversion_completion_percentage,
    updated_at = now(),
    updated_by = get_current_user_id();

  -- Return calculated equivalent units
  RETURN QUERY
  SELECT 
    (p_units_completed + (p_ending_wip * p_material_completion_pct / 100))::NUMERIC AS equivalent_units_material,
    (p_units_completed + (p_ending_wip * p_conversion_completion_pct / 100))::NUMERIC AS equivalent_units_conversion;
END $$;

-- ===================================================================
-- CALCULATE COST PER EQUIVALENT UNIT
-- ===================================================================
CREATE OR REPLACE FUNCTION public.calculate_cost_per_equivalent_unit(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER,
  p_period_start DATE,
  p_period_end DATE
)
RETURNS TABLE(
  material_cost NUMERIC,
  labor_cost NUMERIC,
  overhead_cost NUMERIC,
  total_cost NUMERIC,
  equivalent_units_material NUMERIC,
  equivalent_units_conversion NUMERIC,
  cost_per_equivalent_unit_material NUMERIC,
  cost_per_equivalent_unit_conversion NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
  v_material_cost NUMERIC := 0;
  v_labor_cost NUMERIC := 0;
  v_overhead_cost NUMERIC := 0;
  v_equiv_units_material NUMERIC := 0;
  v_equiv_units_conversion NUMERIC := 0;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Validate date range
  IF p_period_start > p_period_end THEN
    RAISE EXCEPTION 'Period start date cannot be after period end date';
  END IF;

  -- Validate manufacturing order exists
  PERFORM 1 FROM public.manufacturing_orders 
  WHERE id = p_mo AND tenant_id = p_tenant;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manufacturing order not found for tenant';
  END IF;

  -- Calculate total costs for the period
  -- Material costs (typically only in first stage)
  SELECT COALESCE(SUM(dm_cost), 0) INTO v_material_cost
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND created_at BETWEEN p_period_start AND p_period_end;

  -- Labor costs
  SELECT COALESCE(SUM(dl_cost), 0) INTO v_labor_cost
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND created_at BETWEEN p_period_start AND p_period_end;

  -- Overhead costs
  SELECT COALESCE(SUM(moh_cost), 0) INTO v_overhead_cost
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND created_at BETWEEN p_period_start AND p_period_end;

  -- Get equivalent units (most recent calculation for this stage)
  SELECT equivalent_units_material, equivalent_units_conversion 
  INTO v_equiv_units_material, v_equiv_units_conversion
  FROM public.equivalent_units
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
  ORDER BY calculation_date DESC
  LIMIT 1;

  -- Insert or update cost per equivalent unit record
  INSERT INTO public.cost_per_equivalent_unit (
    tenant_id, mo_id, stage_no, 
    calculation_period_start, calculation_period_end,
    material_cost, labor_cost, overhead_cost,
    equivalent_units_material, equivalent_units_conversion,
    created_by
  ) VALUES (
    p_tenant, p_mo, p_stage,
    p_period_start, p_period_end,
    v_material_cost, v_labor_cost, v_overhead_cost,
    COALESCE(v_equiv_units_material, 0), COALESCE(v_equiv_units_conversion, 0),
    get_current_user_id()
  )
  ON CONFLICT (tenant_id, mo_id, stage_no, calculation_period_start, calculation_period_end) DO UPDATE SET
    material_cost = EXCLUDED.material_cost,
    labor_cost = EXCLUDED.labor_cost,
    overhead_cost = EXCLUDED.overhead_cost,
    equivalent_units_material = EXCLUDED.equivalent_units_material,
    equivalent_units_conversion = EXCLUDED.equivalent_units_conversion,
    updated_at = now(),
    updated_by = get_current_user_id();

  -- Return calculated values
  RETURN QUERY
  SELECT 
    v_material_cost,
    v_labor_cost,
    v_overhead_cost,
    (v_material_cost + v_labor_cost + v_overhead_cost)::NUMERIC AS total_cost,
    COALESCE(v_equiv_units_material, 0)::NUMERIC AS equivalent_units_material,
    COALESCE(v_equiv_units_conversion, 0)::NUMERIC AS equivalent_units_conversion,
    CASE 
      WHEN COALESCE(v_equiv_units_material, 0) > 0 THEN (v_material_cost / v_equiv_units_material)
      ELSE 0 
    END::NUMERIC AS cost_per_equivalent_unit_material,
    CASE 
      WHEN COALESCE(v_equiv_units_conversion, 0) > 0 THEN ((v_labor_cost + v_overhead_cost) / v_equiv_units_conversion)
      ELSE 0 
    END::NUMERIC AS cost_per_equivalent_unit_conversion;
END $$;

-- ===================================================================
-- PERFORM VARIANCE ANALYSIS
-- ===================================================================
CREATE OR REPLACE FUNCTION public.perform_variance_analysis(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER
)
RETURNS TABLE(
  standard_material_cost NUMERIC,
  standard_labor_cost NUMERIC,
  standard_overhead_cost NUMERIC,
  actual_material_cost NUMERIC,
  actual_labor_cost NUMERIC,
  actual_overhead_cost NUMERIC,
  material_cost_variance NUMERIC,
  labor_cost_variance NUMERIC,
  overhead_cost_variance NUMERIC,
  total_variance NUMERIC,
  material_variance_percentage NUMERIC,
  labor_variance_percentage NUMERIC,
  overhead_variance_percentage NUMERIC,
  variance_severity TEXT
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
  v_standard_material NUMERIC := 0;
  v_standard_labor NUMERIC := 0;
  v_standard_overhead NUMERIC := 0;
  v_actual_material NUMERIC := 0;
  v_actual_labor NUMERIC := 0;
  v_actual_overhead NUMERIC := 0;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Validate manufacturing order exists
  PERFORM 1 FROM public.manufacturing_orders 
  WHERE id = p_mo AND tenant_id = p_tenant;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manufacturing order not found for tenant';
  END IF;

  -- Get standard costs (from BOM and standard rates)
  -- This is a simplified implementation - in practice, you'd get these from BOM and standard rates
  SELECT COALESCE(SUM(dm_cost), 0) INTO v_standard_material
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND mode = 'precosted'; -- Standard/pre-costed values

  SELECT COALESCE(SUM(dl_cost), 0) INTO v_standard_labor
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND mode = 'precosted';

  SELECT COALESCE(SUM(moh_cost), 0) INTO v_standard_overhead
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND mode = 'precosted';

  -- Get actual costs
  SELECT COALESCE(SUM(dm_cost), 0) INTO v_actual_material
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND mode = 'actual'; -- Actual values

  SELECT COALESCE(SUM(dl_cost), 0) INTO v_actual_labor
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND mode = 'actual';

  SELECT COALESCE(SUM(moh_cost), 0) INTO v_actual_overhead
  FROM public.stage_costs
  WHERE tenant_id = p_tenant 
    AND mo_id = p_mo 
    AND stage_no = p_stage
    AND mode = 'actual';

  -- Insert or update variance analysis record
  INSERT INTO public.variance_analysis (
    tenant_id, mo_id, stage_no, variance_date,
    standard_material_cost, standard_labor_cost, standard_overhead_cost,
    actual_material_cost, actual_labor_cost, actual_overhead_cost,
    created_by
  ) VALUES (
    p_tenant, p_mo, p_stage, CURRENT_DATE,
    v_standard_material, v_standard_labor, v_standard_overhead,
    v_actual_material, v_actual_labor, v_actual_overhead,
    get_current_user_id()
  )
  ON CONFLICT (tenant_id, mo_id, stage_no, variance_date) DO UPDATE SET
    standard_material_cost = EXCLUDED.standard_material_cost,
    standard_labor_cost = EXCLUDED.standard_labor_cost,
    standard_overhead_cost = EXCLUDED.standard_overhead_cost,
    actual_material_cost = EXCLUDED.actual_material_cost,
    actual_labor_cost = EXCLUDED.actual_labor_cost,
    actual_overhead_cost = EXCLUDED.actual_overhead_cost,
    updated_at = now(),
    updated_by = get_current_user_id();

  -- Return variance analysis results
  RETURN QUERY
  SELECT 
    v_standard_material,
    v_standard_labor,
    v_standard_overhead,
    v_actual_material,
    v_actual_labor,
    v_actual_overhead,
    (v_actual_material - v_standard_material)::NUMERIC AS material_cost_variance,
    (v_actual_labor - v_standard_labor)::NUMERIC AS labor_cost_variance,
    (v_actual_overhead - v_standard_overhead)::NUMERIC AS overhead_cost_variance,
    ((v_actual_material - v_standard_material) + (v_actual_labor - v_standard_labor) + (v_actual_overhead - v_standard_overhead))::NUMERIC AS total_variance,
    CASE 
      WHEN v_standard_material > 0 THEN ((v_actual_material - v_standard_material) / v_standard_material * 100)
      ELSE 0 
    END::NUMERIC AS material_variance_percentage,
    CASE 
      WHEN v_standard_labor > 0 THEN ((v_actual_labor - v_standard_labor) / v_standard_labor * 100)
      ELSE 0 
    END::NUMERIC AS labor_variance_percentage,
    CASE 
      WHEN v_standard_overhead > 0 THEN ((v_actual_overhead - v_standard_overhead) / v_standard_overhead * 100)
      ELSE 0 
    END::NUMERIC AS overhead_variance_percentage,
    CASE 
      WHEN ABS(((v_actual_material - v_standard_material) / NULLIF(v_standard_material, 0)) * 100) > 10 
        OR ABS(((v_actual_labor - v_standard_labor) / NULLIF(v_standard_labor, 0)) * 100) > 10 
        OR ABS(((v_actual_overhead - v_standard_overhead) / NULLIF(v_standard_overhead, 0)) * 100) > 10 
      THEN 'HIGH'
      WHEN ABS(((v_actual_material - v_standard_material) / NULLIF(v_standard_material, 0)) * 100) > 5 
        OR ABS(((v_actual_labor - v_standard_labor) / NULLIF(v_standard_labor, 0)) * 100) > 5 
        OR ABS(((v_actual_overhead - v_standard_overhead) / NULLIF(v_standard_overhead, 0)) * 100) > 5 
      THEN 'MEDIUM'
      ELSE 'LOW'
    END::TEXT AS variance_severity;
END $$;

-- ===================================================================
-- GET EQUIVALENT UNITS LATEST
-- ===================================================================
CREATE OR REPLACE FUNCTION public.get_equivalent_units_latest(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER
)
RETURNS TABLE(
  equivalent_units_material NUMERIC,
  equivalent_units_conversion NUMERIC,
  calculation_date DATE
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Return latest equivalent units calculation
  RETURN QUERY
  SELECT 
    eu.equivalent_units_material,
    eu.equivalent_units_conversion,
    eu.calculation_date
  FROM public.equivalent_units eu
  WHERE eu.tenant_id = p_tenant 
    AND eu.mo_id = p_mo 
    AND eu.stage_no = p_stage
  ORDER BY eu.calculation_date DESC
  LIMIT 1;
END $$;

-- ===================================================================
-- GET COST PER EQUIVALENT UNIT LATEST
-- ===================================================================
CREATE OR REPLACE FUNCTION public.get_cost_per_equivalent_unit_latest(
  p_tenant UUID,
  p_mo UUID,
  p_stage INTEGER
)
RETURNS TABLE(
  cost_per_equivalent_unit_material NUMERIC,
  cost_per_equivalent_unit_conversion NUMERIC,
  calculation_period_start DATE,
  calculation_period_end DATE
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Return latest cost per equivalent unit calculation
  RETURN QUERY
  SELECT 
    cpeu.cost_per_equivalent_unit_material,
    cpeu.cost_per_equivalent_unit_conversion,
    cpeu.calculation_period_start,
    cpeu.calculation_period_end
  FROM public.cost_per_equivalent_unit cpeu
  WHERE cpeu.tenant_id = p_tenant 
    AND cpeu.mo_id = p_mo 
    AND cpeu.stage_no = p_stage
  ORDER BY cpeu.calculation_period_end DESC
  LIMIT 1;
END $$;

-- ===================================================================
-- GET VARIANCE ANALYSIS ALERTS
-- ===================================================================
CREATE OR REPLACE FUNCTION public.get_variance_analysis_alerts(
  p_tenant UUID,
  p_severity TEXT DEFAULT 'MEDIUM'
)
RETURNS TABLE(
  mo_id UUID,
  stage_no INTEGER,
  variance_date DATE,
  material_variance_percentage NUMERIC,
  labor_variance_percentage NUMERIC,
  overhead_variance_percentage NUMERIC,
  variance_severity TEXT,
  total_variance NUMERIC
)
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_current_tenant UUID;
BEGIN
  -- Validate tenant access
  v_current_tenant := get_current_tenant_id();
  IF v_current_tenant IS NULL OR v_current_tenant != p_tenant THEN
    RAISE EXCEPTION 'Access denied: Invalid tenant context';
  END IF;

  -- Validate severity parameter
  IF p_severity NOT IN ('LOW', 'MEDIUM', 'HIGH') THEN
    p_severity := 'MEDIUM';
  END IF;

  -- Return variance analysis alerts based on severity
  RETURN QUERY
  SELECT 
    va.mo_id,
    va.stage_no,
    va.variance_date,
    va.material_variance_percentage,
    va.labor_variance_percentage,
    va.overhead_variance_percentage,
    va.variance_severity,
    va.total_variance
  FROM public.variance_analysis va
  WHERE va.tenant_id = p_tenant 
    AND (
      (p_severity = 'LOW' AND va.variance_severity IN ('LOW', 'MEDIUM', 'HIGH')) OR
      (p_severity = 'MEDIUM' AND va.variance_severity IN ('MEDIUM', 'HIGH')) OR
      (p_severity = 'HIGH' AND va.variance_severity = 'HIGH')
    )
  ORDER BY va.variance_date DESC, va.total_variance DESC;
END $$;

-- ===================================================================
-- GRANT PERMISSIONS
-- ===================================================================
GRANT EXECUTE ON FUNCTION public.calculate_equivalent_units(UUID, UUID, INTEGER, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_cost_per_equivalent_unit(UUID, UUID, INTEGER, DATE, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.perform_variance_analysis(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_equivalent_units_latest(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_cost_per_equivalent_unit_latest(UUID, UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_variance_analysis_alerts(UUID, TEXT) TO authenticated;

-- Grant to service_role for admin operations
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ===================================================================
-- COMMENTS FOR DOCUMENTATION
-- ===================================================================
COMMENT ON FUNCTION public.calculate_equivalent_units IS 'Calculate equivalent units for materials and conversion costs';
COMMENT ON FUNCTION public.calculate_cost_per_equivalent_unit IS 'Calculate cost per equivalent unit for a given period';
COMMENT ON FUNCTION public.perform_variance_analysis IS 'Perform variance analysis between standard and actual costs';
COMMENT ON FUNCTION public.get_equivalent_units_latest IS 'Get the latest equivalent units calculation for a stage';
COMMENT ON FUNCTION public.get_cost_per_equivalent_unit_latest IS 'Get the latest cost per equivalent unit calculation for a stage';
COMMENT ON FUNCTION public.get_variance_analysis_alerts IS 'Get variance analysis alerts based on severity threshold';