# Fix for Chart of Accounts Recursion Issue

## Problem

The Wardah ERP system was experiencing "stack depth limit exceeded" errors when querying the chart of accounts hierarchy. This was caused by recursive Common Table Expressions (CTEs) that were too deep for PostgreSQL's stack limits, especially on managed Supabase instances where these limits cannot be increased.

## Solution

We've implemented a Materialized Path solution using PostgreSQL's `ltree` extension to eliminate recursive queries entirely.

## Files Created/Modified

1. `IMPLEMENT_MATERIALIZE_PATH.sql` - SQL script to implement Materialized Path in the database
2. `src/lib/supabase.ts` - Updated Supabase client with path-based queries
3. `src/features/general-ledger/index.tsx` - Updated Chart of Accounts component
4. `src/TestGLAccounts.tsx` - Updated test component
5. `FIX_RECURSION_ISSUE.md` - Documentation on the fix
6. `IMPLEMENTATION_SUMMARY.md` - Summary of all changes
7. `verify_materialized_path.js` - Verification script

## How to Apply the Fix

### Step 1: Run Database Migration

1. Open your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the contents of `IMPLEMENT_MATERIALIZE_PATH.sql`
4. Run the script

This will:
- Enable the `ltree` extension
- Add the `path` column to the `gl_accounts` table
- Create necessary indexes
- Implement a trigger to maintain paths automatically
- Backfill existing accounts with path values

### Step 2: Restart Your Application

1. Restart your development server:
   ```bash
   npm run dev
   ```

2. Or rebuild and redeploy your application if in production

### Step 3: Verify the Fix

1. Navigate to the Chart of Accounts page in your application
2. The tree should now display without stack depth errors
3. Use the TestGLAccounts component to verify data is loading correctly

## Verification Steps

### Database Verification

Run these queries in your Supabase SQL Editor:

1. Check if ltree extension is enabled:
   ```sql
   SELECT * FROM pg_extension WHERE extname = 'ltree';
   ```

2. Check if path column exists:
   ```sql
   SELECT column_name, data_type 
   FROM information_schema.columns 
   WHERE table_name = 'gl_accounts' AND column_name = 'path';
   ```

3. Check sample data with paths:
   ```sql
   SELECT id, code, name, parent_id, path 
   FROM gl_accounts 
   ORDER BY code 
   LIMIT 10;
   ```

### Application Verification

1. Open the Chart of Accounts page
2. Verify that accounts are displayed in a hierarchical tree structure
3. Check that parent-child relationships are correctly represented
4. Test expanding and collapsing account nodes

## Benefits of This Solution

1. **Eliminates Recursion**: No more stack depth limit exceeded errors
2. **Better Performance**: Path-based queries are faster than recursive CTEs
3. **Scalable**: Works well with large account hierarchies
4. **Maintainable**: Automatic path maintenance through triggers
5. **Robust**: Built-in cycle detection prevents infinite loops

## Troubleshooting

### If Accounts Still Don't Appear

1. Check that the database migration ran successfully
2. Verify that accounts have been populated in the `gl_accounts` table
3. Check that the `path` column is populated for all accounts
4. Ensure your user has the correct tenant ID and permissions

### If Performance is Still Poor

1. Verify that the indexes on the `path` column were created
2. Check that you're using path-based queries instead of recursive CTEs
3. Consider implementing keyset pagination for very large datasets

### If You See Errors in the Console

1. Check that all TypeScript interfaces are correctly updated
2. Verify that the `path` property is included in queries
3. Ensure that the trigger function is working correctly

## Future Improvements

1. Implement true keyset pagination for even better performance
2. Add more comprehensive cycle detection and prevention
3. Optimize path-based queries with additional indexes
4. Implement closure table as an alternative for very deep hierarchies

## Support

If you continue to experience issues after applying this fix, please:

1. Check the console logs for specific error messages
2. Verify that all steps in this guide have been completed
3. Contact the development team for further assistance