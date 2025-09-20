# Fix for Recursion Issue in Chart of Accounts

## Problem

The application was experiencing "stack depth limit exceeded" errors when querying the chart of accounts hierarchy. This was caused by recursive Common Table Expressions (CTEs) that were too deep for PostgreSQL's stack limits, especially on managed Supabase instances where these limits cannot be increased.

## Solution

We've implemented a Materialized Path solution using PostgreSQL's `ltree` extension to eliminate recursive queries entirely.

## Implementation Steps

### 1. Database Schema Changes

1. Enabled the `ltree` extension in PostgreSQL
2. Added a `path` column to the `gl_accounts` table to store the materialized path
3. Created indexes on the `path` column for efficient querying
4. Implemented a trigger function to automatically maintain the path hierarchy

### 2. Application Code Changes

1. Updated the `queryGLAccounts` function to use path-based queries instead of recursive CTEs
2. Added new functions for hierarchical account queries:
   - `getAccountHierarchy`: Get all accounts in a subtree
   - `getAccountChildren`: Get direct children of an account
3. Implemented pagination using keyset pagination instead of OFFSET for better performance

### 3. Query Optimization

Replaced recursive queries like this:
```sql
WITH RECURSIVE account_tree AS (
  -- Base case
  SELECT * FROM gl_accounts WHERE id = :root_id
  UNION ALL
  -- Recursive case
  SELECT child.* 
  FROM gl_accounts child
  JOIN account_tree parent ON child.parent_id = parent.id
)
SELECT * FROM account_tree;
```

With path-based queries like this:
```sql
SELECT *
FROM gl_accounts 
WHERE path <@ (SELECT path FROM gl_accounts WHERE id = :root_id);
```

## How to Apply the Fix

1. Run the `IMPLEMENT_MATERIALIZE_PATH.sql` script in your Supabase SQL Editor
2. Restart your application
3. The chart of accounts should now display without stack depth errors

## Benefits

1. **Eliminates recursion**: No more stack depth limit exceeded errors
2. **Better performance**: Path-based queries are faster than recursive CTEs
3. **Scalable**: Works well with large account hierarchies
4. **Maintainable**: Automatic path maintenance through triggers

## Prevention

To prevent similar issues in the future:

1. Always use path-based or closure table approaches for hierarchical data
2. Implement keyset pagination instead of OFFSET for large datasets
3. Add cycle detection to prevent infinite loops
4. Regularly monitor query performance with EXPLAIN ANALYZE