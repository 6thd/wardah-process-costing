-- Wardah ERP - Check Existing RLS Policies
-- Run this to see what policies already exist in your database

SELECT 
    schemaname,
    tablename,
    policyname,
    permissive,
    roles,
    cmd
FROM pg_policies 
WHERE schemaname = 'public'
ORDER BY tablename, policyname;