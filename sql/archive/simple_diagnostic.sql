-- Simple diagnostic to understand tenant_id values
-- Run this first to avoid complex casting issues

-- Check total count of accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- Check how many have NULL tenant_id
SELECT COUNT(*) as null_tenant_id FROM gl_accounts WHERE tenant_id IS NULL;

-- Check how many have non-NULL tenant_id
SELECT COUNT(*) as non_null_tenant_id FROM gl_accounts WHERE tenant_id IS NOT NULL;

-- Check sample of non-NULL tenant_id values (as text)
SELECT DISTINCT tenant_id::text as tenant_id_text
FROM gl_accounts 
WHERE tenant_id IS NOT NULL
LIMIT 10;

-- Check if any tenant_id values look like valid UUIDs
SELECT 
  tenant_id::text,
  tenant_id::text SIMILAR TO '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}' as is_valid_uuid
FROM gl_accounts 
WHERE tenant_id IS NOT NULL
LIMIT 10;