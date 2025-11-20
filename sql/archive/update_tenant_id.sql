-- Script to update tenant_id for all accounts if needed

-- 1. Check how many accounts have null tenant_id
SELECT COUNT(*) as null_tenant_count FROM gl_accounts WHERE tenant_id IS NULL;

-- 2. Check how many accounts have a specific tenant_id
SELECT tenant_id, COUNT(*) as count 
FROM gl_accounts 
GROUP BY tenant_id;

-- 3. Update accounts with null tenant_id to a default value
-- (Only run this if you're sure it's safe to do so)
UPDATE gl_accounts 
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE tenant_id IS NULL;

-- 4. Check the result
SELECT tenant_id, COUNT(*) as count 
FROM gl_accounts 
GROUP BY tenant_id;