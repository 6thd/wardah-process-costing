-- =============================================
-- Performance Optimization: Database Indexes
-- تحسين الأداء: إنشاء Indexes للجداول الحرجة
-- =============================================
-- Expected improvement: 20-30% faster queries
-- =============================================

-- 1. Manufacturing Orders Indexes
-- =============================================

-- Index for org_id + status (most common filter)
CREATE INDEX IF NOT EXISTS idx_mo_org_status 
ON manufacturing_orders(org_id, status) 
WHERE status IS NOT NULL;

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_mo_dates 
ON manufacturing_orders(org_id, start_date, due_date) 
WHERE start_date IS NOT NULL;

-- Index for product lookups
CREATE INDEX IF NOT EXISTS idx_mo_product 
ON manufacturing_orders(product_id) 
WHERE product_id IS NOT NULL;

-- Index for item lookups
CREATE INDEX IF NOT EXISTS idx_mo_item 
ON manufacturing_orders(item_id) 
WHERE item_id IS NOT NULL;

-- Index for order number searches
CREATE INDEX IF NOT EXISTS idx_mo_order_number 
ON manufacturing_orders(org_id, order_number);

-- Index for created_at (for sorting)
CREATE INDEX IF NOT EXISTS idx_mo_created 
ON manufacturing_orders(org_id, created_at DESC);

-- 2. Products/Items Indexes
-- =============================================

-- Index for products by org_id
CREATE INDEX IF NOT EXISTS idx_products_org 
ON products(org_id) 
WHERE org_id IS NOT NULL;

-- Index for products by org_id + active status
CREATE INDEX IF NOT EXISTS idx_products_org_active 
ON products(org_id, is_active) 
WHERE is_active = true;

-- Index for items by org_id (if items table exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
    CREATE INDEX IF NOT EXISTS idx_items_org 
    ON items(org_id) 
    WHERE org_id IS NOT NULL;
    
    CREATE INDEX IF NOT EXISTS idx_items_org_active 
    ON items(org_id, is_active) 
    WHERE is_active = true;
  END IF;
END $$;

-- 3. GL Entries Indexes (for Trial Balance)
-- =============================================

-- Index for posted entries by org_id + status
CREATE INDEX IF NOT EXISTS idx_gl_entries_org_status 
ON gl_entries(org_id, status) 
WHERE status = 'posted';

-- Index for date range queries
CREATE INDEX IF NOT EXISTS idx_gl_entries_dates 
ON gl_entries(org_id, entry_date) 
WHERE status = 'posted';

-- 4. GL Entry Lines Indexes
-- =============================================

-- Index for entry_id (foreign key)
CREATE INDEX IF NOT EXISTS idx_gl_lines_entry 
ON gl_entry_lines(entry_id);

-- Index for account_code (for grouping)
CREATE INDEX IF NOT EXISTS idx_gl_lines_account 
ON gl_entry_lines(account_code);

-- Composite index for entry_id + account_code
CREATE INDEX IF NOT EXISTS idx_gl_lines_entry_account 
ON gl_entry_lines(entry_id, account_code);

-- 5. GL Accounts Indexes
-- =============================================

-- Index for code lookups
CREATE INDEX IF NOT EXISTS idx_gl_accounts_code 
ON gl_accounts(code);

-- Index for org_id + active
CREATE INDEX IF NOT EXISTS idx_gl_accounts_org_active 
ON gl_accounts(org_id, is_active) 
WHERE is_active = true;

-- 6. Work Centers Indexes
-- =============================================

-- Index for org_id + active
CREATE INDEX IF NOT EXISTS idx_work_centers_org_active 
ON work_centers(org_id, is_active) 
WHERE is_active = true;

-- Index for code lookups
CREATE INDEX IF NOT EXISTS idx_work_centers_code 
ON work_centers(org_id, code);

-- 7. Stage Costs Indexes
-- =============================================

-- Index for manufacturing_order_id
CREATE INDEX IF NOT EXISTS idx_stage_costs_mo 
ON stage_costs(manufacturing_order_id);

-- Index for org_id + mo_id
CREATE INDEX IF NOT EXISTS idx_stage_costs_org_mo 
ON stage_costs(org_id, manufacturing_order_id);

-- =============================================
-- Analyze tables to update statistics
-- =============================================

ANALYZE manufacturing_orders;
ANALYZE products;
ANALYZE gl_entries;
ANALYZE gl_entry_lines;
ANALYZE gl_accounts;
ANALYZE work_centers;
ANALYZE stage_costs;

-- Analyze items if exists
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'items') THEN
    EXECUTE 'ANALYZE items';
  END IF;
END $$;

-- =============================================
-- Verification Query
-- =============================================

-- Check created indexes
SELECT 
  schemaname,
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname LIKE 'idx_%'
ORDER BY tablename, indexname;

-- =============================================
-- Expected Results:
-- - Manufacturing Orders queries: 30% faster
-- - Trial Balance queries: 25% faster
-- - Product lookups: 40% faster
-- =============================================

