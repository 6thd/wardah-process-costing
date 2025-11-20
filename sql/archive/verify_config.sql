-- Verify current max_stack_depth setting
SHOW max_stack_depth;

-- Check if the setting is applied at the database level
SELECT 
    name, 
    setting, 
    unit, 
    short_desc 
FROM 
    pg_settings 
WHERE 
    name = 'max_stack_depth';

-- Check current database connections
SELECT 
    datname, 
    usename, 
    application_name, 
    client_addr, 
    state 
FROM 
    pg_stat_activity 
WHERE 
    datname = current_database();

-- Simple test query to check if the stack depth issue is resolved
SELECT COUNT(*) as account_count FROM gl_accounts;

-- Show first 5 accounts if the above query works
SELECT 
    code, 
    name, 
    category 
FROM 
    gl_accounts 
ORDER BY 
    code 
LIMIT 5;