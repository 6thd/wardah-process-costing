-- VERIFY_AND_FIX_GL_ACCOUNTS.sql
-- Script to verify and fix gl_accounts data

-- 1. First, let's check what we currently have
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN org_id = '00000000-0000-0000-0000-000000000001' THEN 1 END) as default_org_records,
    COUNT(CASE WHEN org_id IS NULL THEN 1 END) as null_org_records
FROM gl_accounts;

-- 2. Check if we have the staging table with data
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_name = 'stg_coa'
) as staging_table_exists;

-- 3. Instructions for creating and importing staging data (if needed)
/*
IF THE ABOVE SHOWS 'false' FOR staging_table_exists, YOU NEED TO:

1. Create the staging table:
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

2. Import the CSV data through Supabase SQL Editor:
   - Open SQL Editor
   - Click "Import"
   - Select file: wardah_erp_handover/wardah_enhanced_coa.csv
   - Target table: stg_coa
   - Click "Import"

3. Then run this script again
*/

-- 4. Only proceed with the following steps if staging table exists
-- Check record count in staging table (run this separately after creating/importing)
-- SELECT COUNT(*) as staging_records FROM stg_coa;

-- 5. If staging table exists and has data, run these commands:
/*
-- First, delete any existing records for the default org
DELETE FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001';

-- Then, insert data from staging table
INSERT INTO gl_accounts (
    org_id, code, name, category, subtype, parent_code,
    normal_balance, allow_posting, is_active, currency, notes
)
SELECT
    '00000000-0000-0000-0000-000000000001'::uuid,
    code, name, category, subtype, 
    CASE 
        WHEN parent_code = '' THEN NULL 
        ELSE parent_code 
    END as parent_code,
    normal_balance, 
    COALESCE(allow_posting, true), 
    COALESCE(is_active, true),
    COALESCE(currency, 'SAR'), 
    CASE 
        WHEN notes = '' THEN NULL 
        ELSE notes 
    END as notes
FROM stg_coa;
*/

-- 6. After importing, verify the results
SELECT 
    COUNT(*) as total_records,
    COUNT(CASE WHEN org_id = '00000000-0000-0000-0000-000000000001' THEN 1 END) as default_org_records
FROM gl_accounts;

-- 7. Show sample of imported records
SELECT 
    code,
    name,
    category,
    parent_code,
    is_active,
    allow_posting
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
ORDER BY code
LIMIT 20;

-- 8. Check hierarchy structure
SELECT 
    COUNT(*) as root_accounts
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND (parent_code IS NULL OR parent_code = '');

SELECT 
    COUNT(*) as child_accounts
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND parent_code IS NOT NULL 
AND parent_code != '';

-- 9. Show root accounts
SELECT 
    code,
    name,
    category
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000001'
AND (parent_code IS NULL OR parent_code = '')
ORDER BY code;

-- 10. Add read policy for anonymous access (for demo)
DROP POLICY IF EXISTS "read gl anon demo" ON gl_accounts;
CREATE POLICY "read gl anon demo"
ON gl_accounts FOR SELECT TO anon
USING (org_id = '00000000-0000-0000-0000-000000000001');

-- 11. Show simple hierarchy example (run this separately to see the tree)
/*
WITH RECURSIVE account_tree AS (
    -- Root accounts
    SELECT 
        code,
        name,
        category,
        parent_code,
        0 as level
    FROM gl_accounts 
    WHERE org_id = '00000000-0000-0000-0000-000000000001'
    AND (parent_code IS NULL OR parent_code = '')
    
    UNION ALL
    
    -- Child accounts (first level only for brevity)
    SELECT 
        child.code,
        child.name,
        child.category,
        child.parent_code,
        parent.level + 1
    FROM gl_accounts child
    JOIN account_tree parent ON child.parent_code = parent.code
    WHERE child.org_id = '00000000-0000-0000-0000-000000000001'
    AND parent.level < 2  -- Limit depth for readability
)
SELECT 
    REPEAT('  ', level) || code as indented_code,
    REPEAT('  ', level) || name as indented_name,
    category
FROM account_tree
ORDER BY code;
*/