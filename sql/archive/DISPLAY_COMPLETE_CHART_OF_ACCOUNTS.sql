-- DISPLAY_COMPLETE_CHART_OF_ACCOUNTS.sql
-- Script to display the complete Chart of Accounts with proper hierarchy (190 accounts)
-- This script shows all accounts organized in a tree structure based on parent_code relationships

-- 1. First, let's check the total count of accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- 2. Check accounts with and without parent codes
SELECT 
  COUNT(*) as total_accounts,
  COUNT(CASE WHEN parent_code IS NULL THEN 1 END) as root_accounts,
  COUNT(CASE WHEN parent_code IS NOT NULL THEN 1 END) as child_accounts
FROM gl_accounts;

-- 3. Display the complete chart of accounts in hierarchical order
-- This query shows all accounts organized by their hierarchy level
WITH RECURSIVE account_hierarchy AS (
  -- Root accounts (those with no parent)
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
    parent_code,
    0 as level,
    code as path_sort
  FROM gl_accounts 
  WHERE parent_code IS NULL
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.id,
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    parent.level + 1 as level,
    parent.path_sort || '.' || child.code as path_sort
  FROM gl_accounts child
  JOIN account_hierarchy parent ON child.parent_code = parent.code
)
SELECT 
  REPEAT('  ', level) || code as indented_code,
  REPEAT('  ', level) || name as indented_name,
  category,
  subtype,
  parent_code,
  level
FROM account_hierarchy
ORDER BY path_sort;

-- 4. Alternative view with explicit level indicators
WITH RECURSIVE account_hierarchy AS (
  -- Root accounts
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
    parent_code,
    0 as level,
    CAST(code AS VARCHAR(1000)) as path
  FROM gl_accounts 
  WHERE parent_code IS NULL
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.id,
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    parent.level + 1 as level,
    CAST(parent.path || '->' || child.code AS VARCHAR(1000)) as path
  FROM gl_accounts child
  JOIN account_hierarchy parent ON child.parent_code = parent.code
)
SELECT 
  level,
  REPEAT('─', level*2) || ' ' || code as tree_code,
  name,
  category,
  subtype,
  parent_code
FROM account_hierarchy
ORDER BY path;

-- 5. Show accounts with missing parent references (orphans)
SELECT 
  id,
  code,
  name,
  parent_code
FROM gl_accounts 
WHERE parent_code IS NOT NULL 
  AND parent_code NOT IN (SELECT code FROM gl_accounts)
ORDER BY code;

-- 6. Show accounts grouped by their parent (to verify hierarchy)
SELECT 
  g1.code as parent_code,
  g1.name as parent_name,
  COUNT(g2.id) as child_count
FROM gl_accounts g1
LEFT JOIN gl_accounts g2 ON g2.parent_code = g1.code
WHERE g1.parent_code IS NULL  -- Only root accounts
GROUP BY g1.id, g1.code, g1.name
ORDER BY g1.code;

-- 7. Detailed view of all accounts with their hierarchy level
WITH RECURSIVE account_hierarchy AS (
  -- Root accounts
  SELECT 
    id,
    code,
    name,
    name_ar,
    category,
    subtype,
    parent_code,
    normal_balance,
    allow_posting,
    is_active,
    0 as level,
    CAST(code AS VARCHAR(1000)) as hierarchy_path
  FROM gl_accounts 
  WHERE parent_code IS NULL
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.id,
    child.code,
    child.name,
    child.name_ar,
    child.category,
    child.subtype,
    child.parent_code,
    child.normal_balance,
    child.allow_posting,
    child.is_active,
    parent.level + 1 as level,
    CAST(parent.hierarchy_path || ' > ' || child.code AS VARCHAR(1000)) as hierarchy_path
  FROM gl_accounts child
  JOIN account_hierarchy parent ON child.parent_code = parent.code
)
SELECT 
  level,
  hierarchy_path,
  code,
  name,
  name_ar,
  category,
  subtype,
  parent_code,
  normal_balance,
  allow_posting,
  is_active
FROM account_hierarchy
ORDER BY hierarchy_path;