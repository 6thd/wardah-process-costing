-- CHECK_GL_ACCOUNTS_SCHEMA.sql
-- Script to check the current schema of gl_accounts table

-- Show all columns in gl_accounts table
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- Check if ltree extension is available
SELECT * FROM pg_extension WHERE extname = 'ltree';

-- Check indexes on gl_accounts table
SELECT 
    indexname,
    indexdef
FROM pg_indexes 
WHERE tablename = 'gl_accounts';

-- Show sample data to understand current structure
SELECT 
    id,
    org_id,
    code,
    name,
    category,
    parent_code
FROM gl_accounts
LIMIT 10;