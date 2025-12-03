-- =====================================
-- Transaction Helper Functions
-- =====================================
-- These functions provide transaction support for complex operations

-- =====================================
-- Example: Create Manufacturing Order with Material Reservation
-- =====================================

CREATE OR REPLACE FUNCTION create_mo_with_reservation(
    p_org_id UUID,
    p_mo_data JSONB,
    p_materials JSONB[]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_mo_id UUID;
    v_material JSONB;
    v_reservation_id UUID;
    v_result JSONB;
    v_errors TEXT[] := ARRAY[]::TEXT[];
BEGIN
    -- Start transaction (implicit in function)
    
    -- 1. Create manufacturing order
    INSERT INTO manufacturing_orders (
        org_id,
        mo_number,
        product_id,
        qty_planned,
        status
        -- ... other fields from p_mo_data can be added here
    )
    SELECT
        p_org_id,
        p_mo_data->>'mo_number',
        (p_mo_data->>'product_id')::UUID,
        (p_mo_data->>'qty_planned')::DECIMAL,
        'draft'
    RETURNING id INTO v_mo_id;
    
    -- 2. Reserve materials
    FOREACH v_material IN ARRAY p_materials
    LOOP
        -- Check availability
        IF NOT EXISTS (
            SELECT 1 FROM stock_quants
            WHERE item_id = (v_material->>'item_id')::UUID
            AND org_id = p_org_id
            AND quantity >= (v_material->>'quantity')::DECIMAL
        ) THEN
            v_errors := array_append(
                v_errors,
                format('Insufficient stock for item %s', v_material->>'item_id')
            );
            RAISE EXCEPTION 'Insufficient inventory';
        END IF;
        
        -- Create reservation
        INSERT INTO material_reservations (
            org_id,
            mo_id,
            item_id,
            quantity_reserved,
            status,
            reserved_at
        ) VALUES (
            p_org_id,
            v_mo_id,
            (v_material->>'item_id')::UUID,
            (v_material->>'quantity')::DECIMAL,
            'reserved',
            NOW()
        ) RETURNING id INTO v_reservation_id;
    END LOOP;
    
    -- 3. Return success result
    v_result := jsonb_build_object(
        'success', true,
        'mo_id', v_mo_id,
        'reservations', array_length(p_materials, 1)
    );
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        -- Transaction will automatically rollback
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM,
            'mo_id', v_mo_id
        );
END;
$$;

-- =====================================
-- Example: Consume Materials and Update Inventory
-- =====================================

CREATE OR REPLACE FUNCTION consume_materials_for_mo(
    p_org_id UUID,
    p_mo_id UUID,
    p_consumptions JSONB[]
)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
    v_consumption JSONB;
    v_stock_move_id UUID;
    v_result JSONB;
BEGIN
    -- Start transaction
    
    -- 1. Release reservations
    UPDATE material_reservations
    SET status = 'consumed',
        consumed_at = NOW()
    WHERE mo_id = p_mo_id
    AND org_id = p_org_id
    AND status = 'reserved';
    
    -- 2. Create stock moves
    FOREACH v_consumption IN ARRAY p_consumptions
    LOOP
        INSERT INTO stock_moves (
            org_id,
            item_id,
            move_type,
            quantity,
            unit_cost,
            reference_type,
            reference_id
        ) VALUES (
            p_org_id,
            (v_consumption->>'item_id')::UUID,
            'manufacturing_consume',
            -(v_consumption->>'quantity')::DECIMAL, -- Negative for consumption
            (v_consumption->>'unit_cost')::DECIMAL,
            'manufacturing_order',
            p_mo_id
        ) RETURNING id INTO v_stock_move_id;
    END LOOP;
    
    -- 3. Update stock quants (via trigger or explicit update)
    -- This would typically be handled by a trigger
    
    -- 4. Return success
    RETURN jsonb_build_object(
        'success', true,
        'mo_id', p_mo_id,
        'consumptions', array_length(p_consumptions, 1)
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', SQLERRM
        );
END;
$$;

-- =====================================
-- Helper: Check if transaction can proceed
-- =====================================

CREATE OR REPLACE FUNCTION can_proceed_transaction(
    p_org_id UUID,
    p_operation TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
AS $$
BEGIN
    -- Add any pre-transaction checks here
    -- e.g., check if org is active, user has permission, etc.
    
    RETURN TRUE;
END;
$$;

