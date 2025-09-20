# Essential RLS Fix

This document explains the minimal RLS (Row Level Security) fix for the `gl_accounts` tables.

## Issue

The Supabase security linting revealed that RLS was disabled on the `gl_accounts` and `gl_accounts_backup` tables, which means all data in these tables is accessible without restrictions.

## Solution

The `ESSENTIAL_RLS_FIX.sql` script provides a minimal fix by:

1. Enabling RLS on both tables
2. Dropping any existing policies to avoid conflicts
3. Creating simple policies that allow all operations for authenticated users
4. Granting necessary permissions to the authenticated role

## Implementation

Run the `ESSENTIAL_RLS_FIX.sql` script in your Supabase SQL editor.

## Verification

After running the script, you can verify that RLS is enabled by running:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('gl_accounts', 'gl_accounts_backup');
```

Both tables should show `t` (true) for `rowsecurity`.

You can also check that policies have been created:
```sql
SELECT polname as policy_name, relname as table_name
FROM pg_policy p
JOIN pg_class c ON p.polrelid = c.oid
WHERE c.relname IN ('gl_accounts', 'gl_accounts_backup');
```

This should show 4 policies for each table (SELECT, INSERT, UPDATE, DELETE).

## Customization

The current policies allow all authenticated users full access to the tables. For production use, you should customize these policies based on your specific business requirements, such as restricting access by organization or user role.