# Chart of Accounts Not Updating - Troubleshooting Guide

Since you've updated your user ID and restarted the server but still don't see the updated chart of accounts, let's go through a systematic troubleshooting process.

## Step 1: Verify Database Data

1. Run [00_detailed_data_check.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_detailed_data_check.sql) in your Supabase SQL Editor
2. Check the output to ensure:
   - gl_accounts table has ~190 records
   - Your user is properly associated with an organization

## Step 2: Verify User-Organization Association

1. Run [00_verify_user_org_setup.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_verify_user_org_setup.sql) in your Supabase SQL Editor:
   - Replace 'YOUR_USER_ID' with your actual Supabase user ID
   - Uncomment and run the INSERT statement if no record exists
   - Verify the setup worked with the final SELECT query

## Step 3: Check Browser Console for Debug Information

1. Open your browser's developer tools (F12)
2. Go to the Console tab
3. Navigate to the Chart of Accounts page
4. Look for the debug information we added:
   - `=== ChartOfAccounts Debug Info ===`
   - `=== queryGLAccounts Debug Info ===`
5. Check the data length and any error messages

## Step 4: Force Refresh Data

1. On the Chart of Accounts page, look for the "تحديث" (Refresh) button we added
2. Click it to force a reload of the data
3. Check the debug information again

## Step 5: Check Network Requests

1. In browser developer tools, go to the Network tab
2. Refresh the Chart of Accounts page
3. Look for requests to your Supabase project (should contain your project URL)
4. Check the request and response details:
   - Request URL should point to your gl_accounts table
   - Response should contain the account data
   - Look for any HTTP error codes (403, 404, etc.)

## Step 6: Test with Direct Query

1. In Supabase SQL Editor, run this query to test direct access:
   ```sql
   -- Replace 'YOUR_ORG_ID' with your actual organization ID
   SELECT COUNT(*) as account_count
   FROM gl_accounts
   WHERE org_id = '00000000-0000-0000-0000-000000000001';
   ```
2. You should see a count of ~190 accounts

## Common Issues and Solutions

### Issue: User not associated with organization
**Symptoms**: Debug shows "User has no organization assigned"
**Solution**: 
1. Run [00_verify_user_org_setup.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_verify_user_org_setup.sql) with your user ID
2. Uncomment and run the INSERT statement
3. Restart the development server

### Issue: RLS policies blocking access
**Symptoms**: Network requests show 403 errors
**Solution**:
1. Run the RLS verification query from [00_detailed_data_check.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_detailed_data_check.sql)
2. If policies are incorrect, run [00_setup_essential_rls.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_setup_essential_rls.sql)

### Issue: Wrong organization ID
**Symptoms**: Query returns 0 records
**Solution**:
1. Check your organization ID in the organizations table
2. Verify it matches what's used in the user_organizations table
3. Update the user_organizations record if needed

## Additional Debugging Steps

1. **Check config.json**:
   - Ensure [demo_mode](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/config.json#L35-L35) is set to `false`
   - Verify SUPABASE_URL and SUPABASE_ANON_KEY are correct

2. **Clear browser cache**:
   - Hard refresh (Ctrl+F5 or Cmd+Shift+R)
   - Clear site data for localhost

3. **Check for JavaScript errors**:
   - Look for any uncaught exceptions in the console
   - Check if the Supabase client is initializing correctly

If none of these steps resolve the issue, please share:
1. The debug information from the browser console
2. The output of [00_detailed_data_check.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_detailed_data_check.sql)
3. Any network request errors you see in the browser's Network tab