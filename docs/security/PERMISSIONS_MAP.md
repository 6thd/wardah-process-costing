# Permissions Map - Wardah ERP

## Overview

This document maps all permissions in the system to roles and modules. It serves as a reference for understanding access control.

## Permission Format

Permissions follow this format:
```
<module>.<resource>.<action>
```

Examples:
- `manufacturing.orders.create`
- `inventory.items.view`
- `accounting.journals.edit`

## Module Permissions

### Manufacturing Module

| Permission | Description | Super Admin | Org Admin | Manager | Accountant | User |
|------------|-------------|-------------|-----------|---------|------------|------|
| `manufacturing.view` | View manufacturing data | ✅ | ✅ | ✅ | ❌ | ✅ |
| `manufacturing.orders.create` | Create manufacturing orders | ✅ | ✅ | ✅ | ❌ | ✅ |
| `manufacturing.orders.edit` | Edit manufacturing orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| `manufacturing.orders.delete` | Delete manufacturing orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| `manufacturing.orders.approve` | Approve manufacturing orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| `manufacturing.cost.view` | View cost calculations | ✅ | ✅ | ✅ | ✅ | ❌ |
| `manufacturing.cost.edit` | Edit cost calculations | ✅ | ✅ | ✅ | ❌ | ❌ |
| `manufacturing.stages.manage` | Manage manufacturing stages | ✅ | ✅ | ✅ | ❌ | ❌ |
| `manufacturing.reports.view` | View manufacturing reports | ✅ | ✅ | ✅ | ✅ | ❌ |

### Inventory Module

| Permission | Description | Super Admin | Org Admin | Manager | Accountant | User |
|------------|-------------|-------------|-----------|---------|------------|------|
| `inventory.view` | View inventory data | ✅ | ✅ | ✅ | ✅ | ✅ |
| `inventory.items.create` | Create inventory items | ✅ | ✅ | ✅ | ❌ | ❌ |
| `inventory.items.edit` | Edit inventory items | ✅ | ✅ | ✅ | ❌ | ❌ |
| `inventory.items.delete` | Delete inventory items | ✅ | ✅ | ✅ | ❌ | ❌ |
| `inventory.movements.create` | Create stock movements | ✅ | ✅ | ✅ | ❌ | ✅ |
| `inventory.movements.edit` | Edit stock movements | ✅ | ✅ | ✅ | ❌ | ❌ |
| `inventory.adjustments.create` | Create stock adjustments | ✅ | ✅ | ✅ | ❌ | ❌ |
| `inventory.adjustments.approve` | Approve stock adjustments | ✅ | ✅ | ✅ | ❌ | ❌ |
| `inventory.valuation.view` | View inventory valuation | ✅ | ✅ | ✅ | ✅ | ❌ |
| `inventory.reports.view` | View inventory reports | ✅ | ✅ | ✅ | ✅ | ❌ |

### Accounting Module

| Permission | Description | Super Admin | Org Admin | Manager | Accountant | User |
|------------|-------------|-------------|-----------|---------|------------|------|
| `accounting.view` | View accounting data | ✅ | ✅ | ✅ | ✅ | ❌ |
| `accounting.gl_accounts.create` | Create GL accounts | ✅ | ✅ | ❌ | ✅ | ❌ |
| `accounting.gl_accounts.edit` | Edit GL accounts | ✅ | ✅ | ❌ | ✅ | ❌ |
| `accounting.gl_accounts.delete` | Delete GL accounts | ✅ | ✅ | ❌ | ✅ | ❌ |
| `accounting.journals.create` | Create journal entries | ✅ | ✅ | ❌ | ✅ | ❌ |
| `accounting.journals.edit` | Edit journal entries | ✅ | ✅ | ❌ | ✅ | ❌ |
| `accounting.journals.approve` | Approve journal entries | ✅ | ✅ | ❌ | ✅ | ❌ |
| `accounting.journals.post` | Post journal entries | ✅ | ✅ | ❌ | ✅ | ❌ |
| `accounting.reports.view` | View financial reports | ✅ | ✅ | ✅ | ✅ | ❌ |
| `accounting.reports.export` | Export financial reports | ✅ | ✅ | ✅ | ✅ | ❌ |
| `accounting.trial_balance.view` | View trial balance | ✅ | ✅ | ✅ | ✅ | ❌ |
| `accounting.balance_sheet.view` | View balance sheet | ✅ | ✅ | ✅ | ✅ | ❌ |
| `accounting.income_statement.view` | View income statement | ✅ | ✅ | ✅ | ✅ | ❌ |

### Sales Module

| Permission | Description | Super Admin | Org Admin | Manager | Accountant | User |
|------------|-------------|-------------|-----------|---------|------------|------|
| `sales.view` | View sales data | ✅ | ✅ | ✅ | ✅ | ✅ |
| `sales.orders.create` | Create sales orders | ✅ | ✅ | ✅ | ❌ | ✅ |
| `sales.orders.edit` | Edit sales orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| `sales.orders.delete` | Delete sales orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| `sales.orders.approve` | Approve sales orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| `sales.invoices.create` | Create sales invoices | ✅ | ✅ | ✅ | ❌ | ❌ |
| `sales.invoices.edit` | Edit sales invoices | ✅ | ✅ | ✅ | ❌ | ❌ |
| `sales.customers.manage` | Manage customers | ✅ | ✅ | ✅ | ❌ | ❌ |
| `sales.reports.view` | View sales reports | ✅ | ✅ | ✅ | ✅ | ❌ |

### Purchasing Module

| Permission | Description | Super Admin | Org Admin | Manager | Accountant | User |
|------------|-------------|-------------|-----------|---------|------------|------|
| `purchasing.view` | View purchasing data | ✅ | ✅ | ✅ | ✅ | ✅ |
| `purchasing.orders.create` | Create purchase orders | ✅ | ✅ | ✅ | ❌ | ✅ |
| `purchasing.orders.edit` | Edit purchase orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| `purchasing.orders.approve` | Approve purchase orders | ✅ | ✅ | ✅ | ❌ | ❌ |
| `purchasing.suppliers.manage` | Manage suppliers | ✅ | ✅ | ✅ | ❌ | ❌ |
| `purchasing.reports.view` | View purchasing reports | ✅ | ✅ | ✅ | ✅ | ❌ |

### HR Module

| Permission | Description | Super Admin | Org Admin | Manager | Accountant | User |
|------------|-------------|-------------|-----------|---------|------------|------|
| `hr.view` | View HR data | ✅ | ✅ | ✅ | ❌ | ❌ |
| `hr.employees.manage` | Manage employees | ✅ | ✅ | ✅ | ❌ | ❌ |
| `hr.attendance.view` | View attendance | ✅ | ✅ | ✅ | ❌ | ❌ |
| `hr.attendance.manage` | Manage attendance | ✅ | ✅ | ✅ | ❌ | ❌ |
| `hr.payroll.view` | View payroll | ✅ | ✅ | ✅ | ❌ | ❌ |
| `hr.payroll.manage` | Manage payroll | ✅ | ✅ | ✅ | ❌ | ❌ |

### Reports Module

| Permission | Description | Super Admin | Org Admin | Manager | Accountant | User |
|------------|-------------|-------------|-----------|---------|------------|------|
| `reports.view` | View reports | ✅ | ✅ | ✅ | ✅ | ❌ |
| `reports.export` | Export reports | ✅ | ✅ | ✅ | ✅ | ❌ |
| `reports.custom.create` | Create custom reports | ✅ | ✅ | ✅ | ✅ | ❌ |
| `reports.schedule` | Schedule reports | ✅ | ✅ | ✅ | ✅ | ❌ |

### Administration Module

| Permission | Description | Super Admin | Org Admin | Manager | Accountant | User |
|------------|-------------|-------------|-----------|---------|------------|------|
| `admin.users.manage` | Manage users | ✅ | ✅ | ❌ | ❌ | ❌ |
| `admin.roles.manage` | Manage roles | ✅ | ✅ | ❌ | ❌ | ❌ |
| `admin.permissions.manage` | Manage permissions | ✅ | ✅ | ❌ | ❌ | ❌ |
| `admin.settings.view` | View settings | ✅ | ✅ | ✅ | ❌ | ❌ |
| `admin.settings.edit` | Edit settings | ✅ | ✅ | ❌ | ❌ | ❌ |
| `admin.audit.view` | View audit logs | ✅ | ✅ | ✅ | ❌ | ❌ |
| `admin.organizations.manage` | Manage organizations | ✅ | ❌ | ❌ | ❌ | ❌ |

## Permission Inheritance

### Role Hierarchy

Permissions are inherited from parent roles:

```
Super Admin
    ├── All permissions
    │
Organization Admin
    ├── All org-level permissions
    │   ├── Manager permissions
    │   │   └── User permissions
    │   └── Accountant permissions
```

### Custom Roles

Organizations can create custom roles with specific permission sets.

## Permission Checks

### Frontend Checks

```typescript
// Using usePermissions hook
const { hasPermission } = usePermissions();

if (hasPermission('manufacturing.orders.create')) {
  // Show create button
}
```

### Backend Checks

```typescript
// In API routes or services
if (!hasPermission(user, 'manufacturing.orders.create')) {
  throw new UnauthorizedError();
}
```

### Database Level

RLS policies enforce permissions at the database level:

```sql
CREATE POLICY "manufacturing_orders_select" ON manufacturing_orders
    FOR SELECT USING (
        org_id = auth_org_id()
        AND has_permission('manufacturing.view')
    );
```

## Permission Assignment

### Default Roles

Default permissions are assigned when roles are created. See:
- `sql/migrations/53_seed_permissions_data.sql`

### Custom Assignment

Permissions can be assigned/revoked via:
- Admin UI
- API endpoints
- Database directly (for super admins)

## Permission Testing

### Test Coverage

All permissions should be tested:
- Unit tests for permission checks
- Integration tests for API endpoints
- E2E tests for UI access control

### Test Scripts

```bash
# Test permission checks
npm run test:permissions

# Test cross-role access
npm run test:security
```

## Updates

This document should be updated when:
- New permissions are added
- Permission assignments change
- New roles are created
- Security policies change

## References

- Permission Service: `src/services/rbac-service.ts`
- Permission Hook: `src/hooks/usePermissions.ts`
- RLS Policies: `sql/migrations/41_multi_tenant_rls_policies.sql`

