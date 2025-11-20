-- Check if the specific user exists in auth.users
SELECT id, email, created_at 
FROM auth.users 
WHERE id = 'd9bbbe5f-d564-4492-a90d-470836052c88';

-- Check all users in auth.users
SELECT id, email, created_at 
FROM auth.users;

-- Check if the user exists in the users table
SELECT * 
FROM users 
WHERE id = 'd9bbbe5f-d564-4492-a90d-470836052c88';

-- Check all users in the users table
SELECT * 
FROM users;