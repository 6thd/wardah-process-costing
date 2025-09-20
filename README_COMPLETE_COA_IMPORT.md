# Complete Chart of Accounts Import

This directory contains all the necessary tools and instructions to import the complete WARDAH ERP Chart of Accounts (all 190 accounts) from the `wardah_enhanced_coa.csv` file and display them in a hierarchical tree structure.

## Files Included

1. **IMPORT_COMPLETE_CHART_OF_ACCOUNTS.sql** - A complete SQL script that includes all steps for importing and displaying the chart of accounts
2. **ALTERNATIVE_COA_IMPORT.sql** - An alternative approach that handles RLS issues differently
3. **ROBUST_COA_IMPORT.sql** - A robust approach that handles constraint issues gracefully
4. **CHECK_GL_ACCOUNTS_CONSTRAINTS.sql** - Script to check existing constraints on gl_accounts table
5. **FIX_GL_ACCOUNTS_CONSTRAINTS.sql** - Script to add necessary constraints for proper upsert operations
6. **DISPLAY_WARDAH_COA_TREE.sql** - A SQL script to display all accounts in hierarchical tree structure (updated to filter by org_id)
7. **EXECUTE_CHART_OF_ACCOUNTS_IMPORT.md** - Step-by-step instructions for executing the import process
8. **run-coa-import.bat** - A Windows batch script that provides instructions for the import process
9. **README_COMPLETE_COA_IMPORT.md** - This documentation file

## Import Process Overview

The import process involves the following steps:

1. Setting up a session to bypass Row Level Security (RLS)
2. Creating a temporary staging table
3. Importing the CSV data through the Supabase SQL Editor interface
4. Inserting data into the `gl_accounts` table
5. Verifying the import
6. Adding a temporary anonymous read policy for demo purposes
7. Displaying the complete chart of accounts in hierarchical structure

## Detailed Instructions

### Prerequisites

1. Ensure you have access to the Supabase SQL Editor
2. Verify that the `wardah_enhanced_coa.csv` file exists in the `wardah_erp_handover` directory
3. Confirm that the `gl_accounts` table exists in your database

### Step-by-Step Execution

Follow the detailed instructions in `EXECUTE_CHART_OF_ACCOUNTS_IMPORT.md` or run `run-coa-import.bat` for a guided process.

## Expected Results

After completing the import process, you should see:

1. All 190 accounts imported into the `gl_accounts` table
2. Accounts organized in a proper hierarchical structure based on the `parent_code` relationships
3. The ability to view the complete chart of accounts tree without logging in (for demo purposes)

## Verification Queries

The import process includes several verification queries to ensure data integrity:

1. **Account Count Verification**: Confirms that exactly 190 accounts have been imported
2. **Hierarchy Validation**: Checks that parent-child relationships are correctly established
3. **Category Statistics**: Shows account counts grouped by category
4. **Level Analysis**: Displays accounts grouped by their hierarchy levels

## Troubleshooting

### If you see fewer than 190 accounts:

1. Verify that the CSV import was successful
2. Check for any error messages during the INSERT operation
3. Confirm that the `org_id` is correct

### If the hierarchy is not displaying correctly:

1. Check that `parent_code` values are correctly set
2. Verify that parent accounts exist for all child accounts
3. Ensure there are no circular references

### If you cannot view accounts without logging in:

1. Confirm that the anonymous policy was created successfully
2. Check that your Supabase project allows anonymous access
3. Verify that RLS is properly configured

## Additional Resources

- **wardah_erp_handover/wardah_enhanced_coa.csv** - The source CSV file with all 190 accounts
- **wardah_erp_handover/wardah_gl_mappings.csv** - Account mappings for transactions
- **IMPLEMENTATION_SUMMARY.md** - Details about the account structure implementation