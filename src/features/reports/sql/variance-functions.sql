-- Material Variances Function
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
  WITH material_usage AS (
    SELECT 
      p.code as material_code,
      p.name as material_name,
      bl.qty as standard_qty,
      COALESCE(SUM(sm.qty), 0) as actual_qty,
      bl.qty * sq.avg_cost as standard_cost,
      COALESCE(SUM(sm.qty * sm.unit_cost_in), 0) as actual_cost
    FROM manufacturing_orders mo
    JOIN bom_headers bh ON mo.product_id = bh.product_id
    JOIN bom_lines bl ON bh.id = bl.bom_id
    JOIN products p ON bl.component_product_id = p.id
    LEFT JOIN stock_moves sm ON sm.ref_id = mo.id::text 
      AND sm.move_type = 'material_issue'
      AND sm.product_id = p.id
    LEFT JOIN stock_quants sq ON sq.product_id = p.id
    WHERE mo.id = p_mo_id
      AND (p_start_date IS NULL OR mo.created_at >= p_start_date)
      AND (p_end_date IS NULL OR mo.created_at <= p_end_date)
    GROUP BY p.code, p.name, bl.qty, sq.avg_cost
  )
  SELECT 
    mu.material_code,
    mu.material_name,
    mu.standard_qty,
    mu.actual_qty,
    mu.standard_cost,
    mu.actual_cost,
    (mu.actual_qty - mu.standard_qty) * (mu.standard_cost / NULLIF(mu.standard_qty, 0)) as qty_variance,
    mu.actual_qty * ((mu.actual_cost / NULLIF(mu.actual_qty, 0)) - (mu.standard_cost / NULLIF(mu.standard_qty, 0))) as price_variance,
    ((mu.actual_qty - mu.standard_qty) * (mu.actual_cost / NULLIF(mu.actual_qty, 0))) as efficiency_variance,
    (mu.actual_cost - mu.standard_cost) as total_variance
  FROM material_usage mu;
END;
$$ LANGUAGE plpgsql;

-- Labor Variances Function
CREATE OR REPLACE FUNCTION calculate_labor_variances(
  p_mo_id UUID
) RETURNS TABLE (
  work_center VARCHAR,
  standard_hours DECIMAL(18,6),
  actual_hours DECIMAL(18,6),
  standard_rate DECIMAL(18,6),
  actual_rate DECIMAL(18,6),
  rate_variance DECIMAL(18,6),
  efficiency_variance DECIMAL(18,6),
  total_variance DECIMAL(18,6)
) AS $$
BEGIN
  RETURN QUERY
  WITH labor_analysis AS (
    SELECT 
      wc.name as work_center,
      4.5 as standard_hours, -- This should come from BOM or Work Center routing
      COALESCE(SUM(le.hours_worked), 0) as actual_hours,
      25.0 as standard_rate, -- This should come from Work Center
      CASE 
        WHEN COALESCE(SUM(le.hours_worked), 0) > 0 
        THEN COALESCE(SUM(le.total_cost), 0) / SUM(le.hours_worked)
        ELSE 0 
      END as actual_rate
    FROM labor_entries le
    JOIN work_centers wc ON le.work_center_id = wc.id
    WHERE le.mo_id = p_mo_id
    GROUP BY wc.name
  )
  SELECT 
    la.work_center,
    la.standard_hours,
    la.actual_hours,
    la.standard_rate,
    la.actual_rate,
    la.actual_hours * (la.actual_rate - la.standard_rate) as rate_variance,
    la.standard_rate * (la.actual_hours - la.standard_hours) as efficiency_variance,
    (la.actual_hours * la.actual_rate) - (la.standard_hours * la.standard_rate) as total_variance
  FROM labor_analysis la;
END;
$$ LANGUAGE plpgsql;