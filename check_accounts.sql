-- Check the structure and data of gl_accounts table
-- This query should help us understand what's in the table

-- First, check the table structure using standard SQL
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- Check how many records we have
SELECT COUNT(*) as total_records FROM gl_accounts;

-- Check sample data with path information
SELECT id, code, name, org_id, category, parent_code
FROM gl_accounts 
ORDER BY code 
LIMIT 10;

-- Check org_id distribution
SELECT org_id, COUNT(*) as count 
FROM gl_accounts 
GROUP BY org_id 
ORDER BY count DESC;

-- Check if there are any accounts with null org_id
SELECT COUNT(*) as null_org_count 
FROM gl_accounts 
WHERE org_id IS NULL;

-- Check if there are any accounts with empty org_id
SELECT COUNT(*) as empty_org_count 
FROM gl_accounts 
WHERE org_id = '00000000-0000-0000-0000-000000000000';