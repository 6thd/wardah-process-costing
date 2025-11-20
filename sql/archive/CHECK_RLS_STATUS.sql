-- CHECK_RLS_STATUS.sql
-- Script to check the current RLS status of gl_accounts tables

-- Check if RLS is enabled on gl_accounts tables
SELECT 
    tablename, 
    rowsecurity as rls_enabled
FROM pg_tables 
WHERE tablename IN ('gl_accounts', 'gl_accounts_backup');

-- List existing policies on gl_accounts tables
SELECT 
    polname as policy_name,
    relname as table_name,
    polcmd as command,
    polqual as using_expression,
    polwithcheck as with_check_expression
FROM pg_policy p
JOIN pg_class c ON p.polrelid = c.oid
WHERE c.relname IN ('gl_accounts', 'gl_accounts_backup');

-- Check table permissions
SELECT 
    grantee,
    table_name,
    privilege_type
FROM information_schema.table_privileges
WHERE table_name IN ('gl_accounts', 'gl_accounts_backup')
ORDER BY table_name, grantee, privilege_type;