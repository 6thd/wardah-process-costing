-- CHECK_CURRENT_ACCOUNT_STATE.sql
-- Diagnostic script to check the current state of gl_accounts table

-- 1. Check table structure
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- 2. Count total records
SELECT COUNT(*) as total_records FROM gl_accounts;

-- 3. Check org_id distribution
SELECT 
    org_id, 
    COUNT(*) as account_count,
    CASE 
        WHEN org_id IS NULL THEN 'NULL'
        WHEN org_id = '00000000-0000-0000-0000-000000000000' THEN 'ZERO UUID'
        WHEN org_id = '00000000-0000-0000-0000-000000000001' THEN 'DEFAULT ORG'
        ELSE 'OTHER'
    END as org_id_type
FROM gl_accounts 
GROUP BY org_id
ORDER BY account_count DESC;

-- 4. Check for accounts with empty or invalid org_id
SELECT COUNT(*) as empty_org_count 
FROM gl_accounts 
WHERE org_id IS NULL OR org_id = '00000000-0000-0000-0000-000000000000';

-- 5. Sample data to understand structure
SELECT 
    id,
    org_id,
    code,
    name,
    category,
    parent_code,
    allow_posting,
    is_active
FROM gl_accounts
ORDER BY code
LIMIT 20;

-- 6. Check for any accounts with parent_code that don't exist as codes
SELECT DISTINCT parent_code 
FROM gl_accounts 
WHERE parent_code IS NOT NULL 
AND parent_code != ''
AND parent_code NOT IN (SELECT code FROM gl_accounts);

-- 7. Check account hierarchy depth
SELECT 
    code,
    name,
    parent_code,
    CASE 
        WHEN parent_code IS NULL OR parent_code = '' THEN 0
        ELSE 1
    END as depth_level
FROM gl_accounts
ORDER BY code
LIMIT 50;