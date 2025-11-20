-- SIMPLE_ACCOUNT_ANALYSIS.sql
-- Simplified analysis of gl_accounts hierarchy

-- 1. Basic statistics
SELECT 'Total Accounts' as metric, COUNT(*) as value FROM gl_accounts
UNION ALL
SELECT 'Root Accounts (NULL parent_code)' as metric, COUNT(*) as value FROM gl_accounts WHERE parent_code IS NULL
UNION ALL
SELECT 'Child Accounts (with parent_code)' as metric, COUNT(*) as value FROM gl_accounts WHERE parent_code IS NOT NULL
UNION ALL
SELECT 'Empty String Parent Codes' as metric, COUNT(*) as value FROM gl_accounts WHERE parent_code = '';

-- 2. Check for accounts with invalid parent references
SELECT 
    'Accounts with Invalid Parents' as issue_type,
    COUNT(*) as count
FROM gl_accounts
WHERE parent_code IS NOT NULL
AND parent_code NOT IN (SELECT code FROM gl_accounts);

-- 3. Check for circular references
SELECT 
    'Circular References' as issue_type,
    COUNT(*) as count
FROM gl_accounts
WHERE code = parent_code;

-- 4. Account distribution by category
SELECT 
    category,
    COUNT(*) as account_count,
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM gl_accounts), 2) as percentage
FROM gl_accounts
GROUP BY category
ORDER BY account_count DESC;

-- 5. Show all accounts with their parent information
SELECT 
    g1.code,
    g1.name,
    g1.category,
    g1.parent_code,
    g2.name as parent_name
FROM gl_accounts g1
LEFT JOIN gl_accounts g2 ON g1.parent_code = g2.code
ORDER BY g1.code;

-- 6. Find accounts with the most children
SELECT 
    g1.code,
    g1.name,
    COUNT(g2.code) as child_count
FROM gl_accounts g1
LEFT JOIN gl_accounts g2 ON g2.parent_code = g1.code
GROUP BY g1.code, g1.name
ORDER BY child_count DESC
LIMIT 10;

-- 7. Check for duplicate codes
SELECT 
    code,
    COUNT(*) as duplicate_count
FROM gl_accounts
GROUP BY code
HAVING COUNT(*) > 1;

-- 8. Show leaf nodes (accounts with no children)
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

-- 9. Organization distribution
SELECT 
    org_id,
    COUNT(*) as account_count
FROM gl_accounts
GROUP BY org_id
ORDER BY account_count DESC;

-- 10. Sample of all accounts
SELECT * FROM gl_accounts ORDER BY code LIMIT 20;