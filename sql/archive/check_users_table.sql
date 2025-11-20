-- Check if users table exists and what data is in it

-- Check if users table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'users'
);

-- If users table exists, check its structure
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' 
AND table_name = 'users'
ORDER BY ordinal_position;

-- Check if there are any users in the users table
SELECT COUNT(*) as user_count FROM users;

-- Check sample users data
SELECT * FROM users LIMIT 5;

-- Check if the specific user from the error exists
SELECT * FROM users WHERE id = 'd9bbbe5f-d564-4492-a90d-470836052c88';

-- Check auth.users table
SELECT id, email, created_at FROM auth.users LIMIT 5;

-- Check if the specific user from the error exists in auth.users
SELECT * FROM auth.users WHERE id = 'd9bbbe5f-d564-4492-a90d-470836052c88';