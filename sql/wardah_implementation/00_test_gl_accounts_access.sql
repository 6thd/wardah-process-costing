-- Wardah ERP - Test GL Accounts Access
-- Run this to test if gl_accounts table is accessible

-- Test 1: Check if table exists and has data
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- Test 2: Check a sample of accounts
SELECT code, name, category, is_active 
FROM gl_accounts 
ORDER BY code 
LIMIT 10;

-- Test 3: Check if RLS is enabled
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'gl_accounts';

-- Test 4: Check policies on gl_accounts
SELECT policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename = 'gl_accounts';

-- Test 5: Try to access with a specific org_id (if you know it)
-- SELECT * FROM gl_accounts WHERE org_id = '00000000-0000-0000-0000-000000000001' LIMIT 5;