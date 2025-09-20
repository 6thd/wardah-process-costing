# Wardah ERP - SQL Import Instructions

Since your database already has some tables and policies created, follow these steps to complete the setup:

## Step 1: Check Existing Policies (Optional but Recommended)
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Open and run `00_check_existing_policies.sql`
   - This will show you what policies currently exist in your database

## Step 2: Drop Existing Policies
1. In the Supabase SQL Editor, open and run `00_drop_existing_policies.sql`
   - This will remove all existing policies that are causing conflicts

## Step 3: Apply Essential RLS Policies
1. In the Supabase SQL Editor, open and run `00_setup_essential_rls.sql`
   - This will enable RLS and set up only the essential policies needed for the chart of accounts

## Step 4: Setup Import Functions
1. In the Supabase SQL Editor, open and run `00_setup_import_functions.sql`
   - This will ensure the import functions exist and are up to date

## Step 5: Import Data
1. In the Supabase SQL Editor, open and run `import-coa-generated.sql`
   - This will import the chart of accounts data
2. In the Supabase SQL Editor, open and run `import-mappings-generated.sql`
   - This will import the GL mappings data

## Verification
After completing these steps:
1. Check that the data was imported correctly by querying the tables:
   ```sql
   SELECT COUNT(*) FROM gl_accounts;
   SELECT COUNT(*) FROM gl_mappings;
   ```
2. Test the chart of accounts tree in the application

## Troubleshooting
If you encounter any issues:
1. Make sure all scripts are run in the correct order
2. Check that your organization ID exists in the organizations table:
   ```sql
   SELECT * FROM organizations;
   ```
3. Verify that your user has the correct role in the user_organizations table:
   ```sql
   SELECT * FROM user_organizations;
   ```

## Manual Policy Removal (if needed)
If you continue to have issues with specific policies, you can manually drop them:
```sql
DROP POLICY IF EXISTS "policy_name" ON table_name;
```
Replace "policy_name" and "table_name" with the specific policy and table causing issues.