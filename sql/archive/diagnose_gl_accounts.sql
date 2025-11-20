-- DIAGNOSE_GL_ACCOUNTS.sql
-- Diagnostic script to check the current state of gl_accounts table

-- 1. Check if the table exists and its structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- 2. Check total count of records
SELECT COUNT(*) as total_records FROM gl_accounts;

-- 3. Check records with the default org_id
SELECT COUNT(*) as records_with_default_org FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- 4. Check records with any org_id
SELECT COUNT(*) as records_with_any_org FROM gl_accounts 
WHERE org_id IS NOT NULL;

-- 5. Check for NULL org_ids
SELECT COUNT(*) as records_with_null_org FROM gl_accounts 
WHERE org_id IS NULL;

-- 6. Show sample records (if any)
SELECT 
    id,
    org_id,
    code,
    name,
    category,
    parent_code,
    is_active
FROM gl_accounts 
LIMIT 10;

-- 7. Check records with default org_id (detailed)
SELECT 
    id,
    org_id,
    code,
    name,
    category,
    parent_code,
    is_active
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
LIMIT 10;

-- 8. Check for any records at all
SELECT 
    id,
    org_id,
    code,
    name,
    category,
    parent_code,
    is_active
FROM gl_accounts 
LIMIT 10;

-- 9. Check distinct org_ids
SELECT 
    org_id,
    COUNT(*) as count
FROM gl_accounts 
GROUP BY org_id
ORDER BY count DESC;

-- 10. Check if there are any records with proper parent_code relationships
SELECT 
    COUNT(*) as records_with_parent_code
FROM gl_accounts 
WHERE parent_code IS NOT NULL 
AND parent_code != '';

-- 11. Check for root accounts (no parent)
SELECT 
    COUNT(*) as root_accounts
FROM gl_accounts 
WHERE parent_code IS NULL OR parent_code = '';