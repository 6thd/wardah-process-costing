-- ==============================================================================
-- WAREHOUSE ACCOUNTING INTEGRATION - MANUAL ACCOUNT SELECTION
-- Allow users to manually select GL accounts for each warehouse
-- ==============================================================================

-- ==============================================================================
-- STEP 1: Helper Function to Get Available Accounts by Type
-- ==============================================================================

CREATE OR REPLACE FUNCTION get_accounts_by_type(
    p_org_id UUID,
    p_account_type TEXT
)
RETURNS TABLE (
    id UUID,
    account_code TEXT,
    account_name TEXT,
    account_name_ar TEXT,
    parent_account_id UUID,
    is_group BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.account_code,
        a.account_name,
        a.account_name_ar,
        a.parent_account_id,
        a.is_group
    FROM accounts a
    WHERE a.tenant_id = p_org_id
    AND a.account_type = p_account_type
    AND a.is_active
    AND NOT a.is_group  -- Only leaf accounts
    ORDER BY a.account_code ASC;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- STEP 2: View for Warehouse with Account Details
-- ==============================================================================

CREATE OR REPLACE VIEW v_warehouse_accounting AS
SELECT 
    w.id as warehouse_id,
    w.code as warehouse_code,
    w.name as warehouse_name,
    w.name_ar as warehouse_name_ar,
    w.warehouse_type,
    w.is_active,
    w.org_id,
    
    -- Stock Account (Asset - 1400 series)
    sa.id as stock_account_id,
    sa.account_code as stock_account_code,
    sa.account_name as stock_account_name,
    sa.account_name_ar as stock_account_name_ar,
    
    -- Expense Account (5900/5950 series)
    ea.id as expense_account_id,
    ea.account_code as expense_account_code,
    ea.account_name as expense_account_name,
    ea.account_name_ar as expense_account_name_ar,
    
    -- GL Mapping Details
    wgl.stock_adjustment_account,
    wgl.expenses_included_in_valuation,
    wgl.default_cogs_account,
    wgl.cost_center,
    
    -- Get account names for GL mapping
    adj_acc.account_code as adjustment_account_code,
    adj_acc.account_name as adjustment_account_name,
    cogs_acc.account_code as cogs_account_code,
    cogs_acc.account_name as cogs_account_name
    
FROM warehouses w
LEFT JOIN accounts sa ON sa.id = w.inventory_account_id
LEFT JOIN accounts ea ON ea.id = w.expense_account_id
LEFT JOIN warehouse_gl_mapping wgl ON wgl.warehouse_id = w.id
LEFT JOIN accounts adj_acc ON adj_acc.id = wgl.stock_adjustment_account
LEFT JOIN accounts cogs_acc ON cogs_acc.id = wgl.default_cogs_account
ORDER BY w.code ASC;

COMMENT ON VIEW v_warehouse_accounting IS 'عرض شامل للمخازن مع تفاصيل الربط المحاسبي';

-- ==============================================================================
-- STEP 3: Function to Update Warehouse GL Mapping
-- ==============================================================================

CREATE OR REPLACE FUNCTION update_warehouse_gl_mapping(
    p_warehouse_id UUID,
    p_org_id UUID,
    p_stock_account UUID DEFAULT NULL,
    p_stock_adjustment_account UUID DEFAULT NULL,
    p_expense_account UUID DEFAULT NULL,
    p_cogs_account UUID DEFAULT NULL,
    p_cost_center UUID DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
    -- Update warehouse main accounts
    UPDATE warehouses
    SET 
        inventory_account_id = COALESCE(p_stock_account, inventory_account_id),
        expense_account_id = COALESCE(p_expense_account, expense_account_id),
        cost_center_id = COALESCE(p_cost_center, cost_center_id),
        updated_at = CURRENT_TIMESTAMP
    WHERE id = p_warehouse_id;
    
    -- Insert or update GL mapping
    INSERT INTO warehouse_gl_mapping (
        warehouse_id,
        org_id,
        stock_account,
        stock_adjustment_account,
        expenses_included_in_valuation,
        default_cogs_account,
        cost_center
    ) VALUES (
        p_warehouse_id,
        p_org_id,
        p_stock_account,
        p_stock_adjustment_account,
        p_expense_account,
        p_cogs_account,
        p_cost_center
    )
    ON CONFLICT (warehouse_id) DO UPDATE SET
        stock_account = COALESCE(EXCLUDED.stock_account, warehouse_gl_mapping.stock_account),
        stock_adjustment_account = COALESCE(EXCLUDED.stock_adjustment_account, warehouse_gl_mapping.stock_adjustment_account),
        expenses_included_in_valuation = COALESCE(EXCLUDED.expenses_included_in_valuation, warehouse_gl_mapping.expenses_included_in_valuation),
        default_cogs_account = COALESCE(EXCLUDED.default_cogs_account, warehouse_gl_mapping.default_cogs_account),
        cost_center = COALESCE(EXCLUDED.cost_center, warehouse_gl_mapping.cost_center),
        updated_at = CURRENT_TIMESTAMP;
    
    RETURN TRUE;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Error updating warehouse GL mapping: %', SQLERRM;
    RETURN FALSE;
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- STEP 4: Default Account Suggestions View
-- ==============================================================================

CREATE OR REPLACE VIEW v_suggested_warehouse_accounts AS
SELECT 
    org_id,
    'stock_account' as account_purpose,
    id as account_id,
    account_code,
    account_name,
    account_name_ar
FROM accounts
WHERE account_type = 'Asset'
AND account_code LIKE '14%'  -- Inventory accounts
AND is_active
AND NOT is_group

UNION ALL

SELECT 
    org_id,
    'expense_account' as account_purpose,
    id as account_id,
    account_code,
    account_name,
    account_name_ar
FROM accounts
WHERE account_type = 'Expense'
AND (account_code LIKE '59%' OR account_code LIKE '58%')  -- Expense accounts
AND is_active
AND NOT is_group

UNION ALL

SELECT 
    org_id,
    'cogs_account' as account_purpose,
    id as account_id,
    account_code,
    account_name,
    account_name_ar
FROM accounts
WHERE account_type = 'Expense'
AND account_code LIKE '50%'  -- Cost of Goods Sold
AND is_active
AND NOT is_group

ORDER BY account_purpose ASC, account_code ASC;

COMMENT ON VIEW v_suggested_warehouse_accounts IS 'اقتراحات الحسابات المناسبة للمخازن حسب النوع';

-- ==============================================================================
-- STEP 5: Validation Function
-- ==============================================================================

CREATE OR REPLACE FUNCTION validate_warehouse_accounts(
    p_stock_account UUID,
    p_expense_account UUID
)
RETURNS TABLE (
    is_valid BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    v_stock_type TEXT;
    v_expense_type TEXT;
BEGIN
    -- Check stock account type
    SELECT account_type INTO v_stock_type
    FROM accounts
    WHERE id = p_stock_account;
    
    IF v_stock_type != 'Asset' THEN
        RETURN QUERY SELECT FALSE, 'حساب المخزون يجب أن يكون من نوع أصول (Asset)';
        RETURN;
    END IF;
    
    -- Check expense account type
    SELECT account_type INTO v_expense_type
    FROM accounts
    WHERE id = p_expense_account;
    
    IF v_expense_type != 'Expense' THEN
        RETURN QUERY SELECT FALSE, 'حساب المصروفات يجب أن يكون من نوع مصروفات (Expense)';
        RETURN;
    END IF;
    
    RETURN QUERY SELECT TRUE, 'الحسابات صحيحة';
END;
$$ LANGUAGE plpgsql;

-- ==============================================================================
-- STEP 6: Example Usage - Update Existing Warehouses with Default Accounts
-- ==============================================================================

DO $$
DECLARE
    warehouse_rec RECORD;
    default_stock_account UUID;
    default_expense_account UUID;
    default_cogs_account UUID;
BEGIN
    -- Get default accounts
    SELECT id INTO default_stock_account
    FROM accounts
    WHERE account_code = '1400' AND is_active
    LIMIT 1;
    
    SELECT id INTO default_expense_account
    FROM accounts
    WHERE account_code = '5950' AND is_active
    LIMIT 1;
    
    SELECT id INTO default_cogs_account
    FROM accounts
    WHERE account_code = '5000' AND is_active
    LIMIT 1;
    
    -- Update warehouses without accounts
    FOR warehouse_rec IN 
        SELECT id, org_id, code, name
        FROM warehouses 
        WHERE inventory_account_id IS NULL
    LOOP
        PERFORM update_warehouse_gl_mapping(
            warehouse_rec.id,
            warehouse_rec.org_id,
            default_stock_account,
            default_expense_account,
            default_expense_account,
            default_cogs_account,
            NULL
        );
        
        RAISE NOTICE 'Updated accounts for warehouse: % (%)', warehouse_rec.name, warehouse_rec.code;
    END LOOP;
    
    RAISE NOTICE '✅ Warehouse accounting setup complete!';
    RAISE NOTICE '📝 You can now manually select different accounts from the UI';
END $$;

-- ==============================================================================
-- SUCCESS MESSAGE
-- ==============================================================================

DO $$ 
BEGIN
    RAISE NOTICE '';
    RAISE NOTICE '✅ ===============================================';
    RAISE NOTICE '✅ Warehouse Accounting Integration Complete!';
    RAISE NOTICE '✅ ===============================================';
    RAISE NOTICE '';
    RAISE NOTICE '📊 Available Functions:';
    RAISE NOTICE '  - get_accounts_by_type(org_id, account_type)';
    RAISE NOTICE '  - update_warehouse_gl_mapping(warehouse_id, ...)';
    RAISE NOTICE '  - validate_warehouse_accounts(stock_acc, expense_acc)';
    RAISE NOTICE '';
    RAISE NOTICE '👁️ Available Views:';
    RAISE NOTICE '  - v_warehouse_accounting (full details)';
    RAISE NOTICE '  - v_suggested_warehouse_accounts (account suggestions)';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 Next: Use the UI to select accounts for each warehouse';
END $$;
