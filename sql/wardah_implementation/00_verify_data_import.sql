-- Wardah ERP - Verify Data Import
-- Run this to check if data was imported correctly

-- Check if organizations exist
SELECT 'organizations' as table_name, COUNT(*) as row_count FROM organizations
UNION ALL
SELECT 'gl_accounts' as table_name, COUNT(*) as row_count FROM gl_accounts
UNION ALL
SELECT 'gl_mappings' as table_name, COUNT(*) as row_count FROM gl_mappings;

-- Check a sample of gl_accounts
SELECT * FROM gl_accounts LIMIT 5;

-- Check a sample of gl_mappings
SELECT * FROM gl_mappings LIMIT 5;

-- Check if your user is associated with an organization
-- Note: You'll need to replace 'YOUR_USER_ID' with your actual Supabase user ID
-- SELECT uo.*, o.name as org_name 
-- FROM user_organizations uo
-- LEFT JOIN organizations o ON uo.org_id = o.id
-- WHERE uo.user_id = 'YOUR_USER_ID';

-- Check if RLS is enabled on gl_accounts
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'gl_accounts';

-- Check policies on gl_accounts
SELECT policyname, permissive, roles, cmd 
FROM pg_policies 
WHERE tablename = 'gl_accounts';