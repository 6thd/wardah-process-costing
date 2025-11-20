-- Check for recursive functions that might be causing stack depth issues
SELECT 
    proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM 
    pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE 
    n.nspname = 'public'
    AND pg_get_functiondef(p.oid) ILIKE '%recursive%'
ORDER BY 
    proname;

-- Check for functions with deep recursion patterns
SELECT 
    proname as function_name,
    pg_get_functiondef(p.oid) as function_definition
FROM 
    pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE 
    n.nspname = 'public'
    AND (
        pg_get_functiondef(p.oid) ILIKE '%with%recursive%' OR
        pg_get_functiondef(p.oid) ILIKE '%loop%' OR
        pg_get_functiondef(p.oid) ILIKE '%while%'
    )
ORDER BY 
    proname;

-- Check for triggers that might cause recursion
SELECT 
    tgname as trigger_name,
    tgrelid::regclass as table_name,
    tgfoid::regproc as function_name
FROM 
    pg_trigger
WHERE 
    tgenabled = 'O'
ORDER BY 
    tgname;

-- Check for views that might cause recursion
SELECT 
    viewname,
    definition
FROM 
    pg_views
WHERE 
    schemaname = 'public'
    AND (
        definition ILIKE '%recursive%' OR
        definition ILIKE '%with%recursive%'
    )
ORDER BY 
    viewname;

-- Check current stack depth setting
SHOW max_stack_depth;

-- Check if there are any functions that might be causing the issue
SELECT 
    name, 
    setting, 
    context 
FROM 
    pg_settings 
WHERE 
    name = 'max_stack_depth';