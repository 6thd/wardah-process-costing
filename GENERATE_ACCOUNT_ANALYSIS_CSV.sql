-- GENERATE_ACCOUNT_ANALYSIS_CSV.sql
-- Script to generate CSV-formatted output for account analysis

-- 1. Basic statistics
-- COPY (
SELECT 'Metric,Value' as csv_line
UNION ALL
SELECT 'Total Accounts,' || COUNT(*) as csv_line FROM gl_accounts
UNION ALL
SELECT 'Root Accounts (NULL parent_code),' || COUNT(*) as csv_line FROM gl_accounts WHERE parent_code IS NULL
UNION ALL
SELECT 'Child Accounts (with parent_code),' || COUNT(*) as csv_line FROM gl_accounts WHERE parent_code IS NOT NULL
UNION ALL
SELECT 'Empty String Parent Codes,' || COUNT(*) as csv_line FROM gl_accounts WHERE parent_code = ''
-- ) TO '/path/to/basic_stats.csv' WITH CSV;

-- 2. Issue checks
-- COPY (
UNION ALL
SELECT ''
UNION ALL
SELECT 'Issue Type,Count' as csv_line
UNION ALL
SELECT 'Accounts with Invalid Parents,' || COUNT(*) as csv_line
FROM gl_accounts
WHERE parent_code IS NOT NULL
AND parent_code NOT IN (SELECT code FROM gl_accounts)
UNION ALL
SELECT 'Circular References,' || COUNT(*) as csv_line
FROM gl_accounts
WHERE code = parent_code
-- ) TO '/path/to/issues.csv' WITH CSV;

-- 3. Account distribution by category
-- COPY (
UNION ALL
SELECT ''
UNION ALL
SELECT 'Category,Account Count,Percentage' as csv_line
UNION ALL
SELECT 
    category || ',' || 
    COUNT(*) || ',' || 
    ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM gl_accounts), 2)
FROM gl_accounts
GROUP BY category
ORDER BY COUNT(*) DESC
-- ) TO '/path/to/category_distribution.csv' WITH CSV;

-- 4. Account hierarchy
-- COPY (
UNION ALL
SELECT ''
UNION ALL
SELECT 'Code,Name,Category,Parent Code,Parent Name' as csv_line
UNION ALL
SELECT 
    COALESCE(g1.code, '') || ',' || 
    COALESCE(REPLACE(g1.name, ',', ';'), '') || ',' || 
    COALESCE(g1.category, '') || ',' || 
    COALESCE(g1.parent_code, '') || ',' || 
    COALESCE(REPLACE(g2.name, ',', ';'), '')
FROM gl_accounts g1
LEFT JOIN gl_accounts g2 ON g1.parent_code = g2.code
ORDER BY g1.code
-- ) TO '/path/to/account_hierarchy.csv' WITH CSV;

-- 5. Accounts with most children
-- COPY (
UNION ALL
SELECT ''
UNION ALL
SELECT 'Code,Name,Child Count' as csv_line
UNION ALL
SELECT 
    g1.code || ',' || 
    COALESCE(REPLACE(g1.name, ',', ';'), '') || ',' || 
    COUNT(g2.code)
FROM gl_accounts g1
LEFT JOIN gl_accounts g2 ON g2.parent_code = g1.code
GROUP BY g1.code, g1.name
ORDER BY COUNT(g2.code) DESC
LIMIT 10
-- ) TO '/path/to/top_parents.csv' WITH CSV;

-- 6. Leaf nodes
-- COPY (
UNION ALL
SELECT ''
UNION ALL
SELECT 'Code,Name,Category' as csv_line
UNION ALL
SELECT 
    code || ',' || 
    COALESCE(REPLACE(name, ',', ';'), '') || ',' || 
    category
FROM gl_accounts g1
WHERE NOT EXISTS (
    SELECT 1 
    FROM gl_accounts g2 
    WHERE g2.parent_code = g1.code
)
ORDER BY code
-- ) TO '/path/to/leaf_nodes.csv' WITH CSV;

-- 7. Organization distribution
-- COPY (
UNION ALL
SELECT ''
UNION ALL
SELECT 'Org ID,Account Count' as csv_line
UNION ALL
SELECT 
    org_id || ',' || 
    COUNT(*)
FROM gl_accounts
GROUP BY org_id
ORDER BY COUNT(*) DESC
-- ) TO '/path/to/org_distribution.csv' WITH CSV;