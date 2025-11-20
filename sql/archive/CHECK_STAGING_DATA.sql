-- CHECK_STAGING_DATA.sql
-- Script to check if staging data exists and import if needed

-- 1. Check if staging table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_name = 'stg_coa'
) as staging_table_exists;

-- 2. Provide clear instructions based on table existence
WITH table_check AS (
    SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'stg_coa'
    ) as table_exists
)
SELECT 
    CASE 
        WHEN table_exists THEN 
            '✅ Staging table exists. You can now check record count and sample data with these queries:
             SELECT COUNT(*) as staging_records FROM stg_coa;
             SELECT code, name, category, parent_code FROM stg_coa LIMIT 5;'
        ELSE 
            '❌ Staging table does not exist. Please follow the import instructions below:'
    END as next_steps
FROM table_check;

-- 3. Instructions for importing CSV data
/*
STEPS TO IMPORT CSV DATA:

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

3. After importing, verify the data:
   SELECT COUNT(*) as staging_records FROM stg_coa;
   SELECT code, name, category, parent_code FROM stg_coa LIMIT 5;

4. Then run the VERIFY_AND_FIX_GL_ACCOUNTS.sql script
*/