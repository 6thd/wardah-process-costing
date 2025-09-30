-- Script to verify Materialized Path implementation with ltree

-- 1. Check if ltree extension is enabled
SELECT * FROM pg_extension WHERE extname = 'ltree';

-- 2. Check the structure of gl_accounts table (replacing \d gl_accounts with standard SQL)
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default,
    character_maximum_length
FROM information_schema.columns 
WHERE table_name = 'gl_accounts'
ORDER BY ordinal_position;

-- 3. Verify that paths are populated
SELECT id, code, name, path, parent_code 
FROM gl_accounts 
WHERE path IS NOT NULL 
ORDER BY path 
LIMIT 20;

-- 4. Check for any accounts without paths
SELECT id, code, name, path, parent_code 
FROM gl_accounts 
WHERE path IS NULL 
ORDER BY code;

-- 5. Test ltree queries - find root accounts (those with single-level paths)
SELECT id, code, name, path 
FROM gl_accounts 
WHERE path ~ '^[^.]+$'  -- Single level paths (no dots)
ORDER BY code;

-- 6. Test ltree queries - find children of a specific account
-- Replace '100000' with an actual root account code from your data
SELECT id, code, name, path 
FROM gl_accounts 
WHERE path ~ '100000.*{1}'  -- Direct children of account 100000
ORDER BY code;

-- 7. Test ltree queries - find all descendants of a specific account
-- Replace '100000' with an actual root account code from your data
SELECT id, code, name, path 
FROM gl_accounts 
WHERE path <@ '100000'  -- All descendants of account 100000
ORDER BY path;

-- 8. Check the count of accounts with and without paths
SELECT 
  COUNT(*) as total_accounts,
  COUNT(CASE WHEN path IS NOT NULL THEN 1 END) as accounts_with_path,
  COUNT(CASE WHEN path IS NULL THEN 1 END) as accounts_without_path
FROM gl_accounts;

-- 9. Check for any malformed paths
SELECT id, code, name, path 
FROM gl_accounts 
WHERE path IS NOT NULL 
  AND (path = '' OR path ~ '[^0-9.]')  -- Paths should only contain digits and dots
ORDER BY code;