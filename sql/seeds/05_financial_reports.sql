-- ===================================================================
-- FINANCIAL REPORTS AND ANALYTICS
-- Comprehensive financial reporting with GL integration
-- ===================================================================

-- ===================================================================
-- TRIAL BALANCE FUNCTION
-- ===================================================================
CREATE OR REPLACE FUNCTION get_trial_balance(
    p_as_of_date DATE DEFAULT CURRENT_DATE,
    p_include_zero_balances BOOLEAN DEFAULT false
)
RETURNS TABLE (
    account_id UUID,
    account_code TEXT,
    account_name TEXT,
    account_name_ar TEXT,
    account_type TEXT,
    total_debit NUMERIC(18,4),
    total_credit NUMERIC(18,4),
    balance NUMERIC(18,4),
    debit_balance NUMERIC(18,4),
    credit_balance NUMERIC(18,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    RETURN QUERY
    SELECT 
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.name_ar as account_name_ar,
        a.account_type,
        COALESCE(SUM(jl.debit), 0) as total_debit,
        COALESCE(SUM(jl.credit), 0) as total_credit,
        CASE 
            WHEN a.account_type IN ('asset', 'expense') THEN
                COALESCE(SUM(jl.debit - jl.credit), 0)
            ELSE
                COALESCE(SUM(jl.credit - jl.debit), 0)
        END as balance,
        CASE 
            WHEN a.account_type IN ('asset', 'expense') THEN
                CASE WHEN COALESCE(SUM(jl.debit - jl.credit), 0) >= 0 THEN COALESCE(SUM(jl.debit - jl.credit), 0) ELSE 0 END
            ELSE
                CASE WHEN COALESCE(SUM(jl.credit - jl.debit), 0) < 0 THEN ABS(COALESCE(SUM(jl.credit - jl.debit), 0)) ELSE 0 END
        END as debit_balance,
        CASE 
            WHEN a.account_type IN ('asset', 'expense') THEN
                CASE WHEN COALESCE(SUM(jl.debit - jl.credit), 0) < 0 THEN ABS(COALESCE(SUM(jl.debit - jl.credit), 0)) ELSE 0 END
            ELSE
                CASE WHEN COALESCE(SUM(jl.credit - jl.debit), 0) >= 0 THEN COALESCE(SUM(jl.credit - jl.debit), 0) ELSE 0 END
        END as credit_balance
    FROM accounts a
    LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
    WHERE a.tenant_id = v_tenant_id
    AND a.is_leaf = true
    AND (je.entry_date <= p_as_of_date OR je.entry_date IS NULL)
    AND (je.status = 'posted' OR je.status IS NULL)
    GROUP BY a.id, a.code, a.name, a.name_ar, a.account_type
    HAVING (p_include_zero_balances OR COALESCE(SUM(jl.debit), 0) != 0 OR COALESCE(SUM(jl.credit), 0) != 0)
    ORDER BY a.code;
END;
$$;

-- ===================================================================
-- PROFIT & LOSS STATEMENT
-- ===================================================================
CREATE OR REPLACE FUNCTION get_profit_loss_statement(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    section TEXT,
    account_id UUID,
    account_code TEXT,
    account_name TEXT,
    account_name_ar TEXT,
    amount NUMERIC(18,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    RETURN QUERY
    -- Revenue Section
    SELECT 
        'REVENUE' as section,
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.name_ar as account_name_ar,
        COALESCE(SUM(jl.credit - jl.debit), 0) as amount
    FROM accounts a
    LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
    WHERE a.tenant_id = v_tenant_id
    AND a.account_type = 'revenue'
    AND a.is_leaf = true
    AND je.entry_date BETWEEN p_start_date AND p_end_date
    AND je.status = 'posted'
    GROUP BY a.id, a.code, a.name, a.name_ar
    HAVING COALESCE(SUM(jl.credit - jl.debit), 0) != 0
    
    UNION ALL
    
    -- Cost of Goods Sold Section
    SELECT 
        'COGS' as section,
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.name_ar as account_name_ar,
        COALESCE(SUM(jl.debit - jl.credit), 0) as amount
    FROM accounts a
    LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
    WHERE a.tenant_id = v_tenant_id
    AND a.account_type = 'expense'
    AND a.code LIKE '51%' -- COGS accounts
    AND a.is_leaf = true
    AND je.entry_date BETWEEN p_start_date AND p_end_date
    AND je.status = 'posted'
    GROUP BY a.id, a.code, a.name, a.name_ar
    HAVING COALESCE(SUM(jl.debit - jl.credit), 0) != 0
    
    UNION ALL
    
    -- Operating Expenses Section
    SELECT 
        'OPERATING_EXPENSES' as section,
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.name_ar as account_name_ar,
        COALESCE(SUM(jl.debit - jl.credit), 0) as amount
    FROM accounts a
    LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
    WHERE a.tenant_id = v_tenant_id
    AND a.account_type = 'expense'
    AND a.code NOT LIKE '51%' -- Non-COGS expenses
    AND a.is_leaf = true
    AND je.entry_date BETWEEN p_start_date AND p_end_date
    AND je.status = 'posted'
    GROUP BY a.id, a.code, a.name, a.name_ar
    HAVING COALESCE(SUM(jl.debit - jl.credit), 0) != 0
    
    ORDER BY section, account_code;
END;
$$;

-- ===================================================================
-- BALANCE SHEET
-- ===================================================================
CREATE OR REPLACE FUNCTION get_balance_sheet(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    section TEXT,
    account_id UUID,
    account_code TEXT,
    account_name TEXT,
    account_name_ar TEXT,
    amount NUMERIC(18,4)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    RETURN QUERY
    -- Assets Section
    SELECT 
        'ASSETS' as section,
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.name_ar as account_name_ar,
        COALESCE(SUM(jl.debit - jl.credit), 0) as amount
    FROM accounts a
    LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
    WHERE a.tenant_id = v_tenant_id
    AND a.account_type = 'asset'
    AND a.is_leaf = true
    AND (je.entry_date <= p_as_of_date OR je.entry_date IS NULL)
    AND (je.status = 'posted' OR je.status IS NULL)
    GROUP BY a.id, a.code, a.name, a.name_ar
    HAVING COALESCE(SUM(jl.debit - jl.credit), 0) != 0
    
    UNION ALL
    
    -- Liabilities Section
    SELECT 
        'LIABILITIES' as section,
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.name_ar as account_name_ar,
        COALESCE(SUM(jl.credit - jl.debit), 0) as amount
    FROM accounts a
    LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
    WHERE a.tenant_id = v_tenant_id
    AND a.account_type = 'liability'
    AND a.is_leaf = true
    AND (je.entry_date <= p_as_of_date OR je.entry_date IS NULL)
    AND (je.status = 'posted' OR je.status IS NULL)
    GROUP BY a.id, a.code, a.name, a.name_ar
    HAVING COALESCE(SUM(jl.credit - jl.debit), 0) != 0
    
    UNION ALL
    
    -- Equity Section
    SELECT 
        'EQUITY' as section,
        a.id as account_id,
        a.code as account_code,
        a.name as account_name,
        a.name_ar as account_name_ar,
        COALESCE(SUM(jl.credit - jl.debit), 0) as amount
    FROM accounts a
    LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
    LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
    WHERE a.tenant_id = v_tenant_id
    AND a.account_type = 'equity'
    AND a.is_leaf = true
    AND (je.entry_date <= p_as_of_date OR je.entry_date IS NULL)
    AND (je.status = 'posted' OR je.status IS NULL)
    GROUP BY a.id, a.code, a.name, a.name_ar
    HAVING COALESCE(SUM(jl.credit - jl.debit), 0) != 0
    
    ORDER BY section, account_code;
END;
$$;

-- ===================================================================
-- INVENTORY VALUATION REPORT
-- ===================================================================
CREATE OR REPLACE FUNCTION get_inventory_valuation_report(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    product_id UUID,
    product_code TEXT,
    product_name TEXT,
    category TEXT,
    uom TEXT,
    quantity_on_hand NUMERIC(18,4),
    average_cost NUMERIC(18,4),
    total_value NUMERIC(18,4),
    last_movement_date DATE
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    RETURN QUERY
    SELECT 
        p.id as product_id,
        p.code as product_code,
        p.name as product_name,
        p.category,
        p.uom,
        COALESCE(SUM(
            CASE 
                WHEN sm.movement_type IN ('receipt', 'adjustment_in', 'manufacturing_in') THEN sm.quantity
                WHEN sm.movement_type IN ('delivery', 'adjustment_out', 'manufacturing_out') THEN -sm.quantity
                ELSE 0
            END
        ), 0) as quantity_on_hand,
        COALESCE(AVG(sm.cost_at_time), p.cost) as average_cost,
        COALESCE(SUM(
            CASE 
                WHEN sm.movement_type IN ('receipt', 'adjustment_in', 'manufacturing_in') THEN sm.quantity
                WHEN sm.movement_type IN ('delivery', 'adjustment_out', 'manufacturing_out') THEN -sm.quantity
                ELSE 0
            END
        ), 0) * COALESCE(AVG(sm.cost_at_time), p.cost) as total_value,
        MAX(sm.movement_date) as last_movement_date
    FROM products p
    LEFT JOIN stock_movements sm ON p.id = sm.product_id AND p.tenant_id = sm.tenant_id
    WHERE p.tenant_id = v_tenant_id
    AND (sm.movement_date <= p_as_of_date OR sm.movement_date IS NULL)
    AND p.is_stockable = true
    GROUP BY p.id, p.code, p.name, p.category, p.uom, p.cost
    HAVING COALESCE(SUM(
        CASE 
            WHEN sm.movement_type IN ('receipt', 'adjustment_in', 'manufacturing_in') THEN sm.quantity
            WHEN sm.movement_type IN ('delivery', 'adjustment_out', 'manufacturing_out') THEN -sm.quantity
            ELSE 0
        END
    ), 0) > 0
    ORDER BY p.code;
END;
$$;

-- ===================================================================
-- GL vs INVENTORY RECONCILIATION REPORT
-- ===================================================================
CREATE OR REPLACE FUNCTION get_gl_inventory_reconciliation(p_as_of_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (
    inventory_account_code TEXT,
    inventory_account_name TEXT,
    gl_balance NUMERIC(18,4),
    inventory_value NUMERIC(18,4),
    variance NUMERIC(18,4),
    variance_percentage NUMERIC(10,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    RETURN QUERY
    WITH inventory_gl AS (
        SELECT 
            a.code as account_code,
            a.name as account_name,
            COALESCE(SUM(jl.debit - jl.credit), 0) as gl_balance
        FROM accounts a
        LEFT JOIN journal_lines jl ON a.id = jl.account_id AND a.tenant_id = jl.tenant_id
        LEFT JOIN journal_entries je ON jl.entry_id = je.id AND jl.tenant_id = je.tenant_id
        WHERE a.tenant_id = v_tenant_id
        AND a.code LIKE '113%' -- Inventory accounts
        AND a.is_leaf = true
        AND (je.entry_date <= p_as_of_date OR je.entry_date IS NULL)
        AND (je.status = 'posted' OR je.status IS NULL)
        GROUP BY a.code, a.name
    ),
    inventory_physical AS (
        SELECT 
            CASE 
                WHEN p.is_raw_material THEN '1130'
                WHEN p.is_finished_good THEN '1132'
                ELSE '1131' -- WIP or other
            END as account_code,
            SUM(
                COALESCE(SUM(
                    CASE 
                        WHEN sm.movement_type IN ('receipt', 'adjustment_in', 'manufacturing_in') THEN sm.quantity
                        WHEN sm.movement_type IN ('delivery', 'adjustment_out', 'manufacturing_out') THEN -sm.quantity
                        ELSE 0
                    END
                ), 0) * COALESCE(AVG(sm.cost_at_time), p.cost)
            ) as physical_value
        FROM products p
        LEFT JOIN stock_movements sm ON p.id = sm.product_id AND p.tenant_id = sm.tenant_id
        WHERE p.tenant_id = v_tenant_id
        AND (sm.movement_date <= p_as_of_date OR sm.movement_date IS NULL)
        AND p.is_stockable = true
        GROUP BY CASE 
            WHEN p.is_raw_material THEN '1130'
            WHEN p.is_finished_good THEN '1132'
            ELSE '1131'
        END
    )
    SELECT 
        igl.account_code as inventory_account_code,
        igl.account_name as inventory_account_name,
        igl.gl_balance,
        COALESCE(ip.physical_value, 0) as inventory_value,
        igl.gl_balance - COALESCE(ip.physical_value, 0) as variance,
        CASE 
            WHEN igl.gl_balance != 0 THEN 
                ((igl.gl_balance - COALESCE(ip.physical_value, 0)) / igl.gl_balance * 100)
            ELSE 0
        END as variance_percentage
    FROM inventory_gl igl
    LEFT JOIN inventory_physical ip ON igl.account_code = ip.account_code
    ORDER BY igl.account_code;
END;
$$;

-- ===================================================================
-- MANUFACTURING COST ANALYSIS
-- ===================================================================
CREATE OR REPLACE FUNCTION get_manufacturing_cost_analysis(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    manufacturing_order_id UUID,
    order_number TEXT,
    product_code TEXT,
    product_name TEXT,
    quantity_produced NUMERIC(18,4),
    total_material_cost NUMERIC(18,4),
    total_labor_cost NUMERIC(18,4),
    total_overhead_cost NUMERIC(18,4),
    total_cost NUMERIC(18,4),
    unit_cost NUMERIC(18,4),
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    RETURN QUERY
    SELECT 
        mo.id as manufacturing_order_id,
        mo.order_number,
        p.code as product_code,
        p.name as product_name,
        mo.quantity_produced,
        COALESCE(SUM(sc.material_cost), 0) as total_material_cost,
        COALESCE(SUM(sc.labor_cost), 0) as total_labor_cost,
        COALESCE(SUM(sc.overhead_cost), 0) as total_overhead_cost,
        COALESCE(SUM(sc.material_cost + sc.labor_cost + sc.overhead_cost), 0) as total_cost,
        CASE 
            WHEN mo.quantity_produced > 0 THEN 
                COALESCE(SUM(sc.material_cost + sc.labor_cost + sc.overhead_cost), 0) / mo.quantity_produced
            ELSE 0
        END as unit_cost,
        mo.status
    FROM manufacturing_orders mo
    JOIN products p ON mo.product_id = p.id AND mo.tenant_id = p.tenant_id
    LEFT JOIN stage_costs sc ON mo.id = sc.mo_id AND mo.tenant_id = sc.tenant_id
    WHERE mo.tenant_id = v_tenant_id
    AND mo.actual_start_date BETWEEN p_start_date AND p_end_date
    GROUP BY mo.id, mo.order_number, p.code, p.name, mo.quantity_produced, mo.status
    ORDER BY mo.order_number;
END;
$$;

-- ===================================================================
-- VARIANCE ANALYSIS REPORT
-- ===================================================================
CREATE OR REPLACE FUNCTION get_variance_analysis_report(
    p_start_date DATE,
    p_end_date DATE
)
RETURNS TABLE (
    period_start DATE,
    period_end DATE,
    material_variance NUMERIC(18,4),
    labor_variance NUMERIC(18,4),
    overhead_variance NUMERIC(18,4),
    total_variance NUMERIC(18,4),
    variance_percentage NUMERIC(10,2)
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_tenant_id UUID;
    v_total_production_cost NUMERIC(18,4);
BEGIN
    -- Get tenant context
    v_tenant_id := current_setting('app.current_tenant_id')::UUID;
    
    -- Calculate total production cost for percentage calculation
    SELECT COALESCE(SUM(material_cost + labor_cost + overhead_cost), 0)
    INTO v_total_production_cost
    FROM stage_costs
    WHERE tenant_id = v_tenant_id
    AND created_at::DATE BETWEEN p_start_date AND p_end_date;
    
    RETURN QUERY
    SELECT 
        va.period_start_date as period_start,
        va.period_end_date as period_end,
        va.material_variance,
        va.labor_variance,
        va.overhead_variance,
        va.total_variance,
        CASE 
            WHEN v_total_production_cost > 0 THEN 
                (va.total_variance / v_total_production_cost * 100)
            ELSE 0
        END as variance_percentage
    FROM variance_analysis va
    WHERE va.tenant_id = v_tenant_id
    AND va.period_start_date >= p_start_date 
    AND va.period_end_date <= p_end_date
    ORDER BY va.period_start_date DESC;
END;
$$;