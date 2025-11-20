-- Check database structure
SELECT 
    table_schema, 
    table_name, 
    table_type
FROM 
    information_schema.tables 
WHERE 
    table_schema = 'public' 
    AND table_name IN (
        'organizations', 
        'user_organizations', 
        'gl_accounts', 
        'users',
        'gl_mappings'
    )
ORDER BY 
    table_name;

-- Check if any tables exist at all
SELECT 
    COUNT(*) as total_tables
FROM 
    information_schema.tables 
WHERE 
    table_schema = 'public';

-- Check for RLS policies
SELECT 
    tablename, 
    polname, 
    polcmd
FROM 
    pg_policy pol
    JOIN pg_class pc ON pc.oid = pol.polrelid
WHERE 
    pc.relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY 
    tablename, polname;