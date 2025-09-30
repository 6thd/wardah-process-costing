-- IMPORT_COMPLETE_CHART_OF_ACCOUNTS.sql
-- Script to import all 190 accounts from wardah_enhanced_coa.csv and display them in hierarchical tree structure

-- STEP 1: Create temporary staging table
DROP TABLE IF EXISTS stg_coa;
CREATE TEMP TABLE stg_coa (
  code text, 
  name text, 
  category text, 
  subtype text, 
  parent_code text,
  normal_balance text, 
  allow_posting boolean, 
  is_active boolean,
  currency text, 
  notes text
);

-- STEP 3: Import CSV into stg_coa
-- NOTE: This step must be done manually through Supabase SQL Editor:
-- 1. From SQL Editor click Import
-- 2. Choose file: wardah_erp_handover/wardah_enhanced_coa.csv
-- 3. Target table: stg_coa

-- STEP 4: Insert data into gl_accounts
-- NOTE: You may need to temporarily disable RLS or use a service role to execute this
-- First, let's try to handle existing records by deleting them first (since ON CONFLICT is not working)
-- DELETE existing records for this org_id
DELETE FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- Now insert all records
INSERT INTO gl_accounts (
  org_id, code, name, category, subtype, parent_code,
  normal_balance, allow_posting, is_active, currency, notes
)
SELECT
  '00000000-0000-0000-0000-000000000001'::uuid,
  code, name, category, subtype, NULLIF(parent_code,''),
  normal_balance, COALESCE(allow_posting,true), COALESCE(is_active,true),
  COALESCE(currency,'SAR'), NULLIF(notes,'')
FROM stg_coa;

-- STEP 5: Verify the count of imported accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- STEP 6: Add temporary anonymous read policy for demo purposes
DROP POLICY IF EXISTS "read gl anon demo" ON gl_accounts;
CREATE POLICY "read gl anon demo"
ON gl_accounts FOR SELECT TO anon
USING (org_id = '00000000-0000-0000-0000-000000000001');

-- STEP 7: Display complete chart of accounts in hierarchical tree structure
-- This query shows all 190 accounts organized by their hierarchy
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

-- STEP 8: Show account statistics by category
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

-- STEP 9: Show accounts grouped by hierarchy levels
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

-- STEP 10: Detailed view with all account information
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