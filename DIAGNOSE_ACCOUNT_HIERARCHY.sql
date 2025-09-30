-- DIAGNOSE_ACCOUNT_HIERARCHY.sql
-- Script to diagnose and monitor the gl_accounts hierarchy

-- 1. Check total count of accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- 2. Check root accounts (those with no parent)
SELECT COUNT(*) as root_accounts FROM gl_accounts WHERE parent_code IS NULL;

-- 3. Check accounts with parent codes that don't exist
SELECT id, code, name, parent_code 
FROM gl_accounts
WHERE parent_code IS NOT NULL
AND parent_code NOT IN (SELECT code FROM gl_accounts);

-- 4. Check for potential cycles (accounts that are their own parent)
SELECT id, code, name, parent_code 
FROM gl_accounts
WHERE code = parent_code;

-- 5. Show account hierarchy structure
SELECT 
    code,
    name,
    parent_code,
    CASE 
        WHEN parent_code IS NULL THEN 'Root'
        ELSE 'Child'
    END as account_type
FROM gl_accounts
ORDER BY code;

-- 6. Check for accounts with empty string parent_code (should be NULL instead)
SELECT COUNT(*) as empty_parent_codes 
FROM gl_accounts 
WHERE parent_code = '';

-- 7. Show depth analysis (if path column exists)
-- This will help determine if we have the path column from previous implementations
SELECT 
    column_name,
    data_type
FROM information_schema.columns 
WHERE table_name = 'gl_accounts' 
AND column_name IN ('path', 'hierarchy_path', 'account_path');

-- 8. If path column exists, show depth distribution
-- This query will be extended after we check for path column existence