-- Wardah ERP - Detailed Data Check
-- Run this to verify that data is properly imported and accessible

-- 1. Check total count of records
SELECT 
  'organizations' as table_name,
  COUNT(*) as record_count
FROM organizations
UNION ALL
SELECT 
  'gl_accounts' as table_name,
  COUNT(*) as record_count
FROM gl_accounts
UNION ALL
SELECT 
  'gl_mappings' as table_name,
  COUNT(*) as record_count
FROM gl_mappings
UNION ALL
SELECT 
  'user_organizations' as table_name,
  COUNT(*) as record_count
FROM user_organizations;

-- 2. Check sample data from gl_accounts
SELECT 
  code,
  name,
  category,
  subtype,
  parent_code,
  is_active
FROM gl_accounts
ORDER BY code
LIMIT 10;

-- 3. Check your specific user organization
-- Replace 'YOUR_USER_ID' with your actual Supabase user ID
SELECT 
  uo.user_id,
  uo.org_id,
  o.name as organization_name,
  uo.role,
  uo.is_active
FROM user_organizations uo
JOIN organizations o ON uo.org_id = o.id
WHERE uo.user_id = 'YOUR_USER_ID'; -- Replace with your actual user ID

-- 4. Check gl_accounts for your organization
-- Replace 'YOUR_ORG_ID' with your actual organization ID (usually '00000000-0000-0000-0000-000000000001')
SELECT 
  COUNT(*) as account_count
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'; -- Replace with your actual org ID

-- 5. Check RLS policies
SELECT 
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE tablename IN ('gl_accounts', 'organizations', 'user_organizations')
ORDER BY tablename, policyname;