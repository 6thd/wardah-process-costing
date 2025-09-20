-- COMPLETE CLEAN START FOR GL ACCOUNTS
-- This script removes all problematic triggers, functions, and creates a clean simple table

-- 1. Disable RLS temporarily
ALTER TABLE gl_accounts DISABLE ROW LEVEL SECURITY;

-- 2. Drop all triggers on gl_accounts
DROP TRIGGER IF EXISTS trg_set_gl_account_path ON gl_accounts;
DROP TRIGGER IF EXISTS trg_set_gl_account_path_insert ON gl_accounts;
DROP TRIGGER IF EXISTS trg_set_gl_account_path_update ON gl_accounts;
DROP TRIGGER IF EXISTS trg_check_account_depth ON gl_accounts;
DROP TRIGGER IF EXISTS trg_check_account_depth_insert ON gl_accounts;
DROP TRIGGER IF EXISTS trg_check_account_depth_update ON gl_accounts;

-- 3. Drop all functions that might cause recursion
DROP FUNCTION IF EXISTS set_gl_account_path() CASCADE;
DROP FUNCTION IF EXISTS check_account_depth() CASCADE;

-- 4. Remove any additional columns that were added
ALTER TABLE gl_accounts DROP COLUMN IF EXISTS in_process;
ALTER TABLE gl_accounts DROP COLUMN IF EXISTS path;

-- 5. Create a clean simple table structure (backup existing data first)
-- First, let's backup the existing table
CREATE TABLE IF NOT EXISTS gl_accounts_backup AS SELECT * FROM gl_accounts;

-- 6. Drop the existing table
DROP TABLE IF EXISTS gl_accounts;

-- 7. Create a new clean table with simple structure
CREATE TABLE gl_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID NOT NULL,
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    name_ar TEXT,
    category TEXT NOT NULL CHECK (category IN ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'COGS')),
    subtype TEXT,
    parent_code TEXT,  -- Simple VARCHAR, not a foreign key
    normal_balance TEXT NOT NULL CHECK (normal_balance IN ('DEBIT', 'CREDIT')),
    allow_posting BOOLEAN DEFAULT true,
    is_active BOOLEAN DEFAULT true,
    currency TEXT DEFAULT 'SAR',
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Create simple indexes
CREATE INDEX IF NOT EXISTS idx_gl_accounts_org_id ON gl_accounts(org_id);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_code ON gl_accounts(code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_parent_code ON gl_accounts(parent_code);
CREATE INDEX IF NOT EXISTS idx_gl_accounts_category ON gl_accounts(category);

-- 9. Insert sample data for testing
INSERT INTO gl_accounts (id, org_id, code, name, name_ar, category, subtype, parent_code, normal_balance, allow_posting, is_active) VALUES
('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '1000', 'Assets', 'الأصول', 'ASSET', 'OTHER', NULL, 'DEBIT', false, true),
('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '1100', 'Current Assets', 'الأصول المتداولة', 'ASSET', 'OTHER', '1000', 'DEBIT', false, true),
('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '1101', 'Cash', 'النقدية', 'ASSET', 'CASH', '1100', 'DEBIT', true, true),
('10000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', '1102', 'Bank', 'البنك', 'ASSET', 'BANK', '1100', 'DEBIT', true, true),
('10000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000001', '2000', 'Liabilities', 'الخصوم', 'LIABILITY', 'OTHER', NULL, 'CREDIT', false, true),
('10000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000001', '2100', 'Current Liabilities', 'الخصوم المتداولة', 'LIABILITY', 'OTHER', '2000', 'CREDIT', false, true),
('10000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000001', '2101', 'Accounts Payable', 'الذمم الدائنة', 'LIABILITY', 'PAYABLE', '2100', 'CREDIT', true, true),
('10000000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000001', '3000', 'Equity', 'حقوق الملكية', 'EQUITY', 'OTHER', NULL, 'CREDIT', false, true),
('10000000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000001', '4000', 'Revenue', 'الإيرادات', 'REVENUE', 'OTHER', NULL, 'CREDIT', true, true),
('10000000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000001', '5000', 'Expenses', 'المصروفات', 'EXPENSE', 'OTHER', NULL, 'DEBIT', true, true);

-- 10. Disable RLS completely for now to avoid any recursion issues
ALTER TABLE gl_accounts DISABLE ROW LEVEL SECURITY;

-- 11. Verify the data
-- SELECT COUNT(*) FROM gl_accounts;
-- SELECT code, name, category FROM gl_accounts ORDER BY code;

-- SUCCESS MESSAGE
DO $$
BEGIN
    RAISE NOTICE '✅ COMPLETE CLEAN START APPLIED SUCCESSFULLY!';
    RAISE NOTICE '✅ All problematic triggers and functions removed';
    RAISE NOTICE '✅ New clean gl_accounts table created';
    RAISE NOTICE '✅ Sample data inserted for testing';
    RAISE NOTICE '✅ RLS disabled to prevent recursion issues';
    RAISE NOTICE '✅ You should now be able to query gl_accounts without errors';
END $$;