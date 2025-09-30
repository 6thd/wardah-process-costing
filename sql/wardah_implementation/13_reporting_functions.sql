-- =======================================
-- 5. REPORTING FUNCTIONS
-- =======================================

-- Function: Get current inventory valuation
CREATE OR REPLACE FUNCTION get_inventory_valuation(
    p_org_id UUID,
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    product_sku VARCHAR,
    product_name VARCHAR,
    location_code VARCHAR,
    onhand_qty DECIMAL(18,6),
    avg_cost DECIMAL(18,6),
    total_value DECIMAL(18,6),
    product_type VARCHAR
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        p.sku,
        p.name,
        l.code,
        sq.onhand_qty,
        sq.avg_cost,
        sq.onhand_qty * sq.avg_cost as total_value,
        p.product_type
    FROM stock_quants sq
    JOIN products p ON p.id = sq.product_id
    JOIN locations l ON l.id = sq.location_id
    WHERE sq.org_id = p_org_id
    AND sq.onhand_qty != 0
    ORDER BY p.sku, l.code;
END;
$$;

-- Function: Get WIP analysis
CREATE OR REPLACE FUNCTION get_wip_analysis(
    p_org_id UUID,
    p_as_of_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (
    mo_number VARCHAR,
    product_sku VARCHAR,
    product_name VARCHAR,
    status VARCHAR,
    qty_planned DECIMAL(18,6),
    qty_produced DECIMAL(18,6),
    material_cost DECIMAL(18,6),
    labor_cost DECIMAL(18,6),
    overhead_cost DECIMAL(18,6),
    total_wip_cost DECIMAL(18,6),
    completion_pct DECIMAL(5,2)
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT 
        mo.mo_number,
        p.sku,
        p.name,
        mo.status,
        mo.qty_planned,
        mo.qty_produced,
        COALESCE(materials.total_cost, 0) as material_cost,
        COALESCE(labor.total_cost, 0) as labor_cost,
        COALESCE(overhead.total_cost, 0) as overhead_cost,
        COALESCE(materials.total_cost, 0) + COALESCE(labor.total_cost, 0) + COALESCE(overhead.total_cost, 0) as total_wip_cost,
        CASE WHEN mo.qty_planned > 0 THEN (mo.qty_produced / mo.qty_planned * 100) ELSE 0 END as completion_pct
    FROM manufacturing_orders mo
    JOIN products p ON p.id = mo.product_id
    LEFT JOIN (
        SELECT reference_id, SUM(total_cost) as total_cost
        FROM stock_moves
        WHERE org_id = p_org_id AND move_type = 'material_issue'
        AND reference_type = 'manufacturing_order'
        GROUP BY reference_id
    ) materials ON materials.reference_id = mo.id
    LEFT JOIN (
        SELECT mo_id, SUM(total_amount) as total_cost
        FROM labor_entries
        WHERE org_id = p_org_id
        GROUP BY mo_id
    ) labor ON labor.mo_id = mo.id
    LEFT JOIN (
        SELECT mo_id, SUM(total_overhead) as total_cost
        FROM overhead_allocations
        WHERE org_id = p_org_id
        GROUP BY mo_id
    ) overhead ON overhead.mo_id = mo.id
    WHERE mo.org_id = p_org_id
    AND mo.status IN ('confirmed', 'in_progress')
    ORDER BY mo.mo_number;
END;
$$;