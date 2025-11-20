-- Check current max_stack_depth setting
SHOW max_stack_depth;

-- Check other relevant settings
SHOW shared_buffers;
SHOW work_mem;
SHOW maintenance_work_mem;

-- Check if there are any active connections
SELECT 
    pid, 
    usename, 
    application_name, 
    client_addr, 
    state, 
    query 
FROM 
    pg_stat_activity 
WHERE 
    state = 'active';

-- Check database size
SELECT 
    pg_size_pretty(pg_database_size(current_database())) as database_size;