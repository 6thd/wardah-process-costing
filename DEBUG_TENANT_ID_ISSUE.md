# Debugging Tenant ID Issue with GL Accounts

## Problem

The database has been properly set up with 190 accounts and all paths populated, but the application is still showing only 7 records. This suggests that the application is not correctly querying the database, likely due to a tenant ID filtering issue.

## Diagnosis Steps

### Step 1: Check Tenant Configuration

1. Run the `check_tenant_config.sql` script to check the current tenant configuration
2. Look at the output to see:
   - What the current tenant ID is
   - How many accounts exist for each tenant ID
   - If there are any RLS policies affecting the query

### Step 2: Check Account Tenant IDs

1. Run the following query to see what tenant IDs are used in your accounts:
   ```sql
   SELECT DISTINCT tenant_id FROM gl_accounts;
   ```

2. If you see `NULL` values or unexpected tenant IDs, this is likely the issue.

### Step 3: Update Tenant IDs (If Needed)

1. If accounts have `NULL` tenant IDs, run the `update_tenant_id.sql` script to update them
2. Make sure to use the correct tenant ID for your organization

### Step 4: Check User-Tenant Association

1. Verify that your user account is associated with the correct organization
2. Check the `user_organizations` table to see the association

## Files Created

1. `test_account_retrieval.sql` - Test script to verify account retrieval directly from database
2. `check_tenant_config.sql` - Script to check tenant ID configuration
3. `update_tenant_id.sql` - Script to update tenant IDs for accounts

## Common Issues and Solutions

### Issue 1: Accounts Have NULL Tenant IDs

**Symptoms**: Query returns few or no accounts, but database has 190 records

**Solution**: 
1. Run `check_tenant_config.sql` to confirm the issue
2. Run `update_tenant_id.sql` to set a proper tenant ID for all accounts

### Issue 2: User Not Associated with Correct Organization

**Symptoms**: Authentication works but no data is returned

**Solution**:
1. Check the `user_organizations` table
2. Ensure your user ID is associated with the organization that owns the accounts

### Issue 3: RLS Policies Blocking Access

**Symptoms**: Direct database queries work but application queries don't

**Solution**:
1. Check RLS policies on the `gl_accounts` table
2. Verify that the policies allow access for your tenant ID

## How to Apply the Fix

### Step 1: Run Diagnostic Scripts

1. Execute `check_tenant_config.sql` in your Supabase SQL Editor
2. Note the results, particularly:
   - Current tenant ID setting
   - Tenant IDs in the `gl_accounts` table
   - RLS policy information

### Step 2: Fix Tenant ID Issues

1. If accounts have `NULL` tenant IDs:
   - Modify `update_tenant_id.sql` to use the correct tenant ID
   - Run the script to update all accounts

### Step 3: Verify User Association

1. Check that your user account is associated with the correct organization
2. If not, update the `user_organizations` table accordingly

### Step 4: Test the Application

1. Restart your development server:
   ```bash
   npm run dev
   ```

2. Navigate to the Chart of Accounts page
3. You should now see all 190 accounts

## Data Verification Process

As per the project requirements, the data verification process should include:

1. Checking that `gl_accounts` has approximately 190 records
2. Verifying that the user is associated with an organization
3. Ensuring that the organization ID matches across tables

You can verify these by running:

```sql
-- Check number of accounts
SELECT COUNT(*) as total_accounts FROM gl_accounts;

-- Check tenant_id consistency
SELECT DISTINCT tenant_id FROM gl_accounts;

-- Check if user organization matches
SELECT current_setting('app.current_tenant_id')::UUID;
```

## Support

If you continue to experience issues after applying this fix, please:

1. Share the output of the diagnostic scripts
2. Check the console logs for specific error messages
3. Contact the development team for further assistance