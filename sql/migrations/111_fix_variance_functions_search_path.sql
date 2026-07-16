-- ===================================================================
-- Migration 111: تثبيت search_path لدوال انحرافات التصنيع
-- ===================================================================
-- المشكلة: calculate_material_variances + calculate_labor_variances
--   أُنشئتا في migration 108 بدون SET search_path ⇒ Supabase Advisor
--   يُبلّغ عنهما بتحذير function_search_path_mutable.
-- الحل: إعادة إنشاء الدالتين بإضافة SET search_path = public.
-- (النص المطبَّق فعلياً على الإنتاج — 117 تعيد تعريفهما لاحقاً)
-- ===================================================================

CREATE OR REPLACE FUNCTION public.calculate_material_variances(
  p_mo_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
) RETURNS TABLE (
  material_code VARCHAR, material_name VARCHAR,
  standard_qty DECIMAL(18,6), actual_qty DECIMAL(18,6),
  standard_cost DECIMAL(18,6), actual_cost DECIMAL(18,6),
  qty_variance DECIMAL(18,6), price_variance DECIMAL(18,6),
  efficiency_variance DECIMAL(18,6), total_variance DECIMAL(18,6)
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    sm.product_code, p.name,
    SUM(sm.quantity), SUM(sm.actual_quantity),
    SUM(sm.standard_cost), SUM(sm.total_cost),
    SUM((sm.quantity - COALESCE(sm.actual_quantity,0)) * sm.unit_cost),
    SUM((sm.unit_cost - COALESCE(sm.actual_unit_cost, sm.unit_cost)) * COALESCE(sm.actual_quantity, sm.quantity)),
    0::DECIMAL(18,6),
    SUM((sm.quantity - COALESCE(sm.actual_quantity,0)) * sm.unit_cost) +
    SUM((sm.unit_cost - COALESCE(sm.actual_unit_cost, sm.unit_cost)) * COALESCE(sm.actual_quantity, sm.quantity))
  FROM stock_moves sm
  JOIN products p ON sm.product_code = p.code
  WHERE sm.move_type = 'material_issue'
    AND sm.reference_id::text = p_mo_id::text
    AND (p_start_date IS NULL OR sm.date >= p_start_date)
    AND (p_end_date   IS NULL OR sm.date <= p_end_date)
  GROUP BY sm.product_code, p.name
  ORDER BY sm.product_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_labor_variances(
  p_mo_id UUID,
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
) RETURNS TABLE (
  work_center_code VARCHAR, work_center_name VARCHAR,
  standard_hours DECIMAL(18,6), actual_hours DECIMAL(18,6),
  standard_rate DECIMAL(18,6), actual_rate DECIMAL(18,6),
  efficiency_variance DECIMAL(18,6), rate_variance DECIMAL(18,6),
  total_variance DECIMAL(18,6)
)
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    wc.code, wc.name,
    0::DECIMAL(18,6), SUM(le.hours_worked),
    0::DECIMAL(18,6),
    CASE WHEN SUM(le.hours_worked) > 0 THEN SUM(le.total_cost)/SUM(le.hours_worked) ELSE 0 END,
    0::DECIMAL(18,6), 0::DECIMAL(18,6), 0::DECIMAL(18,6)
  FROM labor_entries le
  JOIN work_centers wc ON le.work_center_id = wc.id
  WHERE le.manufacturing_order_id = p_mo_id
    AND (p_start_date IS NULL OR le.created_at::date >= p_start_date)
    AND (p_end_date   IS NULL OR le.created_at::date <= p_end_date)
  GROUP BY wc.code, wc.name
  ORDER BY wc.code;
END;
$$;
