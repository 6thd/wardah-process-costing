-- ===================================================================
-- PERIOD CLOSING AND VARIANCE ANALYSIS
-- Advanced period-end processes with WIP reconciliation and variance analysis
-- ===================================================================

-- ===================================================================
-- PERIOD CLOSING FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION close_accounting_period(p_period_id UUID)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_period RECORD;
    v_wip_total NUMERIC(18,4) := 0;
    v_variance_total NUMERIC(18,4) := 0;
    v_inventory_gl_diff NUMERIC(18,4) := 0;
    v_tenant_id UUID;
    v_result JSON;
    v_entry_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get period details
    SELECT * INTO v_period
    FROM accounting_periods 
    WHERE id = p_period_id AND tenant_id = v_tenant_id;
    
    IF NOT FOUND THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Accounting period not found or access denied'
        );
    END IF;
    
    -- Check if period is already closed
    IF v_period.status != 'open' THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Period is not open for closing'
        );
    END IF;
    
    -- 1. Calculate remaining WIP costs
    SELECT COALESCE(SUM(material_cost + labor_cost + overhead_cost), 0)
    INTO v_wip_total
    FROM stage_costs sc
    WHERE sc.tenant_id = v_tenant_id
    AND EXISTS (
        SELECT 1 FROM manufacturing_orders mo 
        WHERE mo.id = sc.mo_id 
        AND mo.status IN ('confirmed', 'in_progress')
        AND mo.tenant_id = v_tenant_id
    );
    
    -- 2. Calculate manufacturing variances
    SELECT calculate_manufacturing_variances(v_period.start_date, v_period.end_date) INTO v_variance_total;
    
    -- 3. Inventory-GL reconciliation
    SELECT calculate_inventory_gl_variance(v_period.end_date) INTO v_inventory_gl_diff;
    
    -- 4. Create closing journal entries if needed
    IF v_variance_total != 0 OR v_inventory_gl_diff != 0 THEN
        SELECT create_period_closing_entries(
            p_period_id,
            v_variance_total,
            v_inventory_gl_diff
        ) INTO v_result;
        
        IF (v_result->>'success')::BOOLEAN = false THEN
            RETURN v_result;
        END IF;
    END IF;
    
    -- 5. Update period status
    UPDATE accounting_periods SET
        status = 'closed',
        updated_at = CURRENT_TIMESTAMP,
        updated_by = current_setting('app.current_user_id', true)::UUID
    WHERE id = p_period_id AND tenant_id = v_tenant_id;
    
    -- Return summary
    v_result := json_build_object(
        'success', true,
        'message', 'Period closed successfully',
        'period_id', p_period_id,
        'period_code', v_period.period_code,
        'summary', json_build_object(
            'remaining_wip', v_wip_total,
            'total_variances', v_variance_total,
            'inventory_adjustment', v_inventory_gl_diff,
            'closed_at', CURRENT_TIMESTAMP
        )
    );
    
    RETURN v_result;
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Period closing failed: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- MANUFACTURING VARIANCE CALCULATION
-- ===================================================================
CREATE OR REPLACE FUNCTION calculate_manufacturing_variances(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS NUMERIC(18,4)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_material_variance NUMERIC(18,4) := 0;
    v_labor_variance NUMERIC(18,4) := 0;
    v_overhead_variance NUMERIC(18,4) := 0;
    v_total_variance NUMERIC(18,4) := 0;
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Material Price Variance (Actual vs Standard)
    -- This would be calculated based on standard costs vs actual costs
    -- For now, we'll calculate a simple efficiency variance
    
    -- Material Usage Variance
    SELECT COALESCE(SUM(
        (sc.material_cost - (sc.good_quantity * wc.standard_material_rate))
    ), 0)
    INTO v_material_variance
    FROM stage_costs sc
    JOIN work_centers wc ON sc.work_center_id = wc.id
    WHERE sc.tenant_id = v_tenant_id
    AND sc.created_at::DATE BETWEEN p_start_date AND p_end_date;
    
    -- Labor Efficiency Variance
    SELECT COALESCE(SUM(
        (sc.labor_cost - (sc.good_quantity * wc.standard_labor_rate))
    ), 0)
    INTO v_labor_variance
    FROM stage_costs sc
    JOIN work_centers wc ON sc.work_center_id = wc.id
    WHERE sc.tenant_id = v_tenant_id
    AND sc.created_at::DATE BETWEEN p_start_date AND p_end_date;
    
    -- Overhead Variance (Applied vs Actual)
    SELECT COALESCE(SUM(
        (sc.overhead_cost - (sc.good_quantity * wc.standard_overhead_rate))
    ), 0)
    INTO v_overhead_variance
    FROM stage_costs sc
    JOIN work_centers wc ON sc.work_center_id = wc.id
    WHERE sc.tenant_id = v_tenant_id
    AND sc.created_at::DATE BETWEEN p_start_date AND p_end_date;
    
    v_total_variance := v_material_variance + v_labor_variance + v_overhead_variance;
    
    -- Store variance analysis for reporting
    INSERT INTO variance_analysis (
        period_start_date, period_end_date,
        material_variance, labor_variance, overhead_variance, total_variance,
        tenant_id, created_at, created_by
    ) VALUES (
        p_start_date, p_end_date,
        v_material_variance, v_labor_variance, v_overhead_variance, v_total_variance,
        v_tenant_id, CURRENT_TIMESTAMP, current_setting('app.current_user_id', true)::UUID
    );
    
    RETURN v_total_variance;
END;
$$;

-- ===================================================================
-- INVENTORY-GL RECONCILIATION
-- ===================================================================
CREATE OR REPLACE FUNCTION calculate_inventory_gl_variance(p_as_of_date DATE)
RETURNS NUMERIC(18,4)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_inventory_value NUMERIC(18,4) := 0;
    v_gl_inventory_balance NUMERIC(18,4) := 0;
    v_variance NUMERIC(18,4) := 0;
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Calculate total inventory value from stock movements
    SELECT COALESCE(SUM(sm.quantity_on_hand * sm.cost_at_time), 0)
    INTO v_inventory_value
    FROM stock_movements sm
    WHERE sm.tenant_id = v_tenant_id
    AND sm.movement_date <= p_as_of_date
    AND sm.quantity_on_hand > 0;
    
    -- Get GL inventory balance (sum of all inventory accounts)
    SELECT COALESCE(SUM(
        CASE 
            WHEN a.account_type = 'asset' THEN
                COALESCE(SUM(jl.debit - jl.credit), 0)
            ELSE 0
        END
    ), 0)
    INTO v_gl_inventory_balance
    FROM accounts a
    LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
    WHERE a.tenant_id = v_tenant_id
    AND a.code LIKE '113%' -- Inventory accounts (1130, 1131, 1132)
    AND (je.entry_date <= p_as_of_date OR je.entry_date IS NULL)
    AND (je.status = 'posted' OR je.status IS NULL)
    GROUP BY a.id, a.account_type;
    
    v_variance := v_inventory_value - v_gl_inventory_balance;
    
    RETURN v_variance;
END;
$$;

-- ===================================================================
-- CREATE PERIOD CLOSING ENTRIES
-- ===================================================================
CREATE OR REPLACE FUNCTION create_period_closing_entries(
    p_period_id UUID,
    p_variance_total NUMERIC(18,4),
    p_inventory_adjustment NUMERIC(18,4)
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_lines JSON[] := '{}';
    v_line_json JSON;
    v_result JSON;
    v_tenant_id UUID;
    v_period_code TEXT;
    v_variance_account_id UUID;
    v_inventory_account_id UUID;
    v_adjustment_account_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Get period code
    SELECT period_code INTO v_period_code
    FROM accounting_periods 
    WHERE id = p_period_id AND tenant_id = v_tenant_id;
    
    -- Get account IDs
    SELECT id INTO v_variance_account_id FROM accounts WHERE code = '5900' AND tenant_id = v_tenant_id; -- Manufacturing Variances
    SELECT id INTO v_inventory_account_id FROM accounts WHERE code = '1130' AND tenant_id = v_tenant_id; -- Raw Materials
    SELECT id INTO v_adjustment_account_id FROM accounts WHERE code = '5950' AND tenant_id = v_tenant_id; -- Inventory Adjustments
    
    -- Create variance entry if needed
    IF p_variance_total != 0 AND v_variance_account_id IS NOT NULL THEN
        v_lines := '{}'; -- Reset array
        
        IF p_variance_total > 0 THEN
            -- Unfavorable variance - debit variance account
            v_line_json := json_build_object(
                'account_id', v_variance_account_id,
                'debit', p_variance_total,
                'credit', 0,
                'description', 'Manufacturing Variances - ' || v_period_code,
                'description_ar', 'انحرافات التصنيع - ' || v_period_code
            );
            v_lines := array_append(v_lines, v_line_json);
            
            -- Credit WIP or appropriate account
            v_line_json := json_build_object(
                'account_id', (SELECT id FROM accounts WHERE code = '1131' AND tenant_id = v_tenant_id),
                'debit', 0,
                'credit', p_variance_total,
                'description', 'WIP Variance Adjustment - ' || v_period_code,
                'description_ar', 'تسوية انحراف تحت التشغيل - ' || v_period_code
            );
            v_lines := array_append(v_lines, v_line_json);
        ELSE
            -- Favorable variance - credit variance account
            v_line_json := json_build_object(
                'account_id', v_variance_account_id,
                'debit', 0,
                'credit', ABS(p_variance_total),
                'description', 'Manufacturing Variances - ' || v_period_code,
                'description_ar', 'انحرافات التصنيع - ' || v_period_code
            );
            v_lines := array_append(v_lines, v_line_json);
            
            -- Debit WIP or appropriate account
            v_line_json := json_build_object(
                'account_id', (SELECT id FROM accounts WHERE code = '1131' AND tenant_id = v_tenant_id),
                'debit', ABS(p_variance_total),
                'credit', 0,
                'description', 'WIP Variance Adjustment - ' || v_period_code,
                'description_ar', 'تسوية انحراف تحت التشغيل - ' || v_period_code
            );
            v_lines := array_append(v_lines, v_line_json);
        END IF;
        
        -- Create variance journal entry
        SELECT create_journal_entry(
            'GJ', -- General Journal
            CURRENT_DATE,
            'Period Closing - Manufacturing Variances - ' || v_period_code,
            'إقفال فترة - انحرافات التصنيع - ' || v_period_code,
            'period_closing_variances',
            p_period_id,
            'CLOSE-VAR-' || v_period_code,
            array_to_json(v_lines),
            true -- auto_post
        ) INTO v_result;
        
        IF (v_result->>'success')::BOOLEAN = false THEN
            RETURN v_result;
        END IF;
    END IF;
    
    -- Create inventory adjustment entry if needed
    IF p_inventory_adjustment != 0 AND v_inventory_account_id IS NOT NULL AND v_adjustment_account_id IS NOT NULL THEN
        v_lines := '{}'; -- Reset array
        
        IF p_inventory_adjustment > 0 THEN
            -- Inventory is higher than GL - credit adjustment
            v_line_json := json_build_object(
                'account_id', v_inventory_account_id,
                'debit', p_inventory_adjustment,
                'credit', 0,
                'description', 'Inventory Reconciliation - ' || v_period_code,
                'description_ar', 'تسوية المخزون - ' || v_period_code
            );
            v_lines := array_append(v_lines, v_line_json);
            
            v_line_json := json_build_object(
                'account_id', v_adjustment_account_id,
                'debit', 0,
                'credit', p_inventory_adjustment,
                'description', 'Inventory Adjustment - ' || v_period_code,
                'description_ar', 'تسوية المخزون - ' || v_period_code
            );
            v_lines := array_append(v_lines, v_line_json);
        ELSE
            -- Inventory is lower than GL - debit adjustment
            v_line_json := json_build_object(
                'account_id', v_adjustment_account_id,
                'debit', ABS(p_inventory_adjustment),
                'credit', 0,
                'description', 'Inventory Adjustment - ' || v_period_code,
                'description_ar', 'تسوية المخزون - ' || v_period_code
            );
            v_lines := array_append(v_lines, v_line_json);
            
            v_line_json := json_build_object(
                'account_id', v_inventory_account_id,
                'debit', 0,
                'credit', ABS(p_inventory_adjustment),
                'description', 'Inventory Reconciliation - ' || v_period_code,
                'description_ar', 'تسوية المخزون - ' || v_period_code
            );
            v_lines := array_append(v_lines, v_line_json);
        END IF;
        
        -- Create inventory adjustment journal entry
        SELECT create_journal_entry(
            'GJ', -- General Journal
            CURRENT_DATE,
            'Period Closing - Inventory Reconciliation - ' || v_period_code,
            'إقفال فترة - تسوية المخزون - ' || v_period_code,
            'period_closing_inventory',
            p_period_id,
            'CLOSE-INV-' || v_period_code,
            array_to_json(v_lines),
            true -- auto_post
        ) INTO v_result;
        
        IF (v_result->>'success')::BOOLEAN = false THEN
            RETURN v_result;
        END IF;
    END IF;
    
    RETURN json_build_object(
        'success', true,
        'message', 'Period closing entries created successfully'
    );
    
EXCEPTION
    WHEN OTHERS THEN
        RETURN json_build_object(
            'success', false,
            'error', 'Failed to create period closing entries: ' || SQLERRM
        );
END;
$$;

-- ===================================================================
-- VARIANCE ANALYSIS TABLE
-- ===================================================================
CREATE TABLE IF NOT EXISTS variance_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    period_start_date DATE NOT NULL,
    period_end_date DATE NOT NULL,
    
    -- Variance amounts
    material_variance NUMERIC(18,4) DEFAULT 0,
    labor_variance NUMERIC(18,4) DEFAULT 0,
    overhead_variance NUMERIC(18,4) DEFAULT 0,
    total_variance NUMERIC(18,4) DEFAULT 0,
    
    -- Breakdown details (JSON for flexibility)
    variance_details JSON,
    
    -- Audit fields
    tenant_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_by UUID,
    updated_by UUID
);

-- Index for performance
CREATE INDEX idx_variance_analysis_tenant_dates ON variance_analysis(tenant_id, period_start_date, period_end_date);

-- RLS
ALTER TABLE variance_analysis ENABLE ROW LEVEL SECURITY;

CREATE POLICY variance_analysis_tenant_isolation ON variance_analysis
    FOR ALL USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- ===================================================================
-- ADD MISSING ACCOUNTS FOR PERIOD CLOSING
-- ===================================================================
INSERT INTO accounts (tenant_id, code, name, name_ar, account_type, account_subtype, is_leaf) VALUES
('00000000-0000-0000-0000-000000000001', '5900', 'Manufacturing Variances', 'انحرافات التصنيع', 'expense', 'VARIANCE', true),
('00000000-0000-0000-0000-000000000001', '5950', 'Inventory Adjustments', 'تسويات المخزون', 'expense', 'ADJUSTMENT', true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- ===================================================================
-- WORK CENTER STANDARD RATES (for variance calculation)
-- ===================================================================
ALTER TABLE work_centers ADD COLUMN IF NOT EXISTS standard_material_rate NUMERIC(18,4) DEFAULT 0;
ALTER TABLE work_centers ADD COLUMN IF NOT EXISTS standard_labor_rate NUMERIC(18,4) DEFAULT 0;
ALTER TABLE work_centers ADD COLUMN IF NOT EXISTS standard_overhead_rate NUMERIC(18,4) DEFAULT 0;