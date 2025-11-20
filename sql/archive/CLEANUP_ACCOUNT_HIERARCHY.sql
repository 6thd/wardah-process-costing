-- CLEANUP_ACCOUNT_HIERARCHY.sql
-- Script to clean up issues in the gl_accounts hierarchy

-- 1. Fix accounts with empty string parent_code (convert to NULL)
UPDATE gl_accounts 
SET parent_code = NULL 
WHERE parent_code = '';

-- 2. Identify and handle accounts with invalid parent codes
-- First, let's see what these accounts are
SELECT id, code, name, parent_code 
FROM gl_accounts
WHERE parent_code IS NOT NULL
AND parent_code NOT IN (SELECT code FROM gl_accounts);

-- Note: Uncomment the following UPDATE statement if you want to remove invalid parent codes
-- UPDATE gl_accounts 
-- SET parent_code = NULL
-- WHERE parent_code IS NOT NULL
-- AND parent_code NOT IN (SELECT code FROM gl_accounts);

-- 3. Check for and handle circular references
SELECT id, code, name, parent_code 
FROM gl_accounts
WHERE code = parent_code;

-- Note: Uncomment the following UPDATE statement if you want to remove circular references
-- UPDATE gl_accounts 
-- SET parent_code = NULL
-- WHERE code = parent_code;

-- 4. Verify the cleanup
SELECT COUNT(*) as total_accounts FROM gl_accounts;
SELECT COUNT(*) as root_accounts FROM gl_accounts WHERE parent_code IS NULL;
SELECT COUNT(*) as accounts_with_empty_parent FROM gl_accounts WHERE parent_code = '';
SELECT COUNT(*) as accounts_with_invalid_parent 
FROM gl_accounts
WHERE parent_code IS NOT NULL
AND parent_code NOT IN (SELECT code FROM gl_accounts);

-- 5. Show the cleaned hierarchy structure
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