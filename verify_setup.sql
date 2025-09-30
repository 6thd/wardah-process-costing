-- Verification script to check if the gl_accounts setup was successful

-- 1. Check if ltree extension is enabled
SELECT EXISTS (
   SELECT FROM pg_extension 
   WHERE extname = 'ltree'
) AS ltree_enabled;

-- 2. Check if gl_accounts table exists
SELECT EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_name = 'gl_accounts'
) AS table_exists;

-- 3. Check all columns in gl_accounts table
SELECT column_name, data_type, is_nullable
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- 4. Check if required indexes exist
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'gl_accounts';

-- 5. Check if trigger exists
SELECT tgname, proname
FROM pg_trigger t
JOIN pg_proc p ON t.tgfoid = p.oid
WHERE tgrelid = 'gl_accounts'::regclass;

-- 6. Check if there are rows in the table
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- 7. Check how many accounts have path values
SELECT COUNT(*) as accounts_with_path FROM gl_accounts WHERE path IS NOT NULL;

-- 8. Check sample data
SELECT id, code, name, parent_id, path FROM gl_accounts LIMIT 10;

-- 9. Test a simple path-based query (if there are accounts with paths)
SELECT child.code, child.name, child.path
FROM gl_accounts parent
JOIN gl_accounts child ON child.path <@ parent.path
WHERE parent.path IS NOT NULL
LIMIT 5;