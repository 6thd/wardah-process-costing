# Diagnostic Scripts for GL Accounts

This document explains the diagnostic scripts created to monitor and verify the gl_accounts hierarchy.

## Scripts Overview

### 1. DIAGNOSE_ACCOUNT_HIERARCHY.sql
This script helps diagnose issues with the account hierarchy:
- Counts total accounts and root accounts
- Identifies accounts with invalid parent codes
- Detects potential cycles (accounts that are their own parent)
- Shows the account hierarchy structure
- Checks for empty string parent codes
- Checks for path columns that may exist from previous implementations

### 2. CHECK_GL_ACCOUNTS_SCHEMA.sql
This script examines the current schema of the gl_accounts table:
- Lists all columns with their data types and nullability
- Checks if the ltree extension is available
- Shows indexes on the gl_accounts table
- Displays sample data to understand the current structure

## Usage Instructions

1. Run `CHECK_GL_ACCOUNTS_SCHEMA.sql` first to understand the current table structure
2. Run `DIAGNOSE_ACCOUNT_HIERARCHY.sql` to identify any issues with the account hierarchy
3. Review the results to determine if further action is needed

## Expected Results

After running these scripts, you should be able to:
- Confirm the total number of accounts in the system
- Identify any accounts with invalid parent references
- Detect any circular references in the hierarchy
- Understand the current table structure and indexes
- Determine if any data cleanup is needed

## Next Steps

Based on the diagnostic results, you may need to:
1. Clean up accounts with invalid parent codes
2. Fix accounts with empty string parent codes (should be NULL)
3. Address any circular references found
4. Optimize indexes if needed
5. Backfill missing data if the account count is still lower than expected