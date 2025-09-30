-- =======================================
-- 3. OVERHEAD APPLICATION FUNCTIONS
-- =======================================

-- Function: Apply overhead to MO
CREATE OR REPLACE FUNCTION apply_overhead_to_mo(
    p_mo_id UUID,
    p_allocation_base VARCHAR(50) DEFAULT 'labor',
    p_cost_center VARCHAR(100) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_mo RECORD;
    v_base_amount DECIMAL(18,6) := 0;
    v_overhead_rate DECIMAL(18,6) := 0;
    v_total_overhead DECIMAL(18,6);
    v_allocation_id UUID;
BEGIN
    -- Get MO details
    SELECT * INTO v_mo
    FROM manufacturing_orders
    WHERE id = p_mo_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing Order not found';
    END IF;
    
    -- Calculate allocation base amount
    CASE p_allocation_base
        WHEN 'labor' THEN
            SELECT COALESCE(SUM(total_amount), 0) INTO v_base_amount
            FROM labor_entries
            WHERE mo_id = p_mo_id;
            
        WHEN 'machine_hours' THEN
            SELECT COALESCE(SUM(hours_worked), 0) INTO v_base_amount
            FROM labor_entries
            WHERE mo_id = p_mo_id;
            
        WHEN 'direct_costs' THEN
            -- Material + Labor costs
            SELECT COALESCE(
                (SELECT SUM(total_cost) FROM stock_moves 
                 WHERE reference_id = p_mo_id AND move_type = 'material_issue') +
                (SELECT SUM(total_amount) FROM labor_entries WHERE mo_id = p_mo_id),
                0
            ) INTO v_base_amount;
    END CASE;
    
    -- Get overhead rate
    SELECT rate_value INTO v_overhead_rate
    FROM overhead_rates
    WHERE org_id = v_mo.org_id
    AND (p_cost_center IS NULL OR cost_center = p_cost_center)
    AND rate_type = CASE p_allocation_base
        WHEN 'labor' THEN 'percent_of_labor'
        WHEN 'machine_hours' THEN 'per_hour'
        ELSE 'per_unit'
    END
    AND (effective_to IS NULL OR effective_to >= CURRENT_DATE)
    AND is_active = true
    ORDER BY effective_from DESC
    LIMIT 1;
    
    IF v_overhead_rate IS NULL THEN
        v_overhead_rate := 0;
    END IF;
    
    -- Calculate total overhead
    v_total_overhead := v_base_amount * v_overhead_rate;
    
    -- Create overhead allocation record
    INSERT INTO overhead_allocations (
        org_id, mo_id, allocation_base, 
        base_amount, overhead_rate
    ) VALUES (
        v_mo.org_id, p_mo_id, p_allocation_base,
        v_base_amount, v_overhead_rate
    ) RETURNING id INTO v_allocation_id;
    
    RETURN jsonb_build_object(
        'success', true,
        'mo_id', p_mo_id,
        'allocation_id', v_allocation_id,
        'allocation_base', p_allocation_base,
        'base_amount', v_base_amount,
        'overhead_rate', v_overhead_rate,
        'total_overhead', v_total_overhead
    );
END;
$$;