-- ===================================================================
-- Wardah ERP - Secure RPC Functions for Process Costing
-- Advanced Manufacturing Operations with Multi-tenant Security
-- ===================================================================

-- ===================================================================
-- 1. SECURITY HELPER FUNCTIONS
-- ===================================================================

-- Extract and validate tenant ID from JWT
CREATE OR REPLACE FUNCTION get_current_tenant_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    tenant_id UUID;
BEGIN
    tenant_id := (auth.jwt() ->> 'tenant_id')::uuid;
    
    IF tenant_id IS NULL THEN
        RAISE EXCEPTION 'No tenant_id found in JWT token';
    END IF;
    
    RETURN tenant_id;
END $$;

-- Validate tenant access for operations
CREATE OR REPLACE FUNCTION validate_tenant_access(p_tenant_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    current_tenant UUID;
BEGIN
    current_tenant := get_current_tenant_id();
    
    IF current_tenant != p_tenant_id THEN
        RAISE EXCEPTION 'Unauthorized access: tenant mismatch';
    END IF;
    
    RETURN TRUE;
END $$;

-- ===================================================================
-- 2. INVENTORY AND AVCO FUNCTIONS
-- ===================================================================

-- Update item average cost using AVCO method
CREATE OR REPLACE FUNCTION update_item_avco(
    p_tenant_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_unit_cost NUMERIC,
    p_move_type TEXT,
    p_reference_type TEXT DEFAULT NULL,
    p_reference_id UUID DEFAULT NULL,
    p_reference_number TEXT DEFAULT NULL
)
RETURNS TABLE(
    new_avg_cost NUMERIC,
    new_running_qty NUMERIC,
    new_running_value NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_current_qty NUMERIC := 0;
    v_current_value NUMERIC := 0;
    v_current_avg NUMERIC := 0;
    v_new_qty NUMERIC;
    v_new_value NUMERIC;
    v_new_avg NUMERIC;
    v_total_cost NUMERIC;
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    -- Get current inventory values
    SELECT 
        COALESCE(stock_quantity, 0),
        COALESCE(stock_quantity * current_avg_cost, 0),
        COALESCE(current_avg_cost, 0)
    INTO v_current_qty, v_current_value, v_current_avg
    FROM items 
    WHERE id = p_item_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found or access denied';
    END IF;
    
    v_total_cost := p_quantity * p_unit_cost;
    
    -- Calculate new values based on move type
    IF p_move_type IN ('purchase', 'receipt', 'adjustment_in', 'production') THEN
        -- Incoming stock - add to inventory
        v_new_qty := v_current_qty + p_quantity;
        v_new_value := v_current_value + v_total_cost;
        
        -- Calculate new average cost
        IF v_new_qty > 0 THEN
            v_new_avg := v_new_value / v_new_qty;
        ELSE
            v_new_avg := 0;
        END IF;
        
    ELSIF p_move_type IN ('issue', 'sale', 'consumption', 'adjustment_out') THEN
        -- Outgoing stock - reduce inventory at current average cost
        IF p_quantity > v_current_qty THEN
            RAISE EXCEPTION 'Insufficient inventory. Available: %, Requested: %', 
                v_current_qty, p_quantity;
        END IF;
        
        v_new_qty := v_current_qty - p_quantity;
        v_new_value := v_current_value - (p_quantity * v_current_avg);
        v_new_avg := CASE 
            WHEN v_new_qty > 0 THEN v_new_value / v_new_qty 
            ELSE 0 
        END;
        
        -- Use current average cost for outgoing transactions
        v_total_cost := p_quantity * v_current_avg;
        
    ELSE
        RAISE EXCEPTION 'Invalid move type: %', p_move_type;
    END IF;
    
    -- Update item record
    UPDATE items 
    SET 
        stock_quantity = v_new_qty,
        current_avg_cost = v_new_avg,
        updated_at = NOW()
    WHERE id = p_item_id AND tenant_id = p_tenant_id;
    
    -- Insert inventory ledger record
    INSERT INTO inventory_ledger (
        item_id, move_type, quantity, unit_cost, total_cost,
        running_quantity, running_value, avg_cost_after,
        reference_type, reference_id, reference_number, tenant_id
    ) VALUES (
        p_item_id, p_move_type, p_quantity, 
        CASE WHEN p_move_type IN ('issue', 'sale', 'consumption', 'adjustment_out') 
             THEN v_current_avg ELSE p_unit_cost END,
        v_total_cost, v_new_qty, v_new_value, v_new_avg,
        p_reference_type, p_reference_id, p_reference_number, p_tenant_id
    );
    
    RETURN QUERY SELECT v_new_avg, v_new_qty, v_new_value;
END $$;

-- ===================================================================
-- 3. MANUFACTURING ORDER FUNCTIONS
-- ===================================================================

-- Create manufacturing order with automatic stage setup
CREATE OR REPLACE FUNCTION create_manufacturing_order(
    p_tenant_id UUID,
    p_item_id UUID,
    p_quantity NUMERIC,
    p_start_date DATE DEFAULT CURRENT_DATE,
    p_due_date DATE DEFAULT NULL
)
RETURNS TABLE(
    mo_id UUID,
    mo_number TEXT,
    stages_created INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_mo_id UUID;
    v_mo_number TEXT;
    v_stage_count INTEGER := 0;
    v_bom_record RECORD;
    v_wc_record RECORD;
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    -- Generate MO number
    v_mo_number := 'MO-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                   LPAD(nextval('mo_number_seq')::TEXT, 4, '0');
    
    -- Create sequence if not exists
    BEGIN
        PERFORM nextval('mo_number_seq');
    EXCEPTION WHEN undefined_table THEN
        CREATE SEQUENCE mo_number_seq START 1;
        v_mo_number := 'MO-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || 
                       LPAD(nextval('mo_number_seq')::TEXT, 4, '0');
    END;
    
    -- Create manufacturing order
    INSERT INTO manufacturing_orders (
        order_number, item_id, quantity, status, start_date, due_date, tenant_id
    ) VALUES (
        v_mo_number, p_item_id, p_quantity, 'pending', p_start_date, p_due_date, p_tenant_id
    ) RETURNING id INTO v_mo_id;
    
    -- Create stage costs based on BOMs and work centers
    FOR v_bom_record IN 
        SELECT b.seq, b.work_center_id
        FROM boms b
        WHERE b.item_id = p_item_id 
          AND b.tenant_id = p_tenant_id 
          AND b.is_active = true
        ORDER BY b.seq
    LOOP
        INSERT INTO stage_costs (
            mo_id, stage_no, work_center_id, status, tenant_id
        ) VALUES (
            v_mo_id, v_bom_record.seq, v_bom_record.work_center_id, 'planning', p_tenant_id
        );
        
        v_stage_count := v_stage_count + 1;
    END LOOP;
    
    -- If no BOMs found, create default stages
    IF v_stage_count = 0 THEN
        FOR v_wc_record IN
            SELECT id, seq
            FROM work_centers
            WHERE tenant_id = p_tenant_id AND is_active = true
            ORDER BY seq
            LIMIT 5
        LOOP
            INSERT INTO stage_costs (
                mo_id, stage_no, work_center_id, status, tenant_id
            ) VALUES (
                v_mo_id, v_wc_record.seq, v_wc_record.id, 'planning', p_tenant_id
            );
            
            v_stage_count := v_stage_count + 1;
        END LOOP;
    END IF;
    
    RETURN QUERY SELECT v_mo_id, v_mo_number, v_stage_count;
END $$;

-- ===================================================================
-- 4. PROCESS COSTING FUNCTIONS
-- ===================================================================

-- Upsert stage cost with automatic calculations
CREATE OR REPLACE FUNCTION upsert_stage_cost(
    p_tenant_id UUID,
    p_mo_id UUID,
    p_stage_no INTEGER,
    p_work_center_id UUID,
    p_good_qty NUMERIC DEFAULT 0,
    p_scrap_qty NUMERIC DEFAULT 0,
    p_dm_cost NUMERIC DEFAULT 0,
    p_mode TEXT DEFAULT 'planning'
)
RETURNS TABLE(
    total_cost NUMERIC,
    unit_cost NUMERIC,
    transferred_in NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_transferred_in NUMERIC := 0;
    v_total_cost NUMERIC := 0;
    v_unit_cost NUMERIC := 0;
    v_prev_stage_cost NUMERIC := 0;
    v_prev_stage_qty NUMERIC := 0;
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    -- Get transferred-in cost from previous stage
    IF p_stage_no > 10 THEN
        SELECT 
            COALESCE(sc.total_cost, 0),
            COALESCE(sc.good_qty, 0)
        INTO v_prev_stage_cost, v_prev_stage_qty
        FROM stage_costs sc
        WHERE sc.mo_id = p_mo_id 
          AND sc.stage_no = (
              SELECT MAX(stage_no) 
              FROM stage_costs 
              WHERE mo_id = p_mo_id 
                AND stage_no < p_stage_no
                AND tenant_id = p_tenant_id
          )
          AND sc.tenant_id = p_tenant_id;
          
        -- Calculate transferred-in cost
        IF v_prev_stage_qty > 0 AND p_good_qty > 0 THEN
            v_transferred_in := (v_prev_stage_cost / v_prev_stage_qty) * p_good_qty;
        END IF;
    END IF;
    
    -- Calculate total cost (DM only allowed in stage 10)
    v_total_cost := v_transferred_in + 
                   CASE WHEN p_stage_no = 10 THEN p_dm_cost ELSE 0 END;
    
    -- Calculate unit cost
    IF p_good_qty > 0 THEN
        v_unit_cost := v_total_cost / p_good_qty;
    END IF;
    
    -- Upsert stage cost record
    INSERT INTO stage_costs (
        mo_id, stage_no, work_center_id, good_qty, scrap_qty,
        transferred_in_cost, direct_materials_cost, total_cost, unit_cost,
        status, tenant_id
    ) VALUES (
        p_mo_id, p_stage_no, p_work_center_id, p_good_qty, p_scrap_qty,
        v_transferred_in, 
        CASE WHEN p_stage_no = 10 THEN p_dm_cost ELSE 0 END,
        v_total_cost, v_unit_cost, p_mode, p_tenant_id
    )
    ON CONFLICT (mo_id, stage_no) 
    DO UPDATE SET
        work_center_id = EXCLUDED.work_center_id,
        good_qty = EXCLUDED.good_qty,
        scrap_qty = EXCLUDED.scrap_qty,
        transferred_in_cost = EXCLUDED.transferred_in_cost,
        direct_materials_cost = EXCLUDED.direct_materials_cost,
        total_cost = EXCLUDED.total_cost,
        unit_cost = EXCLUDED.unit_cost,
        status = EXCLUDED.status,
        updated_at = NOW();
    
    RETURN QUERY SELECT v_total_cost, v_unit_cost, v_transferred_in;
END $$;

-- Apply labor time to stage
CREATE OR REPLACE FUNCTION apply_labor_time(
    p_tenant_id UUID,
    p_mo_id UUID,
    p_stage_no INTEGER,
    p_hours NUMERIC,
    p_hourly_rate NUMERIC,
    p_worker_name TEXT DEFAULT NULL
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_work_center_id UUID;
    v_labor_cost NUMERIC;
    v_total_labor NUMERIC;
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    v_labor_cost := p_hours * p_hourly_rate;
    
    -- Get work center for this stage
    SELECT work_center_id INTO v_work_center_id
    FROM stage_costs
    WHERE mo_id = p_mo_id AND stage_no = p_stage_no AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stage cost record not found';
    END IF;
    
    -- Insert labor time log
    INSERT INTO labor_time_logs (
        mo_id, stage_no, work_center_id, worker_name,
        hours_worked, hourly_rate, work_date, tenant_id
    ) VALUES (
        p_mo_id, p_stage_no, v_work_center_id, p_worker_name,
        p_hours, p_hourly_rate, CURRENT_DATE, p_tenant_id
    );
    
    -- Update stage cost with new labor total
    SELECT COALESCE(SUM(total_cost), 0) INTO v_total_labor
    FROM labor_time_logs
    WHERE mo_id = p_mo_id AND stage_no = p_stage_no AND tenant_id = p_tenant_id;
    
    UPDATE stage_costs
    SET 
        direct_labor_cost = v_total_labor,
        total_cost = transferred_in_cost + direct_materials_cost + v_total_labor + manufacturing_overhead_cost,
        unit_cost = CASE 
            WHEN good_qty > 0 THEN 
                (transferred_in_cost + direct_materials_cost + v_total_labor + manufacturing_overhead_cost) / good_qty
            ELSE 0 
        END,
        updated_at = NOW()
    WHERE mo_id = p_mo_id AND stage_no = p_stage_no AND tenant_id = p_tenant_id;
    
    RETURN v_total_labor;
END $$;

-- Apply manufacturing overhead to stage
CREATE OR REPLACE FUNCTION apply_overhead(
    p_tenant_id UUID,
    p_mo_id UUID,
    p_stage_no INTEGER,
    p_base_qty NUMERIC,
    p_overhead_rate NUMERIC,
    p_basis TEXT DEFAULT 'labor_hours'
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_work_center_id UUID;
    v_overhead_amount NUMERIC;
    v_total_overhead NUMERIC;
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    v_overhead_amount := p_base_qty * p_overhead_rate;
    
    -- Get work center for this stage
    SELECT work_center_id INTO v_work_center_id
    FROM stage_costs
    WHERE mo_id = p_mo_id AND stage_no = p_stage_no AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Stage cost record not found';
    END IF;
    
    -- Insert overhead application record
    INSERT INTO moh_applied (
        mo_id, stage_no, work_center_id, basis,
        base_quantity, overhead_rate, application_date, tenant_id
    ) VALUES (
        p_mo_id, p_stage_no, v_work_center_id, p_basis,
        p_base_qty, p_overhead_rate, CURRENT_DATE, p_tenant_id
    );
    
    -- Update stage cost with new overhead total
    SELECT COALESCE(SUM(applied_amount), 0) INTO v_total_overhead
    FROM moh_applied
    WHERE mo_id = p_mo_id AND stage_no = p_stage_no AND tenant_id = p_tenant_id;
    
    UPDATE stage_costs
    SET 
        manufacturing_overhead_cost = v_total_overhead,
        total_cost = transferred_in_cost + direct_materials_cost + direct_labor_cost + v_total_overhead,
        unit_cost = CASE 
            WHEN good_qty > 0 THEN 
                (transferred_in_cost + direct_materials_cost + direct_labor_cost + v_total_overhead) / good_qty
            ELSE 0 
        END,
        updated_at = NOW()
    WHERE mo_id = p_mo_id AND stage_no = p_stage_no AND tenant_id = p_tenant_id;
    
    RETURN v_total_overhead;
END $$;

-- ===================================================================
-- 5. BOM AND MATERIAL CONSUMPTION FUNCTIONS
-- ===================================================================

-- Consume BOM materials for a stage
CREATE OR REPLACE FUNCTION consume_bom_materials(
    p_tenant_id UUID,
    p_mo_id UUID,
    p_stage_no INTEGER,
    p_quantity NUMERIC
)
RETURNS TABLE(
    item_code TEXT,
    consumed_qty NUMERIC,
    unit_cost NUMERIC,
    total_cost NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item_id UUID;
    v_bom_record RECORD;
    v_consume_qty NUMERIC;
    v_result_record RECORD;
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    -- Get MO item
    SELECT item_id INTO v_item_id
    FROM manufacturing_orders
    WHERE id = p_mo_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing order not found';
    END IF;
    
    -- Process BOM materials for this stage
    FOR v_bom_record IN
        SELECT bl.item_id, bl.quantity, bl.waste_factor, i.code as item_code
        FROM boms b
        JOIN bom_lines bl ON bl.bom_id = b.id
        JOIN items i ON i.id = bl.item_id
        WHERE b.item_id = v_item_id 
          AND b.seq = p_stage_no
          AND b.tenant_id = p_tenant_id
          AND b.is_active = true
        ORDER BY bl.seq
    LOOP
        -- Calculate consumption quantity including waste
        v_consume_qty := v_bom_record.quantity * p_quantity * (1 + v_bom_record.waste_factor);
        
        -- Update inventory using AVCO
        SELECT * INTO v_result_record
        FROM update_item_avco(
            p_tenant_id,
            v_bom_record.item_id,
            v_consume_qty,
            0, -- unit cost will be determined by AVCO
            'consumption',
            'mo',
            p_mo_id,
            (SELECT order_number FROM manufacturing_orders WHERE id = p_mo_id)
        );
        
        -- Return consumption details
        RETURN QUERY 
        SELECT 
            v_bom_record.item_code,
            v_consume_qty,
            (SELECT current_avg_cost FROM items WHERE id = v_bom_record.item_id),
            v_consume_qty * (SELECT current_avg_cost FROM items WHERE id = v_bom_record.item_id);
    END LOOP;
END $$;

-- ===================================================================
-- 6. MANUFACTURING ORDER COMPLETION FUNCTIONS
-- ===================================================================

-- Complete manufacturing order and transfer to finished goods
CREATE OR REPLACE FUNCTION complete_manufacturing_order(
    p_tenant_id UUID,
    p_mo_id UUID,
    p_completed_qty NUMERIC,
    p_scrap_qty NUMERIC DEFAULT 0
)
RETURNS TABLE(
    final_unit_cost NUMERIC,
    total_cost_transferred NUMERIC,
    fg_avg_cost_after NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_item_id UUID;
    v_mo_number TEXT;
    v_final_stage_cost NUMERIC;
    v_final_unit_cost NUMERIC;
    v_transfer_cost NUMERIC;
    v_result_record RECORD;
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    -- Get MO details
    SELECT item_id, order_number INTO v_item_id, v_mo_number
    FROM manufacturing_orders
    WHERE id = p_mo_id AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Manufacturing order not found';
    END IF;
    
    -- Get final stage costs
    SELECT total_cost, unit_cost 
    INTO v_final_stage_cost, v_final_unit_cost
    FROM stage_costs
    WHERE mo_id = p_mo_id 
      AND stage_no = (SELECT MAX(stage_no) FROM stage_costs WHERE mo_id = p_mo_id)
      AND tenant_id = p_tenant_id;
    
    IF NOT FOUND THEN
        RAISE EXCEPTION 'No stage costs found for manufacturing order';
    END IF;
    
    -- Calculate transfer cost
    v_transfer_cost := v_final_unit_cost * p_completed_qty;
    
    -- Transfer to finished goods inventory
    SELECT * INTO v_result_record
    FROM update_item_avco(
        p_tenant_id,
        v_item_id,
        p_completed_qty,
        v_final_unit_cost,
        'production',
        'mo',
        p_mo_id,
        v_mo_number
    );
    
    -- Update manufacturing order
    UPDATE manufacturing_orders
    SET 
        status = 'completed',
        completed_quantity = p_completed_qty,
        scrap_quantity = p_scrap_qty,
        total_cost = v_final_stage_cost,
        unit_cost = v_final_unit_cost,
        completed_date = CURRENT_DATE,
        updated_at = NOW()
    WHERE id = p_mo_id AND tenant_id = p_tenant_id;
    
    RETURN QUERY 
    SELECT 
        v_final_unit_cost,
        v_transfer_cost,
        v_result_record.new_avg_cost;
END $$;

-- ===================================================================
-- 7. UTILITY AND REPORTING FUNCTIONS
-- ===================================================================

-- Get complete stage costing summary for an MO
CREATE OR REPLACE FUNCTION get_mo_stage_summary(
    p_tenant_id UUID,
    p_mo_id UUID
)
RETURNS TABLE(
    stage_no INTEGER,
    work_center_name TEXT,
    good_qty NUMERIC,
    transferred_in NUMERIC,
    direct_materials NUMERIC,
    direct_labor NUMERIC,
    manufacturing_overhead NUMERIC,
    total_cost NUMERIC,
    unit_cost NUMERIC,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    RETURN QUERY
    SELECT 
        sc.stage_no,
        wc.name as work_center_name,
        sc.good_qty,
        sc.transferred_in_cost,
        sc.direct_materials_cost,
        sc.direct_labor_cost,
        sc.manufacturing_overhead_cost,
        sc.total_cost,
        sc.unit_cost,
        sc.status
    FROM stage_costs sc
    JOIN work_centers wc ON wc.id = sc.work_center_id
    WHERE sc.mo_id = p_mo_id 
      AND sc.tenant_id = p_tenant_id
    ORDER BY sc.stage_no;
END $$;

-- Get item AVCO history
CREATE OR REPLACE FUNCTION get_item_avco_history(
    p_tenant_id UUID,
    p_item_id UUID,
    p_days_back INTEGER DEFAULT 30
)
RETURNS TABLE(
    transaction_date TIMESTAMPTZ,
    move_type TEXT,
    quantity NUMERIC,
    unit_cost NUMERIC,
    total_cost NUMERIC,
    running_quantity NUMERIC,
    avg_cost_after NUMERIC,
    reference_number TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Security check
    PERFORM validate_tenant_access(p_tenant_id);
    
    RETURN QUERY
    SELECT 
        il.transaction_date,
        il.move_type,
        il.quantity,
        il.unit_cost,
        il.total_cost,
        il.running_quantity,
        il.avg_cost_after,
        il.reference_number
    FROM inventory_ledger il
    WHERE il.item_id = p_item_id 
      AND il.tenant_id = p_tenant_id
      AND il.transaction_date >= (NOW() - INTERVAL '%s days', p_days_back)
    ORDER BY il.transaction_date DESC, il.created_at DESC;
END $$;