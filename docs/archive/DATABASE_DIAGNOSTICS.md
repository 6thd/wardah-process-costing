# Database Diagnostics for Wardah ERP System

This document provides instructions for diagnosing and fixing common database issues in the Wardah ERP system.

## Prerequisites

1. Access to the Supabase project dashboard
2. SQL Editor access in Supabase

## Diagnostic Scripts

### 1. Simple Tenant Check

File: `simple_tenant_check.sql`

This script checks the basic tenant configuration:

- Current tenant setting
- Users in the system
- Organizations
- User-organization associations
- Tenant ID distribution in gl_accounts

**How to run:**
1. Copy the contents of `simple_tenant_check.sql`
2. Paste into the Supabase SQL Editor
3. Run the query

### 2. Comprehensive Tenant Diagnostic

File: `comprehensive_tenant_diagnostic.sql`

This script provides a more detailed analysis of the tenant configuration:

- All information from simple tenant check
- RLS policies
- JWT claims
- Detailed organization and user information

**How to run:**
1. Copy the contents of `comprehensive_tenant_diagnostic.sql`
2. Paste into the Supabase SQL Editor
3. Run the query

### 3. Fix User-Organization Association

File: `fix_user_org_association.sql`

This script helps fix user-organization associations:

- Creates a default organization if none exists
- Associates users with organizations
- Updates gl_accounts with correct tenant IDs

**How to run:**
1. Copy the contents of `fix_user_org_association.sql`
2. Replace `USER_ID_HERE` with the actual user ID from your system
3. Paste into the Supabase SQL Editor
4. Run the query

### 4. Verify Materialized Path Implementation

File: `verify_materialized_path.sql`

This script verifies that the Materialized Path implementation with ltree is working correctly:

- Checks if ltree extension is enabled
- Verifies path population
- Tests ltree queries
- Checks for malformed paths

**How to run:**
1. Copy the contents of `verify_materialized_path.sql`
2. Paste into the Supabase SQL Editor
3. Run the query

### 5. Check RLS Policies

File: `check_rls_policies.sql`

This script checks Row Level Security policies on the gl_accounts table:

- RLS status
- Policy details
- Query results with and without filtering

**How to run:**
1. Copy the contents of `check_rls_policies.sql`
2. Paste into the Supabase SQL Editor
3. Run the query

## Common Issues and Solutions

### 1. "user_metadata" column does not exist

**Error:**
```
ERROR: 42703: column "user_metadata" does not exist
```

**Solution:**
In Supabase, the correct column name is `raw_user_meta_data`, not `user_metadata`. The diagnostic scripts have been updated to use the correct column name.

### 2. No accounts displayed in the Chart of Accounts

**Possible causes:**
1. Incorrect tenant ID filtering
2. User not associated with an organization
3. RLS policies preventing access
4. Empty or incorrectly populated gl_accounts table

**Solutions:**
1. Run `simple_tenant_check.sql` to verify tenant configuration
2. Run `fix_user_org_association.sql` to ensure proper user-organization association
3. Check RLS policies with `check_rls_policies.sql`
4. Verify Materialized Path implementation with `verify_materialized_path.sql`

### 3. Stack depth limit exceeded

**Error:**
```
stack depth limit exceeded
```

**Solution:**
The application has been updated to use Materialized Path with ltree to avoid recursive queries. Ensure you've run the `IMPLEMENT_MATERIALIZE_PATH.sql` script in your Supabase SQL Editor.

## Troubleshooting Steps

1. **Run the simple tenant check** to get an overview of your configuration
2. **Check user-organization associations** to ensure users are properly linked to organizations
3. **Verify RLS policies** to ensure they're not blocking access
4. **Check Materialized Path implementation** to ensure paths are correctly populated
5. **Fix any issues** using the provided scripts
6. **Restart the application** to ensure changes take effect

## Additional Notes

- Always backup your database before running modification scripts
- Replace placeholder values (like `USER_ID_HERE`) with actual values from your system
- If you continue to experience issues, check the application logs for more detailed error information
- Ensure you're using the correct Supabase project URL and API key in your configuration