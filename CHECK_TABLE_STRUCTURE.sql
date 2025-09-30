-- CHECK_TABLE_STRUCTURE.sql
-- Script to check the structure of the gl_accounts table

SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;