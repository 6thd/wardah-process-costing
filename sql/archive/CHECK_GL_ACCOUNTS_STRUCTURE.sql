-- CHECK_GL_ACCOUNTS_STRUCTURE.sql
-- Script to check the actual structure of gl_accounts table and display complete chart of accounts

-- 1. Show all columns in gl_accounts table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- 2. Check total count of accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- 3. Check how many accounts have org_id
SELECT COUNT(*) as accounts_with_org_id FROM gl_accounts WHERE org_id IS NOT NULL;

-- 4. Check distinct org_id values
SELECT org_id, COUNT(*) as count 
FROM gl_accounts 
WHERE org_id IS NOT NULL 
GROUP BY org_id 
ORDER BY count DESC;

-- 5. Get all accounts with a large limit (using actual columns)
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

-- 6. Get accounts with default org_id
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

-- 7. Display complete chart of accounts in hierarchical structure
-- This query shows all 190 accounts organized by their hierarchy
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

-- 8. Count accounts by level to verify hierarchy
WITH RECURSIVE account_tree AS (
  -- Root level accounts
  SELECT 
    id,
    code,
    name,
    parent_code,
    0 as level
  FROM gl_accounts
  WHERE parent_code IS NULL
  
  UNION ALL
  
  -- Child accounts
  SELECT 
    child.id,
    child.code,
    child.name,
    child.parent_code,
    parent.level + 1
  FROM gl_accounts child
  JOIN account_tree parent ON child.parent_code = parent.code
)
SELECT 
  level,
  COUNT(*) as account_count
FROM account_tree
GROUP BY level
ORDER BY level;

-- 9. Display complete WARDAH ERP Chart of Accounts tree structure
-- This query shows all accounts organized by their hierarchy from the wardah_enhanced_coa.csv file
WITH RECURSIVE wardah_coa_tree AS (
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
  WHERE parent_code IS NULL OR parent_code = ''
  
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
  JOIN wardah_coa_tree parent ON child.parent_code = parent.code
)
SELECT 
  level,
  REPEAT('  ', level) || code as indented_code,
  REPEAT('  ', level) || name as indented_name,
  category,
  subtype,
  parent_code
FROM wardah_coa_tree
ORDER BY sort_path;