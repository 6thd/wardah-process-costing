-- WIP by Stage View
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
LEFT JOIN stock_moves sm ON sm.reference_id = mo.id::text
LEFT JOIN labor_entries le ON le.mo_id = mo.id
LEFT JOIN overhead_allocations oa ON oa.mo_id = mo.id
WHERE mo.status IN ('in_progress', 'completed')
GROUP BY mo.id, mo.order_number, mo.product_id, p.name, mo.status, mo.quantity;