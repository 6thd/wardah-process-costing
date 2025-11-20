# GL Accounts RLS Fix

This document explains the RLS (Row Level Security) fix for the `gl_accounts` tables.

## Issue

The Supabase security linting revealed that RLS was disabled on the `gl_accounts` and `gl_accounts_backup` tables. This means that all data in these tables was accessible without any restrictions, which is a security risk.

## Solution

The `FIX_GL_ACCOUNTS_RLS_V2.sql` script addresses this by:

1. Enabling RLS on both tables (safe to run even if already enabled)
2. Dropping any existing policies to avoid conflicts
3. Creating basic policies that allow authenticated users to perform all operations (SELECT, INSERT, UPDATE, DELETE)
4. Granting necessary permissions to the authenticated role

## Implementation

Run the `FIX_GL_ACCOUNTS_RLS_V2.sql` script in your Supabase SQL editor.

## Customization

The current policies allow all authenticated users full access to the tables. You may want to customize these policies based on your specific business requirements. For example, you might want to restrict access based on user roles or organization IDs.

Example of a more restrictive policy:
```sql
-- Allow users to read only their organization's gl_accounts
CREATE POLICY "Users can read their org's gl_accounts" ON public.gl_accounts
FOR SELECT USING (
  org_id = auth.uid() OR EXISTS (
    SELECT 1 FROM organization_members 
    WHERE organization_members.org_id = gl_accounts.org_id 
    AND organization_members.user_id = auth.uid()
  )
);
```

## Verification

After running the script, you can verify that RLS is enabled by running:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('gl_accounts', 'gl_accounts_backup');
```

Both tables should show `t` (true) for `rowsecurity`.

You can also use the `CHECK_RLS_STATUS.sql` script to get detailed information about the current RLS status and policies.