-- Script to check tenant ID configuration

-- 1. Check current tenant setting
SELECT current_setting('app.current_tenant_id', true) as current_tenant_id;

-- 2. Check if there are any users in the system
SELECT id, email, raw_user_meta_data FROM auth.users LIMIT 10;

-- 3. Check if there are any organizations
SELECT * FROM organizations LIMIT 10;

-- 4. Check user-organization associations
SELECT * FROM user_organizations LIMIT 10;

-- 5. Check tenant_id in gl_accounts
SELECT DISTINCT tenant_id FROM gl_accounts;

-- 6. Check if RLS is enabled on gl_accounts
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'gl_accounts';

-- 7. Check RLS policies on gl_accounts
SELECT polname, polcmd, polroles, polqual 
FROM pg_policy 
WHERE polrelid = 'gl_accounts'::regclass;

-- 8. Try to query gl_accounts with different tenant IDs
-- First, try with a common default tenant ID
SELECT COUNT(*) as count_with_default_tenant
FROM gl_accounts 
WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

-- 9. Try without tenant filter (if RLS allows)
SELECT COUNT(*) as total_count FROM gl_accounts;

-- 10. Check raw JWT claims to understand tenant ID structure
SELECT id, email, raw_app_meta_data, raw_user_meta_data 
FROM auth.users 
LIMIT 5;