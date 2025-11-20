-- Advanced Reports System Implementation
-- SQL Schema for Variance Analysis and WIP Reporting

-- Function to calculate material variances for a manufacturing order
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
    sm.product_code as material_code,
    p.name as material_name,
    SUM(sm.quantity) as standard_qty,
    SUM(sm.actual_quantity) as actual_qty,
    SUM(sm.standard_cost) as standard_cost,
    SUM(sm.total_cost) as actual_cost,
    -- Quantity Variance = (Standard Quantity - Actual Quantity) * Standard Price
    SUM((sm.quantity - COALESCE(sm.actual_quantity, 0)) * sm.unit_cost) as qty_variance,
    -- Price Variance = (Standard Price - Actual Price) * Actual Quantity
    SUM((sm.unit_cost - COALESCE(sm.actual_unit_cost, sm.unit_cost)) * COALESCE(sm.actual_quantity, sm.quantity)) as price_variance,
    -- Efficiency Variance (placeholder - would require routing information)
    0::DECIMAL(18,6) as efficiency_variance,
    -- Total Variance
    SUM((sm.quantity - COALESCE(sm.actual_quantity, 0)) * sm.unit_cost) +
    SUM((sm.unit_cost - COALESCE(sm.actual_unit_cost, sm.unit_cost)) * COALESCE(sm.actual_quantity, sm.quantity)) as total_variance
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
$$ LANGUAGE plpgsql;

-- Function to calculate labor variances for a manufacturing order
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
    wc.code as work_center_code,
    wc.name as work_center_name,
    -- Standard hours would come from routing (placeholder)
    0::DECIMAL(18,6) as standard_hours,
    SUM(le.hours_worked) as actual_hours,
    -- Standard rate would come from work center (placeholder)
    0::DECIMAL(18,6) as standard_rate,
    CASE 
      WHEN SUM(le.hours_worked) > 0 THEN SUM(le.total_cost) / SUM(le.hours_worked)
      ELSE 0 
    END as actual_rate,
    -- Efficiency Variance = (Standard Hours - Actual Hours) * Standard Rate
    -- (placeholder calculation)
    0::DECIMAL(18,6) as efficiency_variance,
    -- Rate Variance = (Standard Rate - Actual Rate) * Actual Hours
    -- (placeholder calculation)
    0::DECIMAL(18,6) as rate_variance,
    -- Total Variance (placeholder)
    0::DECIMAL(18,6) as total_variance
  FROM labor_entries le
  JOIN work_centers wc ON le.work_center_id = wc.id
  JOIN manufacturing_orders mo ON le.manufacturing_order_id = mo.id  -- Fixed: using correct column name
  WHERE le.manufacturing_order_id = p_mo_id  -- Fixed: using correct column name
    AND (p_start_date IS NULL OR le.created_at::date >= p_start_date)
    AND (p_end_date IS NULL OR le.created_at::date <= p_end_date)
  GROUP BY wc.code, wc.name
  ORDER BY wc.code;
END;
$$ LANGUAGE plpgsql;

-- WIP by Stage View
-- Shows work in progress inventory by manufacturing order stage

CREATE OR REPLACE VIEW wip_by_stage AS
SELECT 
  mo.order_number,
  mo.product_id,
  p.name as product_name,
  mo.status,
  mo.quantity as qty_planned,
  -- Assuming there's a qty_produced field or we calculate it
  0 as qty_produced, -- This should be updated with actual produced quantity
  -- Material cost (from stock moves with material_issue type)
  COALESCE(SUM(CASE WHEN sm.move_type = 'material_issue' THEN sm.total_cost ELSE 0 END), 0) as materials_cost,
  -- Labor cost (from labor entries)
  COALESCE(SUM(le.total_cost), 0) as labor_cost,
  -- Overhead applied (from overhead allocations)
  COALESCE(SUM(oa.allocated_amount), 0) as overhead_applied,
  -- Total WIP cost
  COALESCE(SUM(CASE WHEN sm.move_type = 'material_issue' THEN sm.total_cost ELSE 0 END), 0) +
  COALESCE(SUM(le.total_cost), 0) +
  COALESCE(SUM(oa.allocated_amount), 0) as total_wip_cost,
  -- Current unit cost
  CASE 
    WHEN mo.quantity > 0 THEN
      (COALESCE(SUM(CASE WHEN sm.move_type = 'material_issue' THEN sm.total_cost ELSE 0 END), 0) +
       COALESCE(SUM(le.total_cost), 0) +
       COALESCE(SUM(oa.allocated_amount), 0)) / mo.quantity
    ELSE 0
  END as current_unit_cost
FROM manufacturing_orders mo
JOIN products p ON mo.product_id = p.id
LEFT JOIN stock_moves sm ON sm.reference_id::text = mo.id::text
LEFT JOIN labor_entries le ON le.manufacturing_order_id = mo.id  -- Fixed: using correct column name
LEFT JOIN overhead_allocations oa ON oa.manufacturing_order_id = mo.id  -- Fixed: using correct column name
WHERE mo.status IN ('in_progress', 'completed')
GROUP BY mo.id, mo.order_number, mo.product_id, p.name, mo.status, mo.quantity;