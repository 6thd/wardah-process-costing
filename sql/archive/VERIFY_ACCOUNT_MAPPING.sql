-- VERIFY_ACCOUNT_MAPPING.sql
-- Script to verify that accounts are properly mapped according to WARDAH ERP HANDOVER file

-- 1. Check total accounts count
SELECT COUNT(*) as total_accounts_in_db FROM gl_accounts;

-- 2. Check how many accounts from the WARDAH COA file are in the database
-- First, let's see what accounts we have in the CSV file
-- Since we can't directly read CSV in SQL, we'll check for specific key accounts

-- 3. Check for presence of major account categories
SELECT 
  SUBSTRING(code, 1, 2) as account_group,
  COUNT(*) as count
FROM gl_accounts
GROUP BY SUBSTRING(code, 1, 2)
ORDER BY account_group;

-- 4. Check for specific key accounts that should exist based on the WARDAH COA
SELECT code, name, category, subtype, parent_code
FROM gl_accounts
WHERE code IN (
  '100000',  -- الأصول (Assets)
  '110000',  -- الأصول المتداولة (Current Assets)
  '110100',  -- النقد ومايعادله (Cash)
  '110200',  -- النقدية في البنوك (Bank)
  '130000',  -- المخزون (Inventory)
  '200000',  -- الالتزامات (Liabilities)
  '300000',  -- حقوق الملكية (Equity)
  '400000',  -- الإيرادات (Revenue)
  '500000',  -- التكاليف والمصروفات (Expenses)
  '131000',  -- مواد خام (Raw Materials)
  '134000',  -- إنتاج تحت التشغيل (WIP)
  '135000'   -- مخزون تام الصنع (Finished Goods)
)
ORDER BY code;

-- 5. Check for accounts with specific categories
SELECT category, COUNT(*) as count
FROM gl_accounts
GROUP BY category
ORDER BY category;

-- 6. Check for accounts with specific subtypes
SELECT subtype, COUNT(*) as count
FROM gl_accounts
WHERE subtype IS NOT NULL
GROUP BY subtype
ORDER BY subtype;

-- 7. Check for parent-child relationships integrity
-- Accounts that have parent_code but parent doesn't exist
SELECT 
  id,
  code,
  name,
  parent_code
FROM gl_accounts
WHERE parent_code IS NOT NULL 
  AND parent_code != ''
  AND parent_code NOT IN (SELECT code FROM gl_accounts)
ORDER BY code;

-- 8. Check for orphaned accounts (accounts that are not referenced as parents)
SELECT 
  code,
  name,
  category,
  subtype
FROM gl_accounts
WHERE code NOT IN (
  SELECT DISTINCT parent_code 
  FROM gl_accounts 
  WHERE parent_code IS NOT NULL AND parent_code != ''
)
  AND parent_code IS NULL
ORDER BY code;

-- 9. Show account hierarchy with level information
WITH RECURSIVE account_tree AS (
  -- Root level accounts
  SELECT 
    id,
    code,
    name,
    category,
    subtype,
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
    child.category,
    child.subtype,
    child.parent_code,
    parent.level + 1
  FROM gl_accounts child
  JOIN account_tree parent ON child.parent_code = parent.code
)
SELECT 
  level,
  REPEAT('  ', level) || code as indented_code,
  REPEAT('  ', level) || name as indented_name,
  category,
  subtype
FROM account_tree
ORDER BY level, code;

-- 10. Count accounts by level
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

-- 11. Check for accounts with empty parent_code (should be NULL instead)
SELECT COUNT(*) as accounts_with_empty_parent
FROM gl_accounts
WHERE parent_code = '';

-- 12. Show sample of leaf accounts (accounts with no children)
SELECT 
  code,
  name,
  category,
  subtype,
  parent_code
FROM gl_accounts g1
WHERE NOT EXISTS (
  SELECT 1 
  FROM gl_accounts g2 
  WHERE g2.parent_code = g1.code
)
  AND g1.parent_code IS NOT NULL
ORDER BY code
LIMIT 20;