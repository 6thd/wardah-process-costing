-- FIX_GET_ALL_GL_ACCOUNTS.sql
-- Script to test getting all gl_accounts records without any limits

-- First, let's check how many accounts we have
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- Then, let's get all accounts without any limits
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
ORDER BY code;

-- Also check accounts with a specific org_id
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
ORDER BY code;