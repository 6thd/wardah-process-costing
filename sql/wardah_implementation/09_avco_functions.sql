-- =======================================
-- Wardah ERP - AVCO & Manufacturing Functions
-- Production-Ready Process Costing Functions
-- =======================================

-- =======================================
-- 1. AVCO INVENTORY FUNCTIONS
-- =======================================

-- Function: Apply stock move with AVCO calculation
CREATE OR REPLACE FUNCTION apply_stock_move(
    p_org_id UUID,
    p_product_id UUID,
    p_from_location_id UUID,
    p_to_location_id UUID,
    p_quantity DECIMAL(18,6),
    p_unit_cost_in DECIMAL(18,6),
    p_move_type VARCHAR(50),
    p_reference_type VARCHAR(50) DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_reference_number VARCHAR(100) DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
    v_move_id UUID;
    v_from_quant RECORD;
    v_to_quant RECORD;
    v_unit_cost_out DECIMAL(18,6) := 0;
    v_settings RECORD;
    v_new_avg_cost DECIMAL(18,6);
    v_new_qty DECIMAL(18,6);
BEGIN
    -- Validate inputs
    IF p_quantity = 0 THEN
        RAISE EXCEPTION 'Stock move quantity cannot be zero';
    END IF;
    
    -- Get cost settings
    SELECT * INTO v_settings 
    FROM cost_settings 
    WHERE org_id = p_org_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Cost settings not found for organization';
    END IF;
    
    -- Start transaction
    BEGIN
        -- Lock and get FROM location quant if exists
        IF p_from_location_id IS NOT NULL THEN
            SELECT * INTO v_from_quant
            FROM stock_quants 
            WHERE org_id = p_org_id 
            AND product_id = p_product_id 
            AND location_id = p_from_location_id
            FOR UPDATE;
            
            -- Check negative stock policy
            IF FOUND THEN
                IF v_from_quant.onhand_qty + p_quantity < 0 AND NOT v_settings.allow_negative_qty THEN
                    RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: %', 
                        v_from_quant.onhand_qty, ABS(p_quantity);
                END IF;
                
                -- Use AVCO cost for outgoing
                v_unit_cost_out := v_from_quant.avg_cost;
            ELSE
                -- Create new quant record for negative stock if allowed
                IF v_settings.allow_negative_qty THEN
                    INSERT INTO stock_quants (org_id, product_id, location_id, onhand_qty, avg_cost)
                    VALUES (p_org_id, p_product_id, p_from_location_id, 0, 0);
                    v_unit_cost_out := 0;
                ELSE
                    RAISE EXCEPTION 'No stock available for product at location';
                END IF;
            END IF;
        END IF;
        
        -- Lock and get TO location quant if exists
        IF p_to_location_id IS NOT NULL THEN
            SELECT * INTO v_to_quant
            FROM stock_quants 
            WHERE org_id = p_org_id 
            AND product_id = p_product_id 
            AND location_id = p_to_location_id
            FOR UPDATE;
        END IF;
        
        -- Create stock move record
        INSERT INTO stock_moves (
            org_id, product_id, quantity, 
            from_location_id, to_location_id,
            move_type, unit_cost_in, unit_cost_out,
            reference_type, reference_id, reference_number,
            status, date_done
        ) VALUES (
            p_org_id, p_product_id, ABS(p_quantity),
            p_from_location_id, p_to_location_id,
            p_move_type, p_unit_cost_in, v_unit_cost_out,
            p_reference_type, p_reference_id, p_reference_number,
            'done', NOW()
        ) RETURNING id INTO v_move_id;
        
        -- Update FROM location (decrease quantity)
        IF p_from_location_id IS NOT NULL AND p_quantity < 0 THEN
            UPDATE stock_quants 
            SET onhand_qty = onhand_qty + p_quantity,
                last_updated = NOW()
            WHERE org_id = p_org_id 
            AND product_id = p_product_id 
            AND location_id = p_from_location_id;
        END IF;
        
        -- Update TO location (increase quantity with AVCO)
        IF p_to_location_id IS NOT NULL AND p_quantity > 0 THEN
            IF v_to_quant.id IS NOT NULL THEN
                -- Calculate new AVCO
                v_new_qty := v_to_quant.onhand_qty + p_quantity;
                
                IF v_new_qty > 0 THEN
                    v_new_avg_cost := (
                        (v_to_quant.onhand_qty * v_to_quant.avg_cost) + 
                        (p_quantity * p_unit_cost_in)
                    ) / v_new_qty;
                ELSE
                    v_new_avg_cost := p_unit_cost_in;
                END IF;
                
                -- Update existing quant
                UPDATE stock_quants 
                SET onhand_qty = v_new_qty,
                    avg_cost = ROUND(v_new_avg_cost, v_settings.avg_cost_precision),
                    last_updated = NOW()
                WHERE id = v_to_quant.id;
            ELSE
                -- Create new quant
                INSERT INTO stock_quants (
                    org_id, product_id, location_id, 
                    onhand_qty, avg_cost, last_updated
                ) VALUES (
                    p_org_id, p_product_id, p_to_location_id,
                    p_quantity, p_unit_cost_in, NOW()
                );
            END IF;
        END IF;
        
        RETURN v_move_id;
        
    EXCEPTION
        WHEN OTHERS THEN
            RAISE EXCEPTION 'Stock move failed: %', SQLERRM;
    END;
END;
$$;