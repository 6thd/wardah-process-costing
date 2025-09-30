# Database Configuration Steps to Fix Stack Depth Limit Issue

## Step-by-Step Guide

### Step 1: Access Supabase Dashboard
1. Go to https://rytzljjlthouptdqeuxh.supabase.co
2. Sign in with your credentials

### Step 2: Navigate to Database Settings
1. In the left sidebar, click on the "Settings" icon (gear icon)
2. Click on "Database" under the Settings section

### Step 3: Locate and Modify max_stack_depth
1. Scroll down to the "Configuration" section
2. Look for "max_stack_depth" in the list of parameters
3. Click on the value to edit it
4. Change it from "2048kB" to "4096kB" (or higher if needed)
5. Click "Save" to save the change

### Step 4: Restart the Database
1. After saving the configuration, look for a "Restart" or "Apply Changes" button
2. Click the restart button
3. Confirm when prompted
4. Wait for the restart to complete (this can take 2-5 minutes)

### Step 5: Verify the Change
1. After the restart is complete, run the verification script:
   ```
   node check_db_simple.cjs
   ```
2. You should see a message indicating the database query was successful

## Alternative Solution: Check if Changes Were Applied

If you've already done the above steps and it's still not working, let's verify the current setting:

### Run this SQL query in your Supabase SQL Editor:
```sql
SHOW max_stack_depth;
```

This should show the current value. If it still shows "2048kB", then the change wasn't applied correctly.

## If the Issue Persists

If you've verified that the max_stack_depth is properly set to 4096kB and the database has been restarted, but you're still seeing the error, try these additional steps:

1. Wait a few more minutes - sometimes restarts take longer than expected
2. Check if there are any maintenance windows or issues with your Supabase project
3. Contact Supabase support if the issue continues

## Temporary Workaround

While we're fixing the database configuration, the application will continue to show sample data. This ensures you can at least test the UI and functionality while the database issue is being resolved.