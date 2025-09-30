# Troubleshooting Chart of Accounts Not Displaying

If you're not seeing the chart of accounts in the application after running all the SQL scripts, follow these steps to identify and resolve the issue:

## Step 1: Verify Data Import

1. Run [00_verify_data_import.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_verify_data_import.sql) in your Supabase SQL Editor
2. Check the output to ensure:
   - gl_accounts table has data (should show ~190 records)
   - gl_mappings table has data (should show ~72 records)
   - organizations table has at least one record

## Step 2: Check User Authentication and Organization

1. Make sure you're logged in to the application with a valid user
2. Get your Supabase user ID from the Supabase dashboard:
   - Go to Authentication > Users
   - Find your user and copy the User ID
3. Run [00_setup_user_organization.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_setup_user_organization.sql) in your Supabase SQL Editor:
   - Replace 'YOUR_USER_ID' with your actual Supabase user ID
   - Uncomment and run the INSERT statement to associate your user with an organization

## Step 3: Test Direct Database Access

1. Run [00_test_gl_accounts_access.sql](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/sql/wardah_implementation/00_test_gl_accounts_access.sql) in your Supabase SQL Editor
2. Check if you can access the gl_accounts table directly
3. If you get permission errors, it's likely an RLS issue

## Step 4: Check RLS Policies

1. Run the verification script to check if RLS is enabled and what policies exist
2. If RLS is enabled but you're not seeing data, it's because your user isn't associated with an organization
3. Make sure you've run Step 2 to associate your user with an organization

## Step 5: Restart the Development Server

1. Stop the development server (Ctrl+C)
2. Run `npm run dev` again
3. Log in to the application and navigate to the Chart of Accounts

## Step 6: Check Browser Console

1. Open your browser's developer tools (F12)
2. Go to the Console tab
3. Look for any error messages when loading the Chart of Accounts page
4. Look for network errors that might indicate authentication issues

## Step 7: Clear Browser Cache

1. Clear your browser cache and cookies for localhost
2. Restart the development server
3. Try again

## Common Issues and Solutions

### Issue: "Table 'gl_accounts' not found"
Solution: Make sure you've run all the SQL scripts in the correct order, especially the schema creation scripts.

### Issue: Empty chart of accounts with no errors
Solution: This usually means RLS is filtering out all records because your user isn't associated with an organization. Make sure you've completed Step 2.

### Issue: Authentication errors
Solution: Make sure you're logged in with a valid user and that the Supabase credentials in config.json are correct.

### Issue: Network errors in browser console
Solution: Check that the SUPABASE_URL and SUPABASE_ANON_KEY in config.json match your Supabase project settings.

## Additional Debugging

If none of the above steps work:

1. Add console.log statements in the [queryGLAccounts](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/src/lib/supabase.ts#L281-L325) function in [src/lib/supabase.ts](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/src/lib/supabase.ts) to see what's happening:
   ```typescript
   console.log('Querying GL accounts with session:', session);
   console.log('User organizations:', userOrgs);
   ```

2. Check the browser's Network tab to see the actual API requests being made to Supabase and their responses.

3. Verify that the [demo_mode](file:///c:/Users/dell/Desktop/%D9%85%D8%AC%D8%A7%D9%87%D8%AF/%D8%A7%D9%86%D8%AA%D8%A7%D8%AC/wardah-factory/wardah-process-costing/config.json#L35-L35) setting in config.json is set to false for production use.