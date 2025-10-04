-- Test to check if get_current_tenant_id function exists and works
-- Run this in your Supabase SQL Editor to verify

-- First, check if the function exists
SELECT 
    proname AS function_name,
    pg_get_function_arguments(p.oid) AS arguments,
    pg_get_function_result(p.oid) AS return_type
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE proname = 'get_current_tenant_id'
AND n.nspname = 'public';

-- Try to call the function
SELECT get_current_tenant_id();