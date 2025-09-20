-- Script to check RLS policies on gl_accounts table

-- 1. Check if RLS is enabled on gl_accounts
SELECT relname, relrowsecurity 
FROM pg_class 
WHERE relname = 'gl_accounts';

-- 2. Check RLS policies on gl_accounts
SELECT polname, polcmd, polroles, polqual 
FROM pg_policy 
WHERE polrelid = 'gl_accounts'::regclass;

-- 3. Check if we can query gl_accounts without filtering
SELECT COUNT(*) as total_count FROM gl_accounts;

-- 4. Check tenant_id distribution
SELECT tenant_id, COUNT(*) as account_count 
FROM gl_accounts 
GROUP BY tenant_id 
ORDER BY account_count DESC;

-- 5. Try to query with a specific tenant_id
SELECT COUNT(*) as count_with_default_tenant
FROM gl_accounts 
WHERE tenant_id = '00000000-0000-0000-0000-000000000001';

-- 6. Check if there are any organizations
SELECT id, name FROM organizations;

-- 7. Check user-organization associations
SELECT user_id, org_id, role FROM user_organizations;