-- Diagnose users table issues
-- Check if users table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'users'
);

-- Check if auth.users table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'auth' 
   AND table_name = 'users'
);

-- List all tables in public schema
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
ORDER BY table_name;

-- Check structure of auth.users table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth' 
AND table_name = 'users'
ORDER BY ordinal_position;

-- Check if there are any users
SELECT id, email FROM auth.users LIMIT 5;

-- Check structure of gl_accounts table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- Check if there are any gl_accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- Check tenant_id distribution in gl_accounts
SELECT tenant_id, COUNT(*) as account_count 
FROM gl_accounts 
GROUP BY tenant_id;