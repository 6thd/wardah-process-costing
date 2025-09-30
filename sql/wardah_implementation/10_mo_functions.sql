-- =======================================
-- 2. MANUFACTURING ORDER FUNCTIONS
-- =======================================

-- Function: Complete Manufacturing Order
CREATE OR REPLACE FUNCTION complete_manufacturing_order(p_mo_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_mo RECORD;
    v_total_material_cost DECIMAL(18,6) := 0;
    v_total_labor_cost DECIMAL(18,6) := 0;
    v_total_overhead_cost DECIMAL(18,6) := 0;
    v_total_cost DECIMAL(18,6);
    v_unit_cost DECIMAL(18,6);
    v_result JSONB;
    v_move_id UUID;
BEGIN
    -- Get MO details
    SELECT mo.*, p.sku as product_sku, p.name as product_name,
           l.code as location_code
    INTO v_mo
    FROM manufacturing_orders mo
    JOIN products p ON p.id = mo.product_id
    JOIN locations l ON l.id = mo.location_id
    WHERE mo.id = p_mo_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing Order not found';
    END IF;
    
    IF v_mo.status = 'done' THEN
        RAISE EXCEPTION 'Manufacturing Order already completed';
    END IF;
    
    IF v_mo.qty_produced <= 0 THEN
        RAISE EXCEPTION 'No quantity produced to complete';
    END IF;
    
    BEGIN
        -- Calculate total material cost (from material_issue moves)
        SELECT COALESCE(SUM(total_cost), 0) INTO v_total_material_cost
        FROM stock_moves
        WHERE reference_type = 'manufacturing_order'
        AND reference_id = p_mo_id
        AND move_type = 'material_issue'
        AND status = 'done';
        
        -- Calculate total labor cost
        SELECT COALESCE(SUM(total_amount), 0) INTO v_total_labor_cost
        FROM labor_entries
        WHERE mo_id = p_mo_id;
        
        -- Calculate total overhead cost
        SELECT COALESCE(SUM(total_overhead), 0) INTO v_total_overhead_cost
        FROM overhead_allocations
        WHERE mo_id = p_mo_id;
        
        -- Calculate totals
        v_total_cost := v_total_material_cost + v_total_labor_cost + v_total_overhead_cost;
        v_unit_cost := CASE 
            WHEN v_mo.qty_produced > 0 THEN v_total_cost / v_mo.qty_produced
            ELSE 0
        END;
        
        -- Create production_receipt move (WIP → FG)
        SELECT apply_stock_move(
            v_mo.org_id,
            v_mo.product_id,
            v_mo.location_id, -- From WIP location
            (SELECT id FROM locations WHERE org_id = v_mo.org_id AND usage = 'stock' LIMIT 1), -- To FG stock
            v_mo.qty_produced,
            v_unit_cost,
            'production_receipt',
            'manufacturing_order',
            p_mo_id,
            v_mo.mo_number
        ) INTO v_move_id;
        
        -- Update MO status
        UPDATE manufacturing_orders
        SET status = 'done',
            date_finished = NOW(),
            updated_at = NOW()
        WHERE id = p_mo_id;
        
        -- Build result
        v_result := jsonb_build_object(
            'success', true,
            'mo_id', p_mo_id,
            'mo_number', v_mo.mo_number,
            'product_sku', v_mo.product_sku,
            'product_name', v_mo.product_name,
            'qty_produced', v_mo.qty_produced,
            'costs', jsonb_build_object(
                'material_cost', v_total_material_cost,
                'labor_cost', v_total_labor_cost,
                'overhead_cost', v_total_overhead_cost,
                'total_cost', v_total_cost,
                'unit_cost', v_unit_cost
            ),
            'move_id', v_move_id,
            'completed_at', NOW()
        );
        
        RETURN v_result;
        
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Failed to complete MO: %', SQLERRM;
    END;
END;
$$;

-- Function: Issue materials to MO
CREATE OR REPLACE FUNCTION issue_materials_to_mo(
    p_mo_id UUID,
    p_materials JSONB -- [{"product_id": "...", "quantity": 10.5, "from_location_id": "..."}]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_mo RECORD;
    v_material JSONB;
    v_move_id UUID;
    v_moves UUID[] := ARRAY[]::UUID[];
    v_total_cost DECIMAL(18,6) := 0;
BEGIN
    -- Get MO details
    SELECT * INTO v_mo
    FROM manufacturing_orders
    WHERE id = p_mo_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing Order not found';
    END IF;
    
    IF v_mo.status NOT IN ('confirmed', 'in_progress') THEN
        RAISE EXCEPTION 'Manufacturing Order must be confirmed to issue materials';
    END IF;
    
    -- Process each material
    FOR v_material IN SELECT * FROM jsonb_array_elements(p_materials)
    LOOP
        -- Issue material (RM → WIP)
        SELECT apply_stock_move(
            v_mo.org_id,
            (v_material->>'product_id')::UUID,
            (v_material->>'from_location_id')::UUID,
            v_mo.location_id, -- To WIP location
            -(v_material->>'quantity')::DECIMAL(18,6), -- Negative for issue
            0, -- Unit cost will be determined by AVCO
            'material_issue',
            'manufacturing_order',
            p_mo_id,
            v_mo.mo_number
        ) INTO v_move_id;
        
        v_moves := array_append(v_moves, v_move_id);
    END LOOP;
    
    -- Update MO status if not already in progress
    IF v_mo.status = 'confirmed' THEN
        UPDATE manufacturing_orders
        SET status = 'in_progress',
            date_started = NOW(),
            updated_at = NOW()
        WHERE id = p_mo_id;
    END IF;
    
    -- Calculate total material cost issued
    SELECT COALESCE(SUM(total_cost), 0) INTO v_total_cost
    FROM stock_moves
    WHERE id = ANY(v_moves);
    
    RETURN jsonb_build_object(
        'success', true,
        'mo_id', p_mo_id,
        'moves_created', array_length(v_moves, 1),
        'move_ids', to_jsonb(v_moves),
        'total_material_cost', v_total_cost
    );
END;
$$;