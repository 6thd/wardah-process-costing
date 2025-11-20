-- Comprehensive Tenant Configuration Diagnostic Script

-- 1. Check current tenant setting
SELECT current_setting('app.current_tenant_id', true) as current_tenant_id;

-- 2. Check if there are any users in the system
SELECT id, email, raw_app_meta_data, raw_user_meta_data 
FROM auth.users 
LIMIT 10;

-- 3. Check if there are any organizations
SELECT id, name, created_at FROM organizations LIMIT 10;

-- 4. Check user-organization associations
SELECT user_id, org_id, role, created_at FROM user_organizations LIMIT 10;

-- 5. Check tenant_id distribution in gl_accounts
SELECT tenant_id, COUNT(*) as account_count 
FROM gl_accounts 
GROUP BY tenant_id 
ORDER BY account_count DESC;

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

-- 10. Check JWT claims to understand tenant ID structure
-- This will help us understand how tenant IDs are stored
SELECT id, email, raw_app_meta_data, raw_user_meta_data,
       current_setting('request.jwt.claims', true) as jwt_claims
FROM auth.users 
LIMIT 1;

-- 11. Check for any sample organizations that might have been created
SELECT id, name, created_at 
FROM organizations 
WHERE name ILIKE '%sample%' OR name ILIKE '%demo%' OR name ILIKE '%test%';

-- 12. Check if there's a default organization
SELECT id, name, created_at 
FROM organizations 
ORDER BY created_at 
LIMIT 1;

-- 13. Check user-organization associations for the first user
SELECT uo.user_id, uo.org_id, uo.role, o.name as org_name
FROM user_organizations uo
JOIN organizations o ON uo.org_id = o.id
LIMIT 10;