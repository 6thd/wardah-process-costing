-- Simple Tenant Configuration Check

-- 1. Check current tenant setting
SELECT current_setting('app.current_tenant_id', true) as current_tenant_id;

-- 2. Check if there are any users in the system
SELECT id, email, raw_app_meta_data, raw_user_meta_data 
FROM auth.users 
LIMIT 5;

-- 3. Check if there are any organizations
SELECT id, name, created_at FROM organizations LIMIT 5;

-- 4. Check user-organization associations
SELECT user_id, org_id, role, created_at FROM user_organizations LIMIT 5;

-- 5. Check tenant_id distribution in gl_accounts
SELECT tenant_id, COUNT(*) as account_count 
FROM gl_accounts 
GROUP BY tenant_id 
ORDER BY account_count DESC;

-- 6. Check a few sample accounts
SELECT id, code, name, tenant_id, path 
FROM gl_accounts 
ORDER BY created_at 
LIMIT 10;