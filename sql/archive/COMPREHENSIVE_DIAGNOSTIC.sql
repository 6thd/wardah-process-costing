-- COMPREHENSIVE_DIAGNOSTIC.sql
-- Comprehensive diagnostic script to understand the current state of gl_accounts

-- 1. Check total count of accounts
SELECT 'Total accounts' as metric, COUNT(*) as value FROM gl_accounts
UNION ALL
-- 2. Check accounts with org_id
SELECT 'Accounts with org_id' as metric, COUNT(*) as value FROM gl_accounts WHERE org_id IS NOT NULL
UNION ALL
-- 3. Check accounts with default org_id
SELECT 'Accounts with default org_id' as metric, COUNT(*) as value FROM gl_accounts WHERE org_id = '00000000-0000-0000-0000-000000000001'
UNION ALL
-- 4. Check accounts with NULL org_id
SELECT 'Accounts with NULL org_id' as metric, COUNT(*) as value FROM gl_accounts WHERE org_id IS NULL
UNION ALL
-- 5. Check distinct org_id values
SELECT 'Distinct org_id values' as metric, COUNT(DISTINCT org_id) as value FROM gl_accounts;

-- 6. Show sample of accounts with their org_id values
SELECT 
    id,
    code,
    name,
    org_id,
    CASE 
        WHEN org_id IS NULL THEN 'NULL'
        WHEN org_id = '00000000-0000-0000-0000-000000000000' THEN 'ZERO UUID'
        WHEN org_id = '00000000-0000-0000-0000-000000000001' THEN 'DEFAULT ORG'
        ELSE 'OTHER'
    END as org_id_type
FROM gl_accounts
ORDER BY code
LIMIT 20;

-- 7. Check for any potential issues with parent_code references
SELECT 
    COUNT(*) as accounts_with_invalid_parent
FROM gl_accounts 
WHERE parent_code IS NOT NULL 
AND parent_code != ''
AND parent_code NOT IN (SELECT code FROM gl_accounts WHERE code IS NOT NULL);