-- Check tenant IDs in gl_accounts
SELECT DISTINCT tenant_id, COUNT(*) as count
FROM gl_accounts
GROUP BY tenant_id;

-- Check how many accounts exist per tenant
SELECT tenant_id, COUNT(*) as account_count
FROM gl_accounts
GROUP BY tenant_id
ORDER BY account_count DESC;

-- Check if there are accounts with NULL tenant_id
SELECT COUNT(*) as null_tenant_count
FROM gl_accounts
WHERE tenant_id IS NULL;

-- Check accounts with the default tenant ID
SELECT COUNT(*) as default_tenant_count
FROM gl_accounts
WHERE tenant_id = '00000000-0000-0000-0000-000000000001';