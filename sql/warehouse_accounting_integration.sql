-- ==============================================================================
-- AUTO-CREATE GL ACCOUNTS FOR WAREHOUSES
-- Based on SAP/Oracle/ERPNext Chart of Accounts Structure
-- ==============================================================================

-- ==============================================================================
-- STEP 1: Create Account Structure for Warehouses
-- Each warehouse gets its own set of accounts under parent accounts
-- ==============================================================================

-- Function to create warehouse accounts automatically
CREATE OR REPLACE FUNCTION create_warehouse_accounts(
    p_warehouse_id UUID,
    p_warehouse_code VARCHAR,
    p_warehouse_name VARCHAR,
    p_org_id UUID
)
RETURNS TABLE (
    stock_account_id UUID,
    adjustment_account_id UUID,
    expense_account_id UUID,
    cogs_account_id UUID
) AS $$
DECLARE
    v_stock_account UUID;
    v_adjustment_account UUID;
    v_expense_account UUID;
    v_cogs_account UUID;
    v_stock_parent UUID;
    v_expense_parent UUID;
    v_cogs_parent UUID;
BEGIN
    -- Get parent accounts
    SELECT id INTO v_stock_parent 
    FROM accounts 
    WHERE account_code = '1400' AND tenant_id = p_org_id
    LIMIT 1;
    
    SELECT id INTO v_expense_parent 
    FROM accounts 
    WHERE account_code = '5950' AND tenant_id = p_org_id
    LIMIT 1;
    
    SELECT id INTO v_cogs_parent 
    FROM accounts 
    WHERE account_code = '5000' AND tenant_id = p_org_id
    LIMIT 1;
    
    -- Create Stock Account (1400-XX)
    INSERT INTO accounts (
        tenant_id,
        account_code,
        account_name,
        account_name_ar,
        account_type,
        parent_account_id,
        is_group,
        is_active,
        created_at
    ) VALUES (
        p_org_id,
        '1400-' || p_warehouse_code,
        'Inventory - ' || p_warehouse_name,
        'مخزون - ' || p_warehouse_name,
        'Asset',
        v_stock_parent,
        false,
        true,
        CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_stock_account;
    
    -- Create Stock Adjustment Account (5950-XX)
    INSERT INTO accounts (
        tenant_id,
        account_code,
        account_name,
        account_name_ar,
        account_type,
        parent_account_id,
        is_group,
        is_active,
        created_at
    ) VALUES (
        p_org_id,
        '5950-' || p_warehouse_code,
        'Stock Adjustments - ' || p_warehouse_name,
        'تسويات مخزون - ' || p_warehouse_name,
        'Expense',
        v_expense_parent,
        false,
        true,
        CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_adjustment_account;
    
    -- Create Warehouse Expense Account (5900-XX)
    INSERT INTO accounts (
        tenant_id,
        account_code,
        account_name,
        account_name_ar,
        account_type,
        parent_account_id,
        is_group,
        is_active,
        created_at
    ) VALUES (
        p_org_id,
        '5900-' || p_warehouse_code,
        'Warehouse Expenses - ' || p_warehouse_name,
        'مصروفات مخزن - ' || p_warehouse_name,
        'Expense',
        v_expense_parent,
        false,
        true,
        CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_expense_account;
    
    -- Create COGS Account (5000-XX)
    INSERT INTO accounts (
        tenant_id,
        account_code,
        account_name,
        account_name_ar,
        account_type,
        parent_account_id,
        is_group,
        is_active,
        created_at
    ) VALUES (
        p_org_id,
        '5000-' || p_warehouse_code,
        'Cost of Goods Sold - ' || p_warehouse_name,
        'تكلفة البضاعة المباعة - ' || p_warehouse_name,
        'Expense',
        v_cogs_parent,
        false,
        true,
        CURRENT_TIMESTAMP
    )
    RETURNING id INTO v_cogs_account;
    
    -- Return created account IDs
    RETURN QUERY SELECT v_stock_account, v_adjustment_account, v_expense_account, v_cogs_account;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- STEP 2: Create GL Mapping for All Existing Warehouses
-- ==============================================================================

DO $$
DECLARE
    warehouse_rec RECORD;
    account_ids RECORD;
BEGIN
    FOR warehouse_rec IN 
        SELECT id, code, name, org_id 
        FROM warehouses 
        WHERE inventory_account_id IS NULL  -- Only warehouses without accounts
    LOOP
        -- Create accounts for this warehouse
        SELECT * INTO account_ids
        FROM create_warehouse_accounts(
            warehouse_rec.id,
            warehouse_rec.code,
            warehouse_rec.name,
            warehouse_rec.org_id
        );
        
        -- Update warehouse with account references
        UPDATE warehouses
        SET 
            inventory_account_id = account_ids.stock_account_id,
            expense_account_id = account_ids.adjustment_account_id
        WHERE id = warehouse_rec.id;
        
        -- Create warehouse GL mapping
        INSERT INTO warehouse_gl_mapping (
            warehouse_id,
            org_id,
            stock_account,
            stock_adjustment_account,
            expenses_included_in_valuation,
            default_cogs_account,
            created_at
        ) VALUES (
            warehouse_rec.id,
            warehouse_rec.org_id,
            account_ids.stock_account_id,
            account_ids.adjustment_account_id,
            account_ids.expense_account_id,
            account_ids.cogs_account_id,
            CURRENT_TIMESTAMP
        );
        
        RAISE NOTICE 'Created accounts for warehouse: % (%)', warehouse_rec.name, warehouse_rec.code;
    END LOOP;
END $$;

-- ==============================================================================
-- STEP 3: Trigger to Auto-Create Accounts for New Warehouses
-- ==============================================================================

CREATE OR REPLACE FUNCTION trg_create_warehouse_accounts()
RETURNS TRIGGER AS $$
DECLARE
    account_ids RECORD;
BEGIN
    -- Only create accounts if they don't exist
    IF NEW.inventory_account_id IS NULL THEN
        -- Create accounts
        SELECT * INTO account_ids
        FROM create_warehouse_accounts(
            NEW.id,
            NEW.code,
            NEW.name,
            NEW.org_id
        );
        
        -- Update the NEW record
        NEW.inventory_account_id := account_ids.stock_account_id;
        NEW.expense_account_id := account_ids.adjustment_account_id;
        
        -- Create GL mapping (in AFTER trigger would be better, but this works)
        INSERT INTO warehouse_gl_mapping (
            warehouse_id,
            org_id,
            stock_account,
            stock_adjustment_account,
            expenses_included_in_valuation,
            default_cogs_account,
            created_at
        ) VALUES (
            NEW.id,
            NEW.org_id,
            account_ids.stock_account_id,
            account_ids.adjustment_account_id,
            account_ids.expense_account_id,
            account_ids.cogs_account_id,
            CURRENT_TIMESTAMP
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_auto_create_warehouse_accounts
BEFORE INSERT ON warehouses
FOR EACH ROW
EXECUTE FUNCTION trg_create_warehouse_accounts();

-- ==============================================================================
-- STEP 4: View to See All Warehouse Accounting Setup
-- ==============================================================================

CREATE OR REPLACE VIEW v_warehouse_accounting AS
SELECT 
    w.id as warehouse_id,
    w.code as warehouse_code,
    w.name as warehouse_name,
    w.warehouse_type,
    w.is_active,
    
    -- Stock Account
    sa.account_code as stock_account_code,
    sa.account_name as stock_account_name,
    sa.account_name_ar as stock_account_name_ar,
    
    -- Adjustment Account
    aa.account_code as adjustment_account_code,
    aa.account_name as adjustment_account_name,
    
    -- Expense Account
    ea.account_code as expense_account_code,
    ea.account_name as expense_account_name,
    
    -- GL Mapping Details
    wgl.cost_center,
    wgl.default_cogs_account
    
FROM warehouses w
LEFT JOIN accounts sa ON sa.id = w.inventory_account_id
LEFT JOIN accounts aa ON aa.id = wgl.stock_adjustment_account
LEFT JOIN accounts ea ON ea.id = w.expense_account_id
LEFT JOIN warehouse_gl_mapping wgl ON wgl.warehouse_id = w.id
WHERE w.is_active = true
ORDER BY w.code;

COMMENT ON VIEW v_warehouse_accounting IS 'عرض شامل لربط المخازن بشجرة الحسابات';

-- ==============================================================================
-- COMPLETE! All warehouses now have their own GL accounts
-- ==============================================================================

-- Verify the setup
SELECT 
    warehouse_code,
    warehouse_name,
    stock_account_code,
    adjustment_account_code,
    expense_account_code
FROM v_warehouse_accounting;
