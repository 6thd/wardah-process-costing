# Cleanup Script for GL Accounts Hierarchy

This document explains the cleanup script for the gl_accounts hierarchy.

## Purpose

The `CLEANUP_ACCOUNT_HIERARCHY.sql` script is designed to clean up common issues in the account hierarchy that may cause problems with data retrieval or display.

## Cleanup Operations

### 1. Fix Empty Parent Codes
Converts empty string parent codes to NULL, which is the proper way to represent root accounts.

### 2. Handle Invalid Parent Codes
Identifies accounts that reference parent codes that don't exist in the table. The script shows these accounts but does not automatically fix them (requires uncommenting the UPDATE statement).

### 3. Handle Circular References
Identifies accounts that are their own parent. The script shows these accounts but does not automatically fix them (requires uncommenting the UPDATE statement).

### 4. Verification
After cleanup, the script verifies that the issues have been addressed and shows the cleaned hierarchy structure.

## Usage Instructions

1. First, run the diagnostic scripts to understand the current state of your data
2. Review the results to determine which cleanup operations are needed
3. Run `CLEANUP_ACCOUNT_HIERARCHY.sql`, uncommenting the appropriate UPDATE statements as needed
4. Verify the results by running the diagnostic scripts again

## Safety Notes

- The script is designed to be safe by showing problematic data first before making changes
- UPDATE statements that make changes are commented out by default
- Always backup your data before running cleanup scripts
- Review the results of SELECT statements before uncommenting UPDATE statements

## Expected Results

After running the cleanup script:
- Accounts with empty string parent codes will be converted to NULL
- Invalid parent code references will be identified (and optionally removed)
- Circular references will be identified (and optionally removed)
- The account hierarchy will be in a consistent state