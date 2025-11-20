-- Test script to check if gl_accounts data exists without RLS
-- First, disable RLS temporarily
ALTER TABLE gl_accounts DISABLE ROW LEVEL SECURITY;

-- Query the data
SELECT COUNT(*) as total_accounts FROM gl_accounts;
SELECT * FROM gl_accounts LIMIT 5;

-- Re-enable RLS
ALTER TABLE gl_accounts ENABLE ROW LEVEL SECURITY;