-- Check the current state of the gl_accounts table

-- 1. Check if the table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_name = 'gl_accounts'
) AS table_exists;

-- 2. If table exists, check its columns
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- 3. Check if there are any rows in the table
SELECT COUNT(*) as row_count FROM gl_accounts;

-- 4. Check a few sample rows (if any exist)
SELECT * FROM gl_accounts LIMIT 5;

-- 5. Check if ltree extension is enabled
SELECT EXISTS (
   SELECT FROM pg_extension 
   WHERE extname = 'ltree'
) AS ltree_enabled;

-- 6. Check if path column exists
SELECT EXISTS (
   SELECT FROM information_schema.columns 
   WHERE table_name = 'gl_accounts' AND column_name = 'path'
) AS path_column_exists;