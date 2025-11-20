-- TEST_ACCOUNT_RETRIEVAL.sql
-- Script to test account retrieval and verify we can get all 190 accounts

-- 1. Check total count of accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- 2. Check how many accounts have org_id
SELECT COUNT(*) as accounts_with_org_id FROM gl_accounts WHERE org_id IS NOT NULL;

-- 3. Check distinct org_id values
SELECT org_id, COUNT(*) as count 
FROM gl_accounts 
WHERE org_id IS NOT NULL 
GROUP BY org_id 
ORDER BY count DESC;

-- 4. Get all accounts with a large limit (should return all 190)
SELECT 
    id,
    org_id,
    code,
    name,
    category,
    subtype,
    parent_code,
    normal_balance,
    allow_posting,
    is_active,
    currency,
    notes,
    created_at,
    updated_at
FROM gl_accounts
ORDER BY code
LIMIT 10000;

-- 5. Check if there are any accounts with the default org_id
SELECT COUNT(*) as default_org_accounts 
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- 6. Check sample of accounts to verify data structure
SELECT 
    id,
    org_id,
    code,
    name,
    category,
    subtype,
    parent_code,
    normal_balance,
    allow_posting,
    is_active,
    currency
FROM gl_accounts
ORDER BY code
LIMIT 10;