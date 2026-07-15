-- ===================================================================
-- Migration 111: تثبيت search_path لدوال انحرافات التصنيع
-- ===================================================================
-- المشكلة: calculate_material_variances + calculate_labor_variances
--   أُنشئتا في migration 108 بدون SET search_path ⇒ Supabase Advisor
--   يُبلّغ عنهما بتحذير function_search_path_mutable.
-- الحل: إعادة إنشاء الدالتين بإضافة SET search_path = public.
-- ===================================================================

CREATE OR REPLACE FUNCTION calculate_material_variances(
  p_mo_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
) RETURNS TABLE (
  material_code VARCHAR,
  material_name VARCHAR,
  standard_qty DECIMAL(18,6),
  actual_qty DECIMAL(18,6),
  standard_cost DECIMAL(18,6),
  actual_cost DECIMAL(18,6),
  qty_variance DECIMAL(18,6),
  price_variance DECIMAL(18,6),
  efficiency_variance DECIMAL(18,6),
  total_variance DECIMAL(18,6)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    sm.product_code AS material_code,
    p.name AS material_name,
    SUM(sm.quantity) AS standard_qty,
    SUM(sm.actual_quantity) AS actual_qty,
    SUM(sm.standard_cost) AS standard_cost,
    SUM(sm.total_cost) AS actual_cost,
    SUM((sm.quantity - COALESCE(sm.actual_quantity, 0)) * sm.unit_cost) AS qty_variance,
    SUM((sm.unit_cost - COALESCE(sm.actual_unit_cost, sm.unit_cost)) * COALESCE(sm.actual_quantity, sm.quantity)) AS price_variance,
    0::DECIMAL(18,6) AS efficiency_variance,
    SUM((sm.quantity - COALESCE(sm.actual_quantity, 0)) * sm.unit_cost) +
    SUM((sm.unit_cost - COALESCE(sm.actual_unit_cost, sm.unit_cost)) * COALESCE(sm.actual_quantity, sm.quantity)) AS total_variance
  FROM stock_moves sm
  JOIN products p ON sm.product_code = p.code
  JOIN manufacturing_orders mo ON sm.reference_id::text = mo.id::text
  WHERE sm.move_type = 'material_issue'
    AND sm.reference_id::text = p_mo_id::text
    AND (p_start_date IS NULL OR sm.date >= p_start_date)
    AND (p_end_date IS NULL OR sm.date <= p_end_date)
  GROUP BY sm.product_code, p.name
  ORDER BY sm.product_code;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

CREATE OR REPLACE FUNCTION calculate_labor_variances(
  p_mo_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
) RETURNS TABLE (
  work_center_code VARCHAR,
  work_center_name VARCHAR,
  standard_hours DECIMAL(18,6),
  actual_hours DECIMAL(18,6),
  standard_rate DECIMAL(18,6),
  actual_rate DECIMAL(18,6),
  efficiency_variance DECIMAL(18,6),
  rate_variance DECIMAL(18,6),
  total_variance DECIMAL(18,6)
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    wc.code AS work_center_code,
    wc.name AS work_center_name,
    0::DECIMAL(18,6) AS standard_hours,
    SUM(le.hours_worked) AS actual_hours,
    0::DECIMAL(18,6) AS standard_rate,
    CASE
      WHEN SUM(le.hours_worked) > 0 THEN SUM(le.total_cost) / SUM(le.hours_worked)
      ELSE 0
    END AS actual_rate,
    0::DECIMAL(18,6) AS efficiency_variance,
    0::DECIMAL(18,6) AS rate_variance,
    0::DECIMAL(18,6) AS total_variance
  FROM labor_entries le
  JOIN work_centers wc ON le.work_center_id = wc.id
  JOIN manufacturing_orders mo ON le.manufacturing_order_id = mo.id
  WHERE le.manufacturing_order_id = p_mo_id
    AND (p_start_date IS NULL OR le.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR le.created_at::date <= p_end_date)
  GROUP BY wc.code, wc.name
  ORDER BY wc.code;
END;
$$ LANGUAGE plpgsql
SET search_path = public;

RAISE NOTICE 'VERIFY[111] ✓ — calculate_material_variances + calculate_labor_variances: search_path مثبَّت';
