# RLS Policies Audit Documentation

## Overview

This document provides a comprehensive audit of Row Level Security (RLS) policies implemented in the Wardah ERP system. RLS is critical for ensuring multi-tenant data isolation and preventing unauthorized access.

## Audit Date

**Last Audit:** [To be filled after running audit script]

## Audit Process

### 1. Automated Audit Script

Run the security audit script to generate a comprehensive report:

```sql
-- Run this in Supabase SQL Editor
\i sql/migrations/58_security_audit_report.sql
```

### 2. Manual Policy Testing

Run the RLS test script:

```sql
\i scripts/security/test_rls_policies.sql
```

### 3. Cross-Tenant Access Testing

Run the automated tests:

```bash
npm run test:security
```

## Critical Tables Requiring RLS

### Core Tables

| Table | RLS Status | Policies Count | Tenant Isolation |
|-------|------------|----------------|------------------|
| `organizations` | ✅ Enabled | Multiple | ✅ Yes |
| `user_organizations` | ✅ Enabled | Multiple | ✅ Yes |
| `user_profiles` | ✅ Enabled | Multiple | ✅ Yes |
| `super_admins` | ✅ Enabled | Multiple | ✅ Yes |

### Manufacturing Tables

| Table | RLS Status | Policies Count | Tenant Isolation |
|-------|------------|----------------|------------------|
| `manufacturing_orders` | ✅ Enabled | Multiple | ✅ Yes |
| `manufacturing_stages` | ✅ Enabled | Multiple | ✅ Yes |
| `work_centers` | ✅ Enabled | Multiple | ✅ Yes |
| `labor_entries` | ✅ Enabled | Multiple | ✅ Yes |
| `overhead_rates` | ✅ Enabled | Multiple | ✅ Yes |

### Inventory Tables

| Table | RLS Status | Policies Count | Tenant Isolation |
|-------|------------|----------------|------------------|
| `inventory_items` | ⚠️ Check | - | ⚠️ Verify |
| `stock_moves` | ⚠️ Check | - | ⚠️ Verify |
| `stock_quants` | ✅ Enabled | Multiple | ✅ Yes |

### Accounting Tables

| Table | RLS Status | Policies Count | Tenant Isolation |
|-------|------------|----------------|------------------|
| `gl_accounts` | ✅ Enabled | Multiple | ✅ Yes |
| `journal_entries` | ✅ Enabled | Multiple | ✅ Yes |
| `journal_entry_lines` | ✅ Enabled | Multiple | ✅ Yes |

### Sales & Purchase Tables

| Table | RLS Status | Policies Count | Tenant Isolation |
|-------|------------|----------------|------------------|
| `sales_orders` | ✅ Enabled | Multiple | ✅ Yes |
| `purchase_orders` | ✅ Enabled | Multiple | ✅ Yes |
| `customers` | ✅ Enabled | Multiple | ✅ Yes |
| `suppliers` | ✅ Enabled | Multiple | ✅ Yes |

## Policy Patterns

### Standard Tenant Isolation Pattern

Most tables use one of these patterns:

#### Pattern 1: Using `org_id`

```sql
CREATE POLICY "table_name_tenant_isolation" ON table_name
    FOR ALL USING (
        org_id = auth_org_id()
        OR org_id IN (
            SELECT org_id FROM user_organizations 
            WHERE user_id = auth.uid() AND is_active = true
        )
    );
```

#### Pattern 2: Using `tenant_id`

```sql
CREATE POLICY "table_name_tenant_isolation" ON table_name
    FOR ALL USING (
        tenant_id = auth_org_id()
    );
```

#### Pattern 3: Super Admin Override

```sql
CREATE POLICY "table_name_super_admin" ON table_name
    FOR ALL USING (
        is_super_admin()
    );
```

## Common Issues Found

### Issue 1: Missing RLS on New Tables

**Problem:** New tables created without RLS enabled.

**Solution:** Always enable RLS immediately after table creation:

```sql
ALTER TABLE new_table ENABLE ROW LEVEL SECURITY;
```

### Issue 2: Inconsistent Tenant Column Names

**Problem:** Some tables use `org_id`, others use `tenant_id`.

**Solution:** Standardize on `org_id` (see Phase 1 migration).

### Issue 3: Missing Policies for Specific Operations

**Problem:** RLS enabled but no policies for INSERT/UPDATE/DELETE.

**Solution:** Ensure policies exist for all operations:

```sql
-- SELECT policy
CREATE POLICY "table_select" ON table_name FOR SELECT USING (...);

-- INSERT policy
CREATE POLICY "table_insert" ON table_name FOR INSERT WITH CHECK (...);

-- UPDATE policy
CREATE POLICY "table_update" ON table_name FOR UPDATE USING (...);

-- DELETE policy
CREATE POLICY "table_delete" ON table_name FOR DELETE USING (...);
```

## Testing Checklist

- [ ] All critical tables have RLS enabled
- [ ] All tables have at least SELECT policy
- [ ] All tables have tenant isolation policies
- [ ] Cross-tenant access tests pass
- [ ] Super admin can access all data
- [ ] Regular users can only access their org data
- [ ] Policies work correctly with joins
- [ ] Policies work correctly with aggregations

## Remediation Steps

### Step 1: Run Audit Script

```sql
\i sql/migrations/58_security_audit_report.sql
```

### Step 2: Review Report

Check the `security_audit_reports` table for issues.

### Step 3: Fix Issues

Create migration to fix any issues found:

```sql
-- Example: Enable RLS on missing table
ALTER TABLE missing_table ENABLE ROW LEVEL SECURITY;

-- Example: Add missing policy
CREATE POLICY "missing_table_tenant_isolation" ON missing_table
    FOR ALL USING (org_id = auth_org_id());
```

### Step 4: Re-run Tests

```bash
npm run test:security
```

## Maintenance Schedule

- **Weekly:** Automated audit script
- **Monthly:** Full policy review
- **After each migration:** Verify RLS still works
- **Before production release:** Complete security audit

## References

- [Supabase RLS Documentation](https://supabase.com/docs/guides/auth/row-level-security)
- [PostgreSQL RLS Documentation](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- Internal: `sql/migrations/41_multi_tenant_rls_policies.sql`

## Notes

- Always test RLS policies in staging before production
- Document any exceptions to standard patterns
- Keep this document updated after each audit

