// Verification script for Materialized Path implementation
// This script can be run in the Supabase SQL Editor to check if the path column is working correctly

console.log('=== Materialized Path Verification Script ===');

// 1. Check if ltree extension is enabled
console.log('1. Checking if ltree extension is enabled...');
/*
SELECT * FROM pg_extension WHERE extname = 'ltree';
*/

// 2. Check if path column exists
console.log('2. Checking if path column exists...');
/*
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'gl_accounts' AND column_name = 'path';
*/

// 3. Check if indexes exist
console.log('3. Checking if indexes exist...');
/*
SELECT indexname, indexdef 
FROM pg_indexes 
WHERE tablename = 'gl_accounts' AND indexname LIKE '%path%';
*/

// 4. Check sample data with paths
console.log('4. Checking sample data with paths...');
/*
SELECT id, code, name, parent_id, path 
FROM gl_accounts 
ORDER BY code 
LIMIT 10;
*/

// 5. Test path-based query (get all descendants of a root account)
console.log('5. Testing path-based query for descendants...');
/*
SELECT child.code, child.name, child.path
FROM gl_accounts parent
JOIN gl_accounts child ON child.path <@ parent.path
WHERE parent.code = '100000'  -- Replace with an actual root account code
ORDER BY child.code;
*/

// 6. Test direct children query
console.log('6. Testing direct children query...');
/*
SELECT child.code, child.name, child.path
FROM gl_accounts parent
JOIN gl_accounts child ON nlevel(child.path) = nlevel(parent.path) + 1 
  AND child.path ~ (parent.path::text || '.*')
WHERE parent.code = '100000'  -- Replace with an actual root account code
ORDER BY child.code;
*/

// 7. Check for any accounts without paths
console.log('7. Checking for accounts without paths...');
/*
SELECT COUNT(*) as accounts_without_path
FROM gl_accounts 
WHERE path IS NULL;
*/

// 8. Check path structure validity
console.log('8. Checking path structure validity...');
/*
SELECT code, name, path
FROM gl_accounts 
WHERE path IS NOT NULL 
  AND path::text !~ '^[a-zA-Z0-9_]+(\.[a-zA-Z0-9_]+)*$'
LIMIT 10;
*/

console.log('=== End of Verification Script ===');
console.log('To run these checks, copy each SQL query section into your Supabase SQL Editor and execute them individually.');