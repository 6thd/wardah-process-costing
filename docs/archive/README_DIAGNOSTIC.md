# Diagnostic and Fix Process for GL Accounts

This directory contains scripts to diagnose and fix issues with the GL Accounts data in your Wardah ERP system. Based on the log output you provided, it appears that the system is not returning any data (dataLength: 0) when querying the gl_accounts table.

## Files Included

1. **SAFE_DIAGNOSE_GL_ACCOUNTS.sql** - Safe diagnostic script to check the current state of gl_accounts table without using backslash commands
2. **CHECK_STAGING_DATA.sql** - Script to check if staging data exists and is properly loaded
3. **VERIFY_AND_FIX_GL_ACCOUNTS.sql** - Script to verify and fix gl_accounts data
4. **README_DIAGNOSTIC.md** - This documentation file

## Diagnostic Process

### Step 1: Run the Diagnostic Script

First, run the `SAFE_DIAGNOSE_GL_ACCOUNTS.sql` script to check the current state of your gl_accounts table:

```sql
-- In Supabase SQL Editor, run:
SELECT * FROM SAFE_DIAGNOSE_GL_ACCOUNTS();
```

This will tell you:
- If the table exists and its structure
- How many total records exist
- How many records have the default org_id
- Sample data (if any)

### Step 2: Check Staging Data

Run the `CHECK_STAGING_DATA.sql` script to verify if the CSV data has been imported into the staging table:

```sql
-- In Supabase SQL Editor, run:
SELECT * FROM CHECK_STAGING_DATA();
```

This will tell you:
- If the staging table exists
- How many records are in the staging table
- Sample data from the staging table

### Step 3: Import CSV Data (If Needed)

If the staging table doesn't exist or has no data, you need to import the CSV data:

1. Create the staging table:
   ```sql
   CREATE TEMP TABLE stg_coa (
     code text, 
     name text, 
     category text, 
     subtype text, 
     parent_code text,
     normal_balance text, 
     allow_posting boolean, 
     is_active boolean,
     currency text, 
     notes text
   );
   ```

2. Import the CSV data through Supabase SQL Editor:
   - Open SQL Editor
   - Click "Import"
   - Select file: `wardah_erp_handover/wardah_enhanced_coa.csv`
   - Target table: `stg_coa`
   - Click "Import"

### Step 4: Verify and Fix Data

Once the staging data is available, run the `VERIFY_AND_FIX_GL_ACCOUNTS.sql` script:

```sql
-- In Supabase SQL Editor, run:
SELECT * FROM VERIFY_AND_FIX_GL_ACCOUNTS();
```

This will:
- Delete any existing records for the default org_id
- Insert all records from the staging table
- Verify the import was successful
- Show sample imported records
- Add necessary policies for anonymous access (for demo)

## Expected Results

After running these scripts, you should see:

1. **gl_accounts table with data**:
   - Total records: 190 (or however many are in your CSV)
   - Records with default org_id: 190
   - Root accounts: Several (accounts with no parent)
   - Child accounts: The rest (accounts with parents)

2. **Proper hierarchy structure**:
   - Accounts organized in a tree structure based on parent_code relationships
   - Root accounts (like 100000 for Assets, 200000 for Liabilities, etc.)
   - Child accounts nested under their parents

3. **Accessible data**:
   - Data should be accessible without authentication (for demo purposes)
   - Queries should return the expected account data

## Troubleshooting

### If you still see dataLength: 0

1. **Check the org_id**: Make sure your queries are using the correct org_id (`00000000-0000-0000-0000-000000000001`)
2. **Verify RLS policies**: Make sure the anonymous read policy is in place
3. **Check for data**: Ensure the data was actually imported successfully

If you encounter syntax errors with backslash commands, use `SAFE_DIAGNOSE_GL_ACCOUNTS.sql` instead of `DIAGNOSE_GL_ACCOUNTS.sql` as it doesn't use any backslash commands.

### If there are constraint violations

1. **Check table structure**: Run the table structure query from `CHECK_GL_ACCOUNTS_CONSTRAINTS.sql` to see the table structure
2. **Check constraints**: Look for any NOT NULL or other constraints that might be violated
3. **Verify data**: Make sure all required fields are populated

### If the staging table doesn't exist

1. **Create it manually**: Run the CREATE TEMP TABLE statement
2. **Import CSV**: Use the Supabase SQL Editor import feature
3. **Verify import**: Check that records were imported successfully

## Additional Notes

- The default org_id `00000000-0000-0000-0000-000000000001` is used for demo purposes
- The anonymous read policy allows viewing data without authentication
- All scripts are designed to be safe and won't destroy existing data unless explicitly intended
- If you have production data, be careful when running these scripts