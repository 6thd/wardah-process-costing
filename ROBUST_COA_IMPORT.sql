-- ROBUST_COA_IMPORT.sql
-- Robust approach to import all 190 accounts from wardah_enhanced_coa.csv
-- This approach handles constraint issues gracefully

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

-- STEP 2: Import CSV into stg_coa
-- NOTE: This step must be done manually through Supabase SQL Editor:
-- 1. From SQL Editor click Import
-- 2. Choose file: wardah_erp_handover/wardah_enhanced_coa.csv
-- 3. Target table: stg_coa

-- STEP 3: Check for existing data and handle accordingly
-- First, check if there are existing records for this org_id
SELECT COUNT(*) as existing_records FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- STEP 4: Insert data into gl_accounts with error handling
-- Approach 1: Try direct insert (will fail if duplicates exist)
DO $$
BEGIN
  -- Try to insert directly first
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
  
  RAISE NOTICE 'Direct insert successful';
  
EXCEPTION WHEN unique_violation THEN
  -- If direct insert fails due to duplicates, handle them
  RAISE NOTICE 'Direct insert failed due to duplicates, handling existing records...';
  
  -- Delete existing records for this org_id
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
  
  RAISE NOTICE 'Records replaced successfully';
END;
$$;

-- STEP 5: Verify the count of imported accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- STEP 6: Check for any accounts with duplicate codes
SELECT org_id, code, COUNT(*) as cnt
FROM gl_accounts
WHERE org_id = '00000000-0000-0000-0000-000000000001'
GROUP BY org_id, code
HAVING COUNT(*) > 1;

-- STEP 7: Add temporary anonymous read policy for demo purposes
DROP POLICY IF EXISTS "read gl anon demo" ON gl_accounts;
CREATE POLICY "read gl anon demo"
ON gl_accounts FOR SELECT TO anon
USING (org_id = '00000000-0000-0000-0000-000000000001');

-- STEP 8: Display complete chart of accounts in hierarchical tree structure
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