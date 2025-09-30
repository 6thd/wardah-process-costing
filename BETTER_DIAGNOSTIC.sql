-- BETTER_DIAGNOSTIC.sql
-- Better diagnostic script to understand the current state of gl_accounts

-- 1. Check total count of accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- 2. Check accounts with default org_id
SELECT COUNT(*) as accounts_with_default_org 
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- 3. Check accounts with NULL org_id
SELECT COUNT(*) as accounts_with_null_org 
FROM gl_accounts 
WHERE org_id IS NULL;

-- 4. Show all distinct org_id values
SELECT 
    org_id,
    COUNT(*) as account_count
FROM gl_accounts 
GROUP BY org_id
ORDER BY account_count DESC;

-- 5. Show sample of all accounts
SELECT 
    id,
    code,
    name,
    org_id
FROM gl_accounts
ORDER BY code;