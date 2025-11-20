-- DISPLAY_WARDAH_COA_TREE.sql
-- Script to display the complete WARDAH ERP Chart of Accounts from wardah_enhanced_coa.csv in hierarchical tree structure

-- 1. First, let's check the total count of accounts in the database
SELECT COUNT(*) as total_accounts FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- 2. Check how many accounts have parent_code relationships
SELECT 
  COUNT(*) as total_accounts,
  COUNT(CASE WHEN parent_code IS NULL OR parent_code = '' THEN 1 END) as root_accounts,
  COUNT(CASE WHEN parent_code IS NOT NULL AND parent_code != '' THEN 1 END) as child_accounts
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- 3. Display the complete chart of accounts in hierarchical order
-- This query shows all accounts organized by their hierarchy level using recursive CTE
WITH RECURSIVE account_hierarchy AS (
  -- Root accounts (those with no parent or empty parent)
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
    parent_code,
    0 as level,
    CAST(code AS VARCHAR(1000)) as sort_path
  FROM gl_accounts 
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
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
    CAST(parent.sort_path || '.' || child.code AS VARCHAR(1000)) as sort_path
  FROM gl_accounts child
  JOIN account_hierarchy parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  level,
  REPEAT('  ', level) || code as indented_code,
  REPEAT('  ', level) || name as indented_name,
  category,
  subtype,
  parent_code
FROM account_hierarchy
ORDER BY sort_path;

-- 4. Alternative view with visual tree indicators
WITH RECURSIVE account_tree AS (
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
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
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
  JOIN account_tree parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  level,
  CASE 
    WHEN level = 0 THEN '├── ' 
    ELSE REPEAT('│   ', level) || '├── ' 
  END || code as tree_code,
  name,
  category,
  subtype
FROM account_tree
ORDER BY path;

-- 5. Show accounts grouped by their hierarchy levels
WITH RECURSIVE account_levels AS (
  -- Level 0 (root accounts)
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
    parent_code,
    0 as level
  FROM gl_accounts 
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
  UNION ALL
  
  -- Child accounts at each level
  SELECT 
    child.id,
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    parent.level + 1 as level
  FROM gl_accounts child
  JOIN account_levels parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  level,
  COUNT(*) as account_count,
  STRING_AGG(code || ' - ' || name, ', ' ORDER BY code) as accounts
FROM account_levels
GROUP BY level
ORDER BY level;

-- 6. Show accounts with missing parent references (orphans)
SELECT 
  id,
  code,
  name,
  parent_code,
  'Orphaned account - parent does not exist' as issue
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
  AND parent_code IS NOT NULL 
  AND parent_code != ''
  AND parent_code NOT IN (SELECT code FROM gl_accounts WHERE org_id = '00000000-0000-0000-0000-000000000001')
ORDER BY code;

-- 7. Show leaf accounts (accounts with no children)
SELECT 
  g1.code,
  g1.name,
  g1.category,
  g1.subtype,
  g1.parent_code
FROM gl_accounts g1
WHERE NOT EXISTS (
  SELECT 1 
  FROM gl_accounts g2 
  WHERE g2.parent_code = g1.code
    AND g2.org_id = '00000000-0000-0000-0000-000000000001'
)
  AND (g1.parent_code IS NOT NULL AND g1.parent_code != '')
  AND g1.org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY g1.code;

-- 8. Detailed view with all account information
WITH RECURSIVE account_details AS (
  -- Root accounts
  SELECT 
    id,
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
    0 as level,
    CAST(code AS VARCHAR(1000)) as hierarchy_path
  FROM gl_accounts 
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.id,
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    child.normal_balance,
    child.allow_posting,
    child.is_active,
    child.currency,
    child.notes,
    parent.level + 1 as level,
    CAST(parent.hierarchy_path || ' > ' || child.code AS VARCHAR(1000)) as hierarchy_path
  FROM gl_accounts child
  JOIN account_details parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  level,
  hierarchy_path,
  code,
  name,
  category,
  subtype,
  parent_code,
  normal_balance,
  CASE WHEN allow_posting THEN 'Yes' ELSE 'No' END as allow_posting,
  CASE WHEN is_active THEN 'Yes' ELSE 'No' END as is_active,
  currency
FROM account_details
ORDER BY hierarchy_path;

-- 9. Statistics by category
WITH RECURSIVE account_stats AS (
  -- Root accounts
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
    parent_code,
    allow_posting,
    is_active,
    0 as level
  FROM gl_accounts 
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.id,
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    child.allow_posting,
    child.is_active,
    parent.level + 1 as level
  FROM gl_accounts child
  JOIN account_stats parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  category,
  COUNT(*) as total_accounts,
  COUNT(CASE WHEN allow_posting THEN 1 END) as posting_allowed,
  COUNT(CASE WHEN is_active THEN 1 END) as active_accounts,
  COUNT(CASE WHEN level = 0 THEN 1 END) as root_accounts
FROM account_stats
GROUP BY category
ORDER BY total_accounts DESC;

-- 10. Show the complete hierarchy with proper indentation
WITH RECURSIVE chart_of_accounts AS (
  -- Root level accounts
  SELECT 
    code,
    name,
    category,
    subtype,
    parent_code,
    0 as level,
    CAST(code AS VARCHAR(1000)) as sort_key
  FROM gl_accounts
  WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.code,
    child.name,
    child.category,
    child.subtype,
    child.parent_code,
    parent.level + 1,
    CAST(parent.sort_key || '.' || child.code AS VARCHAR(1000))
  FROM gl_accounts child
  JOIN chart_of_accounts parent ON child.parent_code = parent.code
  WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
)
SELECT 
  REPEAT('  ', level) || code || ' - ' || name as account_tree,
  category,
  subtype,
  CASE WHEN level = 0 THEN 'ROOT' ELSE 'CHILD' END as node_type
FROM chart_of_accounts
ORDER BY sort_key;