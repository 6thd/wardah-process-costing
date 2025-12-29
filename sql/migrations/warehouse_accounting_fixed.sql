-- ==============================================================================
-- WAREHOUSE ACCOUNTING INTEGRATION - FIXED FOR ACTUAL SCHEMA
-- Compatible with gl_accounts table structure
-- ==============================================================================

-- Constants for account categories
-- NOSONAR: SQL literal constants are acceptable for category values

-- ==============================================================================
-- STEP 1: Update warehouses table to reference gl_accounts
-- ==============================================================================

DO $$ 
BEGIN
    -- Check if inventory_account_id references correct table
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%warehouses_inventory_account%'
        AND table_name = 'warehouses'
    ) THEN
        ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_inventory_account_id_fkey;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name LIKE '%warehouses_expense_account%'
        AND table_name = 'warehouses'
    ) THEN
        ALTER TABLE warehouses DROP CONSTRAINT IF EXISTS warehouses_expense_account_id_fkey;
    END IF;

    -- Add correct foreign keys
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouses' AND column_name = 'inventory_account_id') THEN
        ALTER TABLE warehouses 
        ADD CONSTRAINT warehouses_inventory_account_id_fkey 
        FOREIGN KEY (inventory_account_id) REFERENCES gl_accounts(id);
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'warehouses' AND column_name = 'expense_account_id') THEN
        ALTER TABLE warehouses 
        ADD CONSTRAINT warehouses_expense_account_id_fkey 
        FOREIGN KEY (expense_account_id) REFERENCES gl_accounts(id);
    END IF;

    RAISE NOTICE 'Updated warehouse foreign keys';
END $$;

-- ==============================================================================
-- STEP 2: Update warehouse_gl_mapping to reference gl_accounts
-- ==============================================================================

DO $$
BEGIN
    -- Drop old constraints if exist
    ALTER TABLE warehouse_gl_mapping DROP CONSTRAINT IF EXISTS warehouse_gl_mapping_stock_account_fkey;
    ALTER TABLE warehouse_gl_mapping DROP CONSTRAINT IF EXISTS warehouse_gl_mapping_stock_adjustment_account_fkey;
    ALTER TABLE warehouse_gl_mapping DROP CONSTRAINT IF EXISTS warehouse_gl_mapping_default_cogs_account_fkey;
    ALTER TABLE warehouse_gl_mapping DROP CONSTRAINT IF EXISTS warehouse_gl_mapping_default_sales_account_fkey;
    ALTER TABLE warehouse_gl_mapping DROP CONSTRAINT IF EXISTS warehouse_gl_mapping_expenses_included_in_valuation_fkey;

    -- Add correct constraints
    ALTER TABLE warehouse_gl_mapping 
    ADD CONSTRAINT warehouse_gl_mapping_stock_account_fkey 
    FOREIGN KEY (stock_account) REFERENCES gl_accounts(id);

    ALTER TABLE warehouse_gl_mapping 
    ADD CONSTRAINT warehouse_gl_mapping_stock_adjustment_account_fkey 
    FOREIGN KEY (stock_adjustment_account) REFERENCES gl_accounts(id);

    ALTER TABLE warehouse_gl_mapping 
    ADD CONSTRAINT warehouse_gl_mapping_default_cogs_account_fkey 
    FOREIGN KEY (default_cogs_account) REFERENCES gl_accounts(id);

    RAISE NOTICE 'Updated warehouse_gl_mapping foreign keys';
END $$;

-- ==============================================================================
-- STEP 3: Helper Function to Get Available GL Accounts by Category
-- ==============================================================================

CREATE OR REPLACE FUNCTION get_gl_accounts_by_category(
    p_org_id UUID,
    p_category TEXT
)
RETURNS TABLE (
    id UUID,
    code VARCHAR,
    name VARCHAR,
    category VARCHAR,
    subtype VARCHAR,
    parent_code VARCHAR,
    allow_posting BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        a.id,
        a.code,
        a.name,
        a.category,
        a.subtype,
        a.parent_code,
        a.allow_posting
    FROM gl_accounts a
    WHERE a.org_id = p_org_id
    AND a.category = p_category
    AND a.is_active
    AND a.allow_posting
    ORDER BY a.code ASC;
    AND a.allow_posting  -- Only postable accounts
    ORDER BY a.code ASC;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_gl_accounts_by_category IS 'جلب الحسابات حسب الفئة (ASSET, EXPENSE, إلخ)';

-- ==============================================================================
-- STEP 4: View for Warehouse with GL Account Details
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
    
    -- Stock Account (Asset)
    sa.id as stock_account_id,
    sa.code as stock_account_code,
    sa.name as stock_account_name,
    sa.category as stock_account_category,
    
    -- Expense Account
    ea.id as expense_account_id,
    ea.code as expense_account_code,
    ea.name as expense_account_name,
    ea.category as expense_account_category,
    
    -- GL Mapping Details
    wgl.stock_adjustment_account,
    wgl.expenses_included_in_valuation,
    wgl.default_cogs_account,
    wgl.cost_center,
    
    -- Get account details for GL mapping
    adj_acc.code as adjustment_account_code,
    adj_acc.name as adjustment_account_name,
    cogs_acc.code as cogs_account_code,
    cogs_acc.name as cogs_account_name
    
FROM warehouses w
LEFT JOIN gl_accounts sa ON sa.id = w.inventory_account_id
LEFT JOIN gl_accounts ea ON ea.id = w.expense_account_id
LEFT JOIN warehouse_gl_mapping wgl ON wgl.warehouse_id = w.id
LEFT JOIN gl_accounts adj_acc ON adj_acc.id = wgl.stock_adjustment_account
LEFT JOIN gl_accounts cogs_acc ON cogs_acc.id = wgl.default_cogs_account
ORDER BY w.code ASC;

COMMENT ON VIEW v_warehouse_accounting IS 'عرض شامل للمخازن مع تفاصيل الربط المحاسبي';

-- ==============================================================================
-- STEP 5: Function to Update Warehouse GL Mapping
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

COMMENT ON FUNCTION update_warehouse_gl_mapping IS 'تحديث ربط المخزن بالحسابات المحاسبية';

-- ==============================================================================
-- STEP 6: Suggested Accounts View (by category and code pattern)
-- ==============================================================================

CREATE OR REPLACE VIEW v_suggested_warehouse_accounts AS
SELECT 
    org_id,
    'stock_account' as account_purpose,
    id as account_id,
    code,
    name,
    category,
    subtype
FROM gl_accounts
WHERE category = 'ASSET'
AND (code LIKE '14%' OR subtype LIKE '%inventory%' OR subtype LIKE '%stock%')
AND is_active
AND allow_posting

UNION ALL

SELECT 
    org_id,
    'expense_account' as account_purpose,
    id as account_id,
    code,
    name,
    category,
    subtype
FROM gl_accounts
WHERE category = 'EXPENSE'
AND (code LIKE '59%' OR code LIKE '58%')
AND is_active  -- Fixed: removed = true
AND allow_posting  -- Fixed: removed = true

UNION ALL

SELECT 
    org_id,
    'cogs_account' as account_purpose,
    id as account_id,
    code,
    name,
    category,
    subtype
FROM gl_accounts
WHERE category = 'EXPENSE'
AND (code LIKE '50%' OR subtype LIKE '%cost%')
AND is_active  -- Fixed: removed = true
AND allow_posting  -- Fixed: removed = true

ORDER BY account_purpose ASC, account_code ASC;

COMMENT ON VIEW v_suggested_warehouse_accounts IS 'اقتراحات الحسابات المناسبة للمخازن';

-- ==============================================================================
-- STEP 7: Validation Function
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
    v_stock_category TEXT;
    v_expense_category TEXT;
BEGIN
    -- Check stock account category
    SELECT category INTO v_stock_category
    FROM gl_accounts
    WHERE id = p_stock_account;
    
    IF v_stock_category != 'ASSET' THEN
        RETURN QUERY SELECT FALSE, 'حساب المخزون يجب أن يكون من فئة الأصول (ASSET)'::TEXT;
        RETURN;
    END IF;
    
    -- Check expense account category
    SELECT category INTO v_expense_category
    FROM gl_accounts
    WHERE id = p_expense_account;
    
    IF v_expense_category != 'EXPENSE' THEN
        RETURN QUERY SELECT FALSE, 'حساب المصروفات يجب أن يكون من فئة المصروفات (EXPENSE)'::TEXT;
        RETURN;
    END IF;
    
    RETURN QUERY SELECT TRUE, 'الحسابات صحيحة'::TEXT;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION validate_warehouse_accounts IS 'التحقق من صحة الحسابات المحاسبية للمخزن';

-- ==============================================================================
-- STEP 8: Set Default Accounts for Existing Warehouses
-- ==============================================================================

DO $$
DECLARE
    warehouse_rec RECORD;
    default_stock_account UUID;
    default_expense_account UUID;
    default_cogs_account UUID;
BEGIN
    -- Get default accounts (adjust codes based on your COA)
    SELECT id INTO default_stock_account
    FROM gl_accounts
    WHERE code = '1400' AND is_active
    LIMIT 1;
    
    SELECT id INTO default_expense_account
    FROM gl_accounts
    WHERE category = 'EXPENSE' AND code LIKE '59%' AND is_active
    LIMIT 1;
    
    SELECT id INTO default_cogs_account
    FROM gl_accounts
    WHERE category = 'EXPENSE' AND code LIKE '50%' AND is_active
    LIMIT 1;
    
    IF default_stock_account IS NULL THEN
        RAISE NOTICE '⚠️  No default stock account found (1400)';
        RAISE NOTICE '📝 Please create or select accounts manually from UI';
        RETURN;
    END IF;
    
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
    RAISE NOTICE '  - get_gl_accounts_by_category(org_id, category)';
    RAISE NOTICE '  - update_warehouse_gl_mapping(warehouse_id, ...)';
    RAISE NOTICE '  - validate_warehouse_accounts(stock_acc, expense_acc)';
    RAISE NOTICE '';
    RAISE NOTICE '👁️ Available Views:';
    RAISE NOTICE '  - v_warehouse_accounting (full details)';
    RAISE NOTICE '  - v_suggested_warehouse_accounts (suggestions)';
    RAISE NOTICE '';
    RAISE NOTICE '🎯 Next: Use the UI to select GL accounts for warehouses';
END $$;
