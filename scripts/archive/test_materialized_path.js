// Test script to verify Materialized Path implementation
// This script can be run in the Supabase SQL Editor to check if the path column is working correctly

/*
-- First, check if the ltree extension is enabled
SELECT * FROM pg_extension WHERE extname = 'ltree';

-- Check if the path column exists
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'gl_accounts' AND column_name = 'path';

-- Check if indexes exist
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'gl_accounts' AND indexname LIKE '%path%';

-- Check sample data with paths
SELECT id, code, name, parent_id, path 
FROM gl_accounts 
ORDER BY code 
LIMIT 10;

-- Test path-based query (get all descendants of a root account)
SELECT child.code, child.name, child.path
FROM gl_accounts parent
JOIN gl_accounts child ON child.path <@ parent.path
WHERE parent.code = '100000'  -- Replace with an actual root account code
ORDER BY child.code;

-- Test direct children query
SELECT child.code, child.name, child.path
FROM gl_accounts parent
JOIN gl_accounts child ON child.path ~ (parent.path::text || '.*{1}') 
WHERE parent.code = '100000'  -- Replace with an actual root account code
ORDER BY child.code;
*/