-- ===================================================================
-- VARIANCE MONITORING RPC FUNCTIONS
-- Functions for scheduled variance monitoring and analysis
-- ===================================================================

-- ===================================================================
-- GET VARIANCE ALERTS WITH DETAILED INFORMATION
-- ===================================================================
CREATE OR REPLACE FUNCTION public.get_variance_alerts(
  p_severity_threshold TEXT DEFAULT 'MEDIUM'
)
RETURNS TABLE(
  mo_id UUID,
  stage_no INTEGER,
  variance_date DATE,
  standard_material_cost NUMERIC(18,4),
  standard_labor_cost NUMERIC(18,4),
  standard_overhead_cost NUMERIC(18,4),
  actual_material_cost NUMERIC(18,4),
  actual_labor_cost NUMERIC(18,4),
  actual_overhead_cost NUMERIC(18,4),
  material_cost_variance NUMERIC(18,4),
  labor_cost_variance NUMERIC(18,4),
  overhead_cost_variance NUMERIC(18,4),
  total_variance NUMERIC(18,4),
  material_variance_percentage NUMERIC(8,2),
  labor_variance_percentage NUMERIC(8,2),
  overhead_variance_percentage NUMERIC(8,2),
  variance_severity TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := current_setting('app.current_tenant_id', true)::UUID;
BEGIN
  -- Validate tenant access
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No tenant context';
  END IF;

  -- Validate severity threshold
  IF p_severity_threshold NOT IN ('LOW', 'MEDIUM', 'HIGH') THEN
    p_severity_threshold := 'MEDIUM';
  END IF;

  -- Return variance alerts with detailed information
  RETURN QUERY
  SELECT 
    va.mo_id,
    va.stage_no,
    va.variance_date,
    va.standard_material_cost,
    va.standard_labor_cost,
    va.standard_overhead_cost,
    va.actual_material_cost,
    va.actual_labor_cost,
    va.actual_overhead_cost,
    va.material_cost_variance,
    va.labor_cost_variance,
    va.overhead_cost_variance,
    va.total_variance,
    va.material_variance_percentage,
    va.labor_variance_percentage,
    va.overhead_variance_percentage,
    va.variance_severity
  FROM public.variance_analysis va
  WHERE va.tenant_id = v_tenant_id
    AND (
      (p_severity_threshold = 'LOW' AND va.variance_severity IN ('LOW', 'MEDIUM', 'HIGH')) OR
      (p_severity_threshold = 'MEDIUM' AND va.variance_severity IN ('MEDIUM', 'HIGH')) OR
      (p_severity_threshold = 'HIGH' AND va.variance_severity = 'HIGH')
    )
  ORDER BY va.variance_date DESC, ABS(va.total_variance) DESC;
END $$;

-- ===================================================================
-- ANALYZE OVERHEAD VARIANCES BY WORK CENTER
-- ===================================================================
CREATE OR REPLACE FUNCTION public.analyze_overhead_variances()
RETURNS TABLE(
  work_center_id UUID,
  work_center_code TEXT,
  work_center_name TEXT,
  applied_oh NUMERIC(18,4),
  actual_oh NUMERIC(18,4),
  variance NUMERIC(18,4),
  variance_percentage NUMERIC(8,2),
  variance_severity TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := current_setting('app.current_tenant_id', true)::UUID;
BEGIN
  -- Validate tenant access
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No tenant context';
  END IF;

  -- Analyze overhead variances by work center
  RETURN QUERY
  WITH applied_overhead AS (
    SELECT 
      sc.wc_id,
      SUM(sc.moh_cost) AS total_applied
    FROM public.stage_costs sc
    WHERE sc.tenant_id = v_tenant_id
      AND sc.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY sc.wc_id
  ),
  actual_overhead AS (
    SELECT 
      moh.wc_id,
      SUM(moh.amount) AS total_actual
    FROM public.moh_applied moh
    WHERE moh.tenant_id = v_tenant_id
      AND moh.status = 'applied'
      AND moh.created_at >= (CURRENT_DATE - INTERVAL '30 days')
    GROUP BY moh.wc_id
  )
  SELECT 
    wc.id AS work_center_id,
    wc.code AS work_center_code,
    wc.name AS work_center_name,
    COALESCE(ao.total_applied, 0) AS applied_oh,
    COALESCE(ac.total_actual, 0) AS actual_oh,
    (COALESCE(ac.total_actual, 0) - COALESCE(ao.total_applied, 0)) AS variance,
    CASE 
      WHEN COALESCE(ao.total_applied, 0) > 0 THEN
        ((COALESCE(ac.total_actual, 0) - COALESCE(ao.total_applied, 0)) / ao.total_applied * 100)
      ELSE 0
    END AS variance_percentage,
    CASE 
      WHEN ABS(((COALESCE(ac.total_actual, 0) - COALESCE(ao.total_applied, 0)) / NULLIF(ao.total_applied, 0)) * 100) > 10 THEN 'HIGH'
      WHEN ABS(((COALESCE(ac.total_actual, 0) - COALESCE(ao.total_applied, 0)) / NULLIF(ao.total_applied, 0)) * 100) > 5 THEN 'MEDIUM'
      ELSE 'LOW'
    END AS variance_severity
  FROM public.work_centers wc
  LEFT JOIN applied_overhead ao ON wc.id = ao.wc_id
  LEFT JOIN actual_overhead ac ON wc.id = ac.wc_id
  WHERE wc.tenant_id = v_tenant_id
    AND wc.is_active = true
  ORDER BY ABS(COALESCE(ac.total_actual, 0) - COALESCE(ao.total_applied, 0)) DESC;
END $$;

-- ===================================================================
-- GENERATE VARIANCE REPORT
-- ===================================================================
CREATE OR REPLACE FUNCTION public.generate_variance_report(
  p_start_date DATE,
  p_end_date DATE,
  p_mo_id UUID DEFAULT NULL
)
RETURNS TABLE(
  mo_id UUID,
  mo_number TEXT,
  stage_no INTEGER,
  stage_name TEXT,
  variance_date DATE,
  standard_total_cost NUMERIC(18,4),
  actual_total_cost NUMERIC(18,4),
  total_variance NUMERIC(18,4),
  variance_percentage NUMERIC(8,2),
  variance_severity TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := current_setting('app.current_tenant_id', true)::UUID;
BEGIN
  -- Validate tenant access
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No tenant context';
  END IF;

  -- Validate date range
  IF p_start_date > p_end_date THEN
    RAISE EXCEPTION 'Start date cannot be after end date';
  END IF;

  -- Generate variance report
  RETURN QUERY
  SELECT 
    mo.id AS mo_id,
    mo.order_number AS mo_number,
    va.stage_no,
    CONCAT('Stage ', va.stage_no) AS stage_name,
    va.variance_date,
    (va.standard_material_cost + va.standard_labor_cost + va.standard_overhead_cost) AS standard_total_cost,
    (va.actual_material_cost + va.actual_labor_cost + va.actual_overhead_cost) AS actual_total_cost,
    va.total_variance,
    CASE 
      WHEN (va.standard_material_cost + va.standard_labor_cost + va.standard_overhead_cost) > 0 THEN
        (va.total_variance / (va.standard_material_cost + va.standard_labor_cost + va.standard_overhead_cost) * 100)
      ELSE 0
    END AS variance_percentage,
    va.variance_severity
  FROM public.variance_analysis va
  JOIN public.manufacturing_orders mo ON va.mo_id = mo.id AND va.tenant_id = mo.tenant_id
  WHERE va.tenant_id = v_tenant_id
    AND va.variance_date BETWEEN p_start_date AND p_end_date
    AND (p_mo_id IS NULL OR va.mo_id = p_mo_id)
  ORDER BY va.variance_date DESC, ABS(va.total_variance) DESC;
END $$;

-- ===================================================================
-- SCHEDULED VARIANCE MONITORING FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION public.schedule_variance_monitoring()
RETURNS TABLE(
  alert_count INTEGER,
  high_severity_count INTEGER,
  total_variance_amount NUMERIC(18,4)
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID := current_setting('app.current_tenant_id', true)::UUID;
  v_alert_count INTEGER := 0;
  v_high_severity_count INTEGER := 0;
  v_total_variance NUMERIC(18,4) := 0;
BEGIN
  -- Validate tenant access
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unauthorized: No tenant context';
  END IF;

  -- Get variance alert statistics
  SELECT 
    COUNT(*),
    COUNT(CASE WHEN variance_severity = 'HIGH' THEN 1 END),
    COALESCE(SUM(ABS(total_variance)), 0)
  INTO v_alert_count, v_high_severity_count, v_total_variance
  FROM public.variance_analysis va
  WHERE va.tenant_id = v_tenant_id
    AND va.variance_date >= (CURRENT_DATE - INTERVAL '7 days')
    AND va.variance_severity IN ('MEDIUM', 'HIGH');

  -- Return statistics
  RETURN QUERY
  SELECT v_alert_count, v_high_severity_count, v_total_variance;
END $$;

-- ===================================================================
-- GRANT PERMISSIONS
-- ===================================================================
GRANT EXECUTE ON FUNCTION public.get_variance_alerts(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.analyze_overhead_variances() TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_variance_report(DATE, DATE, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_variance_monitoring() TO authenticated;

-- Grant to service_role for admin operations
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- ===================================================================
-- COMMENTS FOR DOCUMENTATION
-- ===================================================================
COMMENT ON FUNCTION public.get_variance_alerts IS 'Get detailed variance alerts based on severity threshold';
COMMENT ON FUNCTION public.analyze_overhead_variances IS 'Analyze overhead variances by work center for the last 30 days';
COMMENT ON FUNCTION public.generate_variance_report IS 'Generate variance report for a date range and optional MO';
COMMENT ON FUNCTION public.schedule_variance_monitoring IS 'Scheduled function to monitor variances and return statistics';