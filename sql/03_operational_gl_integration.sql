-- ===================================================================
-- OPERATIONAL GL INTEGRATION FUNCTIONS
-- Automatic posting of business transactions to General Ledger
-- ===================================================================

-- ===================================================================
-- PURCHASE RECEIPT POSTING TO GL
-- ===================================================================
CREATE OR REPLACE FUNCTION post_purchase_receipt_to_gl(p_receipt_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_receipt RECORD;
    v_line RECORD;
    v_total_amount NUMERIC(18,4) := 0;
    v_lines JSON[] := '{}';
    v_line_json JSON;
    v_result JSON;
    v_tenant_id UUID;
    v_inventory_account_id UUID;
    v_grir_account_id UUID;
    v_description TEXT;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get receipt details
    SELECT gr.*, s.name as supplier_name
    INTO v_receipt
    FROM goods_receipts gr
    LEFT JOIN suppliers s ON gr.supplier_id = s.id
    WHERE gr.id = p_receipt_id AND gr.tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Goods receipt not found or access denied'
        );
    END IF;
    
    -- Check if already posted
    IF EXISTS (
        SELECT 1 FROM journal_entries 
        WHERE reference_type = 'goods_receipt' 
        AND reference_id = p_receipt_id 
        AND tenant_id = v_tenant_id
        AND status IN ('posted', 'draft')
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Goods receipt already has GL posting'
        );
    END IF;
    
    -- Get account mappings
    SELECT id INTO v_inventory_account_id
    FROM accounts 
    WHERE code = '1130' AND tenant_id = v_tenant_id; -- Raw Materials
    
    SELECT id INTO v_grir_account_id
    FROM accounts 
    WHERE code = '2130' AND tenant_id = v_tenant_id; -- GR/IR Clearing
    
    IF v_inventory_account_id IS NULL OR v_grir_account_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Required GL accounts not found (1130, 2130)'
        );
    END IF;
    
    -- Process receipt lines
    FOR v_line IN 
        SELECT 
            grl.*,
            p.name as product_name,
            COALESCE(sm.cost_at_time, p.cost, 0) as unit_cost
        FROM goods_receipt_lines grl
        JOIN products p ON grl.product_id = p.id
        LEFT JOIN stock_movements sm ON grl.id = sm.source_line_id 
            AND sm.movement_type = 'receipt'
        WHERE grl.receipt_id = p_receipt_id 
        AND grl.tenant_id = v_tenant_id
    LOOP
        v_total_amount := v_total_amount + (v_line.quantity_received * v_line.unit_cost);
    END LOOP;
    
    -- Build journal lines
    -- Debit: Inventory (Raw Materials)
    v_line_json := json_build_object(
        'account_id', v_inventory_account_id,
        'debit', v_total_amount,
        'credit', 0,
        'description', 'Goods Receipt - ' || v_receipt.receipt_number,
        'description_ar', 'استلام بضاعة - ' || v_receipt.receipt_number,
        'partner_id', v_receipt.supplier_id
    );
    v_lines := array_append(v_lines, v_line_json);
    
    -- Credit: GR/IR Clearing (until invoice)
    v_line_json := json_build_object(
        'account_id', v_grir_account_id,
        'debit', 0,
        'credit', v_total_amount,
        'description', 'GR/IR Clearing - ' || v_receipt.receipt_number,
        'description_ar', 'تسوية استلام/فوترة - ' || v_receipt.receipt_number,
        'partner_id', v_receipt.supplier_id
    );
    v_lines := array_append(v_lines, v_line_json);
    
    -- Create description
    v_description := 'Goods Receipt from ' || COALESCE(v_receipt.supplier_name, 'Supplier');
    
    -- Create journal entry
    SELECT create_journal_entry(
        'PJ', -- Purchase Journal
        v_receipt.receipt_date::DATE,
        v_description,
        'استلام بضاعة من ' || COALESCE(v_receipt.supplier_name, 'مورد'),
        'goods_receipt',
        p_receipt_id,
        v_receipt.receipt_number,
        array_to_json(v_lines),
        true -- auto_post
    ) INTO v_result;
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to post goods receipt to GL: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- MANUFACTURING ORDER STAGE POSTING TO WIP
-- ===================================================================
CREATE OR REPLACE FUNCTION post_mo_stage_to_wip(
    p_mo_id UUID,
    p_stage_no INTEGER
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_mo RECORD;
    v_stage RECORD;
    v_total_cost NUMERIC(18,4) := 0;
    v_material_cost NUMERIC(18,4) := 0;
    v_labor_cost NUMERIC(18,4) := 0;
    v_overhead_cost NUMERIC(18,4) := 0;
    v_lines JSON[] := '{}';
    v_line_json JSON;
    v_result JSON;
    v_tenant_id UUID;
    v_wip_account_id UUID;
    v_raw_material_account_id UUID;
    v_labor_account_id UUID;
    v_overhead_account_id UUID;
    v_description TEXT;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get manufacturing order details
    SELECT mo.*, p.name as product_name
    INTO v_mo
    FROM manufacturing_orders mo
    LEFT JOIN products p ON mo.product_id = p.id
    WHERE mo.id = p_mo_id AND mo.tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Manufacturing order not found or access denied'
        );
    END IF;
    
    -- Get stage cost details
    SELECT * INTO v_stage
    FROM stage_costs 
    WHERE mo_id = p_mo_id 
    AND stage_number = p_stage_no 
    AND tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Stage cost data not found'
        );
    END IF;
    
    -- Check if stage already posted
    IF EXISTS (
        SELECT 1 FROM journal_entries 
        WHERE reference_type = 'manufacturing_stage' 
        AND reference_id = p_mo_id 
        AND reference_number = v_mo.order_number || '-S' || p_stage_no
        AND tenant_id = v_tenant_id
        AND status IN ('posted', 'draft')
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Stage already posted to GL'
        );
    END IF;
    
    -- Get account mappings
    SELECT id INTO v_wip_account_id FROM accounts WHERE code = '1131' AND tenant_id = v_tenant_id; -- WIP
    SELECT id INTO v_raw_material_account_id FROM accounts WHERE code = '1130' AND tenant_id = v_tenant_id; -- Raw Materials
    SELECT id INTO v_labor_account_id FROM accounts WHERE code = '5210' AND tenant_id = v_tenant_id; -- Direct Labor
    SELECT id INTO v_overhead_account_id FROM accounts WHERE code = '5220' AND tenant_id = v_tenant_id; -- MOH Applied
    
    IF v_wip_account_id IS NULL OR v_raw_material_account_id IS NULL OR 
       v_labor_account_id IS NULL OR v_overhead_account_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Required GL accounts not found (1131, 1130, 5210, 5220)'
        );
    END IF;
    
    -- Calculate costs
    v_material_cost := COALESCE(v_stage.material_cost, 0);
    v_labor_cost := COALESCE(v_stage.labor_cost, 0);
    v_overhead_cost := COALESCE(v_stage.overhead_cost, 0);
    v_total_cost := v_material_cost + v_labor_cost + v_overhead_cost;
    
    IF v_total_cost = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'No costs to post for this stage'
        );
    END IF;
    
    -- Debit: WIP (total cost)
    v_line_json := json_build_object(
        'account_id', v_wip_account_id,
        'debit', v_total_cost,
        'credit', 0,
        'description', 'WIP - Stage ' || p_stage_no || ' - ' || v_mo.order_number,
        'description_ar', 'تحت التشغيل - مرحلة ' || p_stage_no || ' - ' || v_mo.order_number,
        'cost_center_id', v_stage.work_center_id,
        'project_id', p_mo_id
    );
    v_lines := array_append(v_lines, v_line_json);
    
    -- Credit: Raw Materials (if any)
    IF v_material_cost > 0 THEN
        v_line_json := json_build_object(
            'account_id', v_raw_material_account_id,
            'debit', 0,
            'credit', v_material_cost,
            'description', 'Materials - Stage ' || p_stage_no || ' - ' || v_mo.order_number,
            'description_ar', 'مواد - مرحلة ' || p_stage_no || ' - ' || v_mo.order_number,
            'cost_center_id', v_stage.work_center_id,
            'project_id', p_mo_id
        );
        v_lines := array_append(v_lines, v_line_json);
    END IF;
    
    -- Credit: Direct Labor (if any)
    IF v_labor_cost > 0 THEN
        v_line_json := json_build_object(
            'account_id', v_labor_account_id,
            'debit', 0,
            'credit', v_labor_cost,
            'description', 'Labor - Stage ' || p_stage_no || ' - ' || v_mo.order_number,
            'description_ar', 'عمالة - مرحلة ' || p_stage_no || ' - ' || v_mo.order_number,
            'cost_center_id', v_stage.work_center_id,
            'project_id', p_mo_id
        );
        v_lines := array_append(v_lines, v_line_json);
    END IF;
    
    -- Credit: Manufacturing Overhead Applied (if any)
    IF v_overhead_cost > 0 THEN
        v_line_json := json_build_object(
            'account_id', v_overhead_account_id,
            'debit', 0,
            'credit', v_overhead_cost,
            'description', 'MOH Applied - Stage ' || p_stage_no || ' - ' || v_mo.order_number,
            'description_ar', 'أعباء صناعية - مرحلة ' || p_stage_no || ' - ' || v_mo.order_number,
            'cost_center_id', v_stage.work_center_id,
            'project_id', p_mo_id
        );
        v_lines := array_append(v_lines, v_line_json);
    END IF;
    
    -- Create description
    v_description := 'Manufacturing Stage ' || p_stage_no || ' - ' || COALESCE(v_mo.product_name, 'Product') || ' - ' || v_mo.order_number;
    
    -- Create journal entry
    SELECT create_journal_entry(
        'MJ', -- Manufacturing Journal
        CURRENT_DATE,
        v_description,
        'مرحلة تصنيع ' || p_stage_no || ' - ' || COALESCE(v_mo.product_name, 'منتج') || ' - ' || v_mo.order_number,
        'manufacturing_stage',
        p_mo_id,
        v_mo.order_number || '-S' || p_stage_no,
        array_to_json(v_lines),
        true -- auto_post
    ) INTO v_result;
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to post MO stage to GL: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- FINISH MANUFACTURING ORDER TO FINISHED GOODS
-- ===================================================================
CREATE OR REPLACE FUNCTION finish_mo_to_stock(p_mo_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_mo RECORD;
    v_total_wip_cost NUMERIC(18,4) := 0;
    v_lines JSON[] := '{}';
    v_line_json JSON;
    v_result JSON;
    v_tenant_id UUID;
    v_wip_account_id UUID;
    v_finished_goods_account_id UUID;
    v_description TEXT;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get manufacturing order details
    SELECT mo.*, p.name as product_name
    INTO v_mo
    FROM manufacturing_orders mo
    LEFT JOIN products p ON mo.product_id = p.id
    WHERE mo.id = p_mo_id AND mo.tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Manufacturing order not found or access denied'
        );
    END IF;
    
    -- Check if MO is completed
    IF v_mo.status != 'completed' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Manufacturing order must be completed before finishing to stock'
        );
    END IF;
    
    -- Check if already finished to stock
    IF EXISTS (
        SELECT 1 FROM journal_entries 
        WHERE reference_type = 'manufacturing_completion' 
        AND reference_id = p_mo_id 
        AND tenant_id = v_tenant_id
        AND status IN ('posted', 'draft')
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Manufacturing order already finished to stock'
        );
    END IF;
    
    -- Get account mappings
    SELECT id INTO v_wip_account_id FROM accounts WHERE code = '1131' AND tenant_id = v_tenant_id; -- WIP
    SELECT id INTO v_finished_goods_account_id FROM accounts WHERE code = '1132' AND tenant_id = v_tenant_id; -- Finished Goods
    
    IF v_wip_account_id IS NULL OR v_finished_goods_account_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Required GL accounts not found (1131, 1132)'
        );
    END IF;
    
    -- Calculate total WIP cost from all stages
    SELECT COALESCE(SUM(material_cost + labor_cost + overhead_cost), 0)
    INTO v_total_wip_cost
    FROM stage_costs 
    WHERE mo_id = p_mo_id AND tenant_id = v_tenant_id;
    
    IF v_total_wip_cost = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'No WIP cost found for manufacturing order'
        );
    END IF;
    
    -- Debit: Finished Goods
    v_line_json := json_build_object(
        'account_id', v_finished_goods_account_id,
        'debit', v_total_wip_cost,
        'credit', 0,
        'description', 'Finished Goods - ' || v_mo.order_number,
        'description_ar', 'منتجات تامة - ' || v_mo.order_number,
        'product_id', v_mo.product_id,
        'project_id', p_mo_id
    );
    v_lines := array_append(v_lines, v_line_json);
    
    -- Credit: WIP
    v_line_json := json_build_object(
        'account_id', v_wip_account_id,
        'debit', 0,
        'credit', v_total_wip_cost,
        'description', 'WIP Transfer - ' || v_mo.order_number,
        'description_ar', 'نقل تحت التشغيل - ' || v_mo.order_number,
        'product_id', v_mo.product_id,
        'project_id', p_mo_id
    );
    v_lines := array_append(v_lines, v_line_json);
    
    -- Create description
    v_description := 'Manufacturing Completion - ' || COALESCE(v_mo.product_name, 'Product') || ' - ' || v_mo.order_number;
    
    -- Create journal entry
    SELECT create_journal_entry(
        'MJ', -- Manufacturing Journal
        CURRENT_DATE,
        v_description,
        'إتمام تصنيع - ' || COALESCE(v_mo.product_name, 'منتج') || ' - ' || v_mo.order_number,
        'manufacturing_completion',
        p_mo_id,
        v_mo.order_number || '-COMP',
        array_to_json(v_lines),
        true -- auto_post
    ) INTO v_result;
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to finish MO to stock: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- SALES DELIVERY POSTING (COGS)
-- ===================================================================
CREATE OR REPLACE FUNCTION post_sales_delivery_to_gl(p_delivery_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_delivery RECORD;
    v_line RECORD;
    v_total_cogs NUMERIC(18,4) := 0;
    v_total_revenue NUMERIC(18,4) := 0;
    v_lines JSON[] := '{}';
    v_line_json JSON;
    v_result JSON;
    v_tenant_id UUID;
    v_cogs_account_id UUID;
    v_finished_goods_account_id UUID;
    v_receivables_account_id UUID;
    v_revenue_account_id UUID;
    v_description TEXT;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get delivery details
    SELECT d.*, c.name as customer_name
    INTO v_delivery
    FROM deliveries d
    LEFT JOIN customers c ON d.customer_id = c.id
    WHERE d.id = p_delivery_id AND d.tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Delivery not found or access denied'
        );
    END IF;
    
    -- Check if already posted
    IF EXISTS (
        SELECT 1 FROM journal_entries 
        WHERE reference_type = 'sales_delivery' 
        AND reference_id = p_delivery_id 
        AND tenant_id = v_tenant_id
        AND status IN ('posted', 'draft')
    ) THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Sales delivery already has GL posting'
        );
    END IF;
    
    -- Get account mappings
    SELECT id INTO v_cogs_account_id FROM accounts WHERE code = '5100' AND tenant_id = v_tenant_id; -- COGS
    SELECT id INTO v_finished_goods_account_id FROM accounts WHERE code = '1132' AND tenant_id = v_tenant_id; -- Finished Goods
    SELECT id INTO v_receivables_account_id FROM accounts WHERE code = '1120' AND tenant_id = v_tenant_id; -- A/R
    SELECT id INTO v_revenue_account_id FROM accounts WHERE code = '4100' AND tenant_id = v_tenant_id; -- Sales Revenue
    
    IF v_cogs_account_id IS NULL OR v_finished_goods_account_id IS NULL OR 
       v_receivables_account_id IS NULL OR v_revenue_account_id IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Required GL accounts not found (5100, 1132, 1120, 4100)'
        );
    END IF;
    
    -- Process delivery lines for COGS and Revenue
    FOR v_line IN 
        SELECT 
            dl.*,
            p.name as product_name,
            COALESCE(sm.cost_at_time, p.cost, 0) as unit_cost,
            sol.unit_price
        FROM delivery_lines dl
        JOIN products p ON dl.product_id = p.id
        LEFT JOIN stock_movements sm ON dl.id = sm.source_line_id 
            AND sm.movement_type = 'delivery'
        LEFT JOIN sales_order_lines sol ON dl.sales_order_line_id = sol.id
        WHERE dl.delivery_id = p_delivery_id 
        AND dl.tenant_id = v_tenant_id
    LOOP
        v_total_cogs := v_total_cogs + (v_line.quantity_delivered * v_line.unit_cost);
        v_total_revenue := v_total_revenue + (v_line.quantity_delivered * COALESCE(v_line.unit_price, 0));
    END LOOP;
    
    -- COGS Entry: Dr COGS, Cr Finished Goods
    IF v_total_cogs > 0 THEN
        -- Debit: COGS
        v_line_json := json_build_object(
            'account_id', v_cogs_account_id,
            'debit', v_total_cogs,
            'credit', 0,
            'description', 'COGS - ' || v_delivery.delivery_number,
            'description_ar', 'تكلفة البضاعة المباعة - ' || v_delivery.delivery_number,
            'partner_id', v_delivery.customer_id
        );
        v_lines := array_append(v_lines, v_line_json);
        
        -- Credit: Finished Goods
        v_line_json := json_build_object(
            'account_id', v_finished_goods_account_id,
            'debit', 0,
            'credit', v_total_cogs,
            'description', 'Inventory Relief - ' || v_delivery.delivery_number,
            'description_ar', 'تخفيض مخزون - ' || v_delivery.delivery_number,
            'partner_id', v_delivery.customer_id
        );
        v_lines := array_append(v_lines, v_line_json);
    END IF;
    
    -- Revenue Entry: Dr A/R, Cr Sales Revenue (if invoiced)
    IF v_total_revenue > 0 AND v_delivery.invoiced THEN
        -- Debit: Accounts Receivable
        v_line_json := json_build_object(
            'account_id', v_receivables_account_id,
            'debit', v_total_revenue,
            'credit', 0,
            'description', 'Sales Invoice - ' || v_delivery.delivery_number,
            'description_ar', 'فاتورة مبيعات - ' || v_delivery.delivery_number,
            'partner_id', v_delivery.customer_id
        );
        v_lines := array_append(v_lines, v_line_json);
        
        -- Credit: Sales Revenue
        v_line_json := json_build_object(
            'account_id', v_revenue_account_id,
            'debit', 0,
            'credit', v_total_revenue,
            'description', 'Sales Revenue - ' || v_delivery.delivery_number,
            'description_ar', 'إيرادات مبيعات - ' || v_delivery.delivery_number,
            'partner_id', v_delivery.customer_id
        );
        v_lines := array_append(v_lines, v_line_json);
    END IF;
    
    IF array_length(v_lines, 1) = 0 THEN
        RETURN json_build_object(
            'success', false,
            'error', 'No GL entries to post for this delivery'
        );
    END IF;
    
    -- Create description
    v_description := 'Sales Delivery to ' || COALESCE(v_delivery.customer_name, 'Customer') || ' - ' || v_delivery.delivery_number;
    
    -- Create journal entry
    SELECT create_journal_entry(
        'SJ', -- Sales Journal
        v_delivery.delivery_date::DATE,
        v_description,
        'تسليم مبيعات إلى ' || COALESCE(v_delivery.customer_name, 'عميل') || ' - ' || v_delivery.delivery_number,
        'sales_delivery',
        p_delivery_id,
        v_delivery.delivery_number,
        array_to_json(v_lines),
        true -- auto_post
    ) INTO v_result;
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to post sales delivery to GL: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- GET GL POSTING STATUS FOR DOCUMENTS
-- ===================================================================
CREATE OR REPLACE FUNCTION get_gl_posting_status(
    p_reference_type TEXT,
    p_reference_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_entry RECORD;
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    SELECT 
        je.id,
        je.entry_number,
        je.status,
        je.posted_at,
        je.total_debit,
        je.reversed_by_entry_id IS NOT NULL as is_reversed
    INTO v_entry
    FROM journal_entries je
    WHERE je.reference_type = p_reference_type
    AND je.reference_id = p_reference_id
    AND je.tenant_id = v_tenant_id
    ORDER BY je.created_at DESC
    LIMIT 1;
    
    IF FOUND THEN
        RETURN json_build_object(
            'has_gl_posting', true,
            'entry_id', v_entry.id,
            'entry_number', v_entry.entry_number,
            'status', v_entry.status,
            'posted_at', v_entry.posted_at,
            'total_amount', v_entry.total_debit,
            'is_reversed', v_entry.is_reversed
        );
    ELSE
        RETURN json_build_object(
            'has_gl_posting', false
        );
    END IF;
END;
$$;