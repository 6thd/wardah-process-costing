-- =============================================
-- Fix Security Linter Issues
-- إصلاح مشاكل الأمان من Supabase Database Linter
-- =============================================
-- Migration: 62_fix_security_linter_issues.sql
-- Date: 2024
-- 
-- Issues Fixed:
-- 1. Remove SECURITY DEFINER from views (6 views)
-- 2. Enable RLS on security_audit_reports table
-- =============================================

-- =============================================
-- PART 0: Check actual table structure
-- =============================================
-- First, let's check the actual columns in stage_costs table

DO $$ 
DECLARE
    v_work_center_col TEXT;
    v_mo_col TEXT;
    v_table_exists BOOLEAN;
BEGIN
    -- Check if stage_costs table exists
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'stage_costs'
    ) INTO v_table_exists;
    
    IF NOT v_table_exists THEN
        RAISE NOTICE 'Table stage_costs does not exist, skipping column check';
        v_work_center_col := 'work_center_id';
        v_mo_col := 'mo_id';
    ELSE
        -- Check work center column name (try all possible names)
        SELECT column_name INTO v_work_center_col
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'stage_costs'
        AND (column_name LIKE '%work%center%' OR column_name LIKE '%wc%')
        ORDER BY 
            CASE column_name 
                WHEN 'work_center_id' THEN 1
                WHEN 'wc_id' THEN 2
                ELSE 3
            END
        LIMIT 1;
        
        -- Check manufacturing order column name (try all possible names)
        SELECT column_name INTO v_mo_col
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'stage_costs'
        AND (column_name LIKE '%mo%' OR column_name LIKE '%manufacturing%order%')
        ORDER BY 
            CASE column_name 
                WHEN 'mo_id' THEN 1
                WHEN 'manufacturing_order_id' THEN 2
                ELSE 3
            END
        LIMIT 1;
        
        -- Default values if not found
        v_work_center_col := COALESCE(v_work_center_col, 'work_center_id');
        v_mo_col := COALESCE(v_mo_col, 'mo_id');
    END IF;
    
    RAISE NOTICE 'Work center column: %', v_work_center_col;
    RAISE NOTICE 'MO column: %', v_mo_col;
    
    -- Store in temporary table for later use
    CREATE TEMP TABLE IF NOT EXISTS stage_costs_columns (
        work_center_col TEXT,
        mo_col TEXT
    );
    
    -- Clear temp table before insert (safe: temporary table, session-scoped)
    TRUNCATE TABLE stage_costs_columns;
    INSERT INTO stage_costs_columns VALUES (v_work_center_col, v_mo_col);
END $$;

-- =============================================
-- PART 1: Fix SECURITY DEFINER Views
-- =============================================
-- Views with SECURITY DEFINER bypass RLS policies
-- We need to recreate them without SECURITY DEFINER

-- 1. Recreate v_manufacturing_orders_summary
DROP VIEW IF EXISTS v_manufacturing_orders_summary CASCADE;
CREATE OR REPLACE VIEW v_manufacturing_orders_summary
WITH (security_invoker=true) AS
SELECT 
  org_id,
  status,
  COUNT(*) as order_count,
  SUM(quantity) as total_quantity,
  SUM(completed_quantity) as total_completed,
  SUM(scrap_quantity) as total_scrap,
  SUM(total_cost) as total_cost,
  AVG(unit_cost) as avg_unit_cost,
  MIN(start_date) as earliest_start,
  MAX(due_date) as latest_due
FROM manufacturing_orders
GROUP BY org_id, status;

COMMENT ON VIEW v_manufacturing_orders_summary IS 'Summary statistics for manufacturing orders by status';

-- 2. Recreate vw_stock_valuation_by_method
DROP VIEW IF EXISTS vw_stock_valuation_by_method CASCADE;
CREATE OR REPLACE VIEW vw_stock_valuation_by_method
WITH (security_invoker=true) AS
SELECT 
  org_id,
  valuation_method,
  COUNT(*) as product_count,
  SUM(stock_quantity) as total_quantity,
  SUM(stock_value) as total_value,
  AVG(cost_price) as avg_unit_cost,
  MIN(cost_price) as min_unit_cost,
  MAX(cost_price) as max_unit_cost
FROM products
WHERE stock_quantity > 0
GROUP BY org_id, valuation_method;

-- If org_id doesn't exist in products table, create view without it
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'products' 
    AND column_name = 'org_id'
  ) THEN
    -- Recreate view without org_id grouping
    DROP VIEW IF EXISTS vw_stock_valuation_by_method CASCADE;
    CREATE OR REPLACE VIEW vw_stock_valuation_by_method
    WITH (security_invoker=true) AS
    SELECT 
      valuation_method,
      COUNT(*) as product_count,
      SUM(stock_quantity) as total_quantity,
      SUM(stock_value) as total_value,
      AVG(cost_price) as avg_unit_cost,
      MIN(cost_price) as min_unit_cost,
      MAX(cost_price) as max_unit_cost
    FROM products
    WHERE stock_quantity > 0
    GROUP BY valuation_method;
  END IF;
END $$;

COMMENT ON VIEW vw_stock_valuation_by_method IS 'Stock valuation summary by valuation method';

-- 3. Recreate v_trial_balance
DROP VIEW IF EXISTS v_trial_balance CASCADE;
CREATE OR REPLACE VIEW v_trial_balance
WITH (security_invoker=true) AS
SELECT 
  gl.account_code,
  ga.name as account_name,
  COALESCE(ga.name_ar, ga.name) as account_name_ar,
  ga.category as account_type,
  ga.parent_code,
  SUM(CASE WHEN gl.debit_amount > 0 THEN gl.debit_amount ELSE 0 END) as total_debit,
  SUM(CASE WHEN gl.credit_amount > 0 THEN gl.credit_amount ELSE 0 END) as total_credit,
  SUM(gl.debit_amount - gl.credit_amount) as balance,
  ge.org_id,
  MIN(ge.entry_date) as first_transaction_date,
  MAX(ge.entry_date) as last_transaction_date,
  COUNT(DISTINCT ge.id) as transaction_count
FROM gl_entry_lines gl
INNER JOIN gl_entries ge ON gl.entry_id = ge.id
LEFT JOIN gl_accounts ga ON gl.account_code = ga.code AND ge.org_id = ga.org_id
WHERE ge.status = 'posted'
GROUP BY 
  gl.account_code,
  ga.name,
  COALESCE(ga.name_ar, ga.name),
  ga.category,
  ga.parent_code,
  ge.org_id;

COMMENT ON VIEW v_trial_balance IS 'Pre-calculated trial balance for all accounts';

-- 4. Recreate v_manufacturing_orders_full
DROP VIEW IF EXISTS v_manufacturing_orders_full CASCADE;
CREATE OR REPLACE VIEW v_manufacturing_orders_full
WITH (security_invoker=true) AS
SELECT 
  mo.id,
  mo.org_id,
  mo.order_number,
  mo.item_id,
  mo.product_id,
  mo.quantity,
  mo.status,
  mo.start_date,
  mo.due_date,
  mo.completed_date,
  mo.completed_quantity,
  mo.scrap_quantity,
  mo.total_cost,
  mo.unit_cost,
  mo.notes,
  mo.created_by,
  mo.created_at,
  mo.updated_at,
  
  -- Product/Item information
  COALESCE(p.name, i.name) as product_name,
  COALESCE(p.code, i.code) as product_code,
  COALESCE(p.id, i.id) as effective_product_id
  
FROM manufacturing_orders mo
LEFT JOIN products p ON mo.product_id = p.id
LEFT JOIN items i ON mo.item_id = i.id;

COMMENT ON VIEW v_manufacturing_orders_full IS 'Full manufacturing orders with related product data';

-- 5. Recreate v_work_centers_utilization
DROP VIEW IF EXISTS v_work_centers_utilization CASCADE;

-- Create view with dynamic column names based on actual table structure
DO $$ 
DECLARE
    v_work_center_col TEXT;
    v_mo_col TEXT;
    v_sql TEXT;
BEGIN
    -- Get column names from temp table
    SELECT work_center_col, mo_col INTO v_work_center_col, v_mo_col
    FROM stage_costs_columns;
    
    -- If columns not found, try to detect them
    IF v_work_center_col IS NULL THEN
        SELECT column_name INTO v_work_center_col
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'stage_costs'
        AND column_name IN ('wc_id', 'work_center_id')
        LIMIT 1;
    END IF;
    
    IF v_mo_col IS NULL THEN
        SELECT column_name INTO v_mo_col
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'stage_costs'
        AND column_name IN ('mo_id', 'manufacturing_order_id')
        LIMIT 1;
    END IF;
    
    -- Default to common names if still not found
    v_work_center_col := COALESCE(v_work_center_col, 'work_center_id');
    v_mo_col := COALESCE(v_mo_col, 'mo_id');
    
    -- Build dynamic SQL
    v_sql := format('
        CREATE OR REPLACE VIEW v_work_centers_utilization
        WITH (security_invoker=true) AS
        SELECT 
          wc.id,
          wc.org_id,
          wc.code,
          wc.name,
          wc.name_ar,
          wc.description,
          wc.hourly_rate,
          wc.capacity_per_hour,
          wc.efficiency_percent,
          wc.is_active,
          wc.created_at,
          wc.updated_at,
          
          -- Utilization statistics
          COUNT(DISTINCT sc.%I) as active_orders,
          SUM(sc.dl_cost) as total_labor_cost,
          SUM(sc.moh_cost) as total_overhead_cost,
          wc.efficiency_percent as avg_efficiency
          
        FROM work_centers wc
        LEFT JOIN stage_costs sc ON wc.id = sc.%I
        GROUP BY 
          wc.id,
          wc.org_id,
          wc.code,
          wc.name,
          wc.name_ar,
          wc.description,
          wc.hourly_rate,
          wc.capacity_per_hour,
          wc.efficiency_percent,
          wc.is_active,
          wc.created_at,
          wc.updated_at',
        v_mo_col, v_work_center_col);
    
    EXECUTE v_sql;
    
    RAISE NOTICE 'Created view using work_center_col: %, mo_col: %', v_work_center_col, v_mo_col;
END $$;

COMMENT ON VIEW v_work_centers_utilization IS 'Work centers with utilization statistics';

-- 6. Recreate v_gl_entries_full
DROP VIEW IF EXISTS v_gl_entries_full CASCADE;
CREATE OR REPLACE VIEW v_gl_entries_full
WITH (security_invoker=true) AS
SELECT 
  ge.id,
  ge.org_id,
  ge.entry_number,
  ge.entry_date,
  ge.entry_type,
  ge.description,
  ge.description_ar,
  ge.status,
  ge.journal_id,
  ge.reference_type,
  ge.reference_number,
  ge.reference_id,
  ge.created_by,
  ge.created_at,
  ge.updated_at,
  
  -- Journal information
  j.name as journal_name,
  j.name_ar as journal_name_ar,
  j.code as journal_code,
  
  -- Totals (using subqueries for better performance)
  (SELECT SUM(debit_amount) FROM gl_entry_lines WHERE entry_id = ge.id) as total_debit,
  (SELECT SUM(credit_amount) FROM gl_entry_lines WHERE entry_id = ge.id) as total_credit,
  (SELECT COUNT(*) FROM gl_entry_lines WHERE entry_id = ge.id) as line_count
  
FROM gl_entries ge
LEFT JOIN journals j ON ge.journal_id = j.id;

COMMENT ON VIEW v_gl_entries_full IS 'Full GL entries with journal information and totals';

-- Grant permissions to views
GRANT SELECT ON v_manufacturing_orders_summary TO authenticated;
GRANT SELECT ON vw_stock_valuation_by_method TO authenticated;
GRANT SELECT ON v_trial_balance TO authenticated;
GRANT SELECT ON v_manufacturing_orders_full TO authenticated;
GRANT SELECT ON v_work_centers_utilization TO authenticated;
GRANT SELECT ON v_gl_entries_full TO authenticated;

-- =============================================
-- PART 2: Enable RLS on security_audit_reports
-- =============================================

-- Enable RLS on security_audit_reports table
ALTER TABLE security_audit_reports ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their org audit reports" ON security_audit_reports;
DROP POLICY IF EXISTS "Super admins can view all audit reports" ON security_audit_reports;
DROP POLICY IF EXISTS "Org admins can view their org audit reports" ON security_audit_reports;

-- Note: We'll add org_id column first, then create proper policies

-- =============================================
-- PART 3: Add org_id to security_audit_reports (Optional Enhancement)
-- =============================================

-- Add org_id column if it doesn't exist
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'security_audit_reports' 
    AND column_name = 'org_id'
  ) THEN
    ALTER TABLE security_audit_reports 
    ADD COLUMN org_id UUID REFERENCES organizations(id) ON DELETE CASCADE;
    
    COMMENT ON COLUMN security_audit_reports.org_id IS 'Organization ID for multi-tenant isolation';
  END IF;
END $$;

-- Update existing records to use default org if any
-- (Only if org_id was just added)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' 
    AND table_name = 'security_audit_reports' 
    AND column_name = 'org_id'
  ) THEN
    -- Set org_id to NULL for existing records (can be updated manually later)
    UPDATE security_audit_reports 
    SET org_id = NULL 
    WHERE org_id IS NULL;
  END IF;
END $$;

-- Drop the org admin policy and recreate with org_id check
DROP POLICY IF EXISTS "Org admins can view audit reports" ON security_audit_reports;

-- Policy: Users can view audit reports for their organizations
CREATE POLICY "Users can view their org audit reports" 
ON security_audit_reports
FOR SELECT
USING (
  -- Super admins can view all
  EXISTS (
    SELECT 1 FROM super_admins
    WHERE user_id = auth.uid()
    AND is_active = true
  )
  OR
  -- Org admins can view reports for their organizations
  (
    org_id IN (
      SELECT org_id FROM user_organizations
      WHERE user_id = auth.uid()
      AND is_active = true
    )
  )
  OR
  -- Allow viewing reports with NULL org_id (system-wide reports)
  (org_id IS NULL AND EXISTS (
    SELECT 1 FROM user_organizations
    WHERE user_id = auth.uid()
    AND is_org_admin = true
    AND is_active = true
  ))
);

-- =============================================
-- Verification
-- =============================================

DO $$ 
BEGIN
  RAISE NOTICE '✅ Security fixes applied successfully!';
  RAISE NOTICE '';
  RAISE NOTICE 'Fixed Views (SECURITY DEFINER removed):';
  RAISE NOTICE '  ✅ v_manufacturing_orders_summary';
  RAISE NOTICE '  ✅ vw_stock_valuation_by_method';
  RAISE NOTICE '  ✅ v_trial_balance';
  RAISE NOTICE '  ✅ v_manufacturing_orders_full';
  RAISE NOTICE '  ✅ v_work_centers_utilization';
  RAISE NOTICE '  ✅ v_gl_entries_full';
  RAISE NOTICE '';
  RAISE NOTICE 'RLS Enabled:';
  RAISE NOTICE '  ✅ security_audit_reports';
  RAISE NOTICE '';
  RAISE NOTICE 'All views now use security_invoker=true (respects RLS)';
END $$;

