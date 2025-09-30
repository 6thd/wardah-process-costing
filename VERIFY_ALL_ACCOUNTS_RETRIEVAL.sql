-- VERIFY_ALL_ACCOUNTS_RETRIEVAL.sql
-- Script to verify that we can retrieve all gl_accounts records

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

-- 4. Get all accounts with a large limit
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

-- 5. Get accounts with default org_id
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
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code
LIMIT 10000;