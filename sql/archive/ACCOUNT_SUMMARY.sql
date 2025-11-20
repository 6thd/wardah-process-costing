-- ACCOUNT_SUMMARY.sql
-- Script to provide a summary of gl_accounts by category

-- Count accounts by category
SELECT 
    category,
    COUNT(*) as account_count
FROM gl_accounts
GROUP BY category
ORDER BY category;

-- Show root accounts (no parent)
SELECT 
    code,
    name,
    category,
    parent_code
FROM gl_accounts
WHERE parent_code IS NULL
ORDER BY code;

-- Show accounts with children
SELECT 
    parent_code,
    COUNT(*) as child_count
FROM gl_accounts
WHERE parent_code IS NOT NULL
GROUP BY parent_code
ORDER BY child_count DESC;

-- Show accounts with no children (leaf nodes)
SELECT 
    code,
    name,
    category
FROM gl_accounts g1
WHERE NOT EXISTS (
    SELECT 1 
    FROM gl_accounts g2 
    WHERE g2.parent_code = g1.code
)
ORDER BY code;

-- Total account count
SELECT COUNT(*) as total_accounts FROM gl_accounts;