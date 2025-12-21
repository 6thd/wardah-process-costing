/**
 * Org Admin Roles & Permissions Tests
 * اختبارات إدارة الأدوار والصلاحيات
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' }
  })
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  }
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'admin@test.com' },
    isOrgAdmin: true
  })
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn()
}));

vi.mock('@/services/org-admin-service', () => ({
  getOrgRolesWithStats: vi.fn(),
  getRoleTemplates: vi.fn(),
  createRoleFromTemplate: vi.fn()
}));

// Helper Types
interface Permission {
  id: string;
  module_id: string;
  resource: string;
  resource_ar: string;
  action: string;
  action_ar: string;
  permission_key: string;
}

interface Module {
  id: string;
  code: string;
  name: string;
  name_ar: string;
  permissions: Permission[];
}

interface Role {
  id: string;
  name: string;
  name_ar: string;
  description?: string;
  is_system: boolean;
  is_active: boolean;
  permission_ids: string[];
  user_count?: number;
}

interface RoleTemplate {
  id: string;
  name: string;
  name_ar: string;
  description: string;
  permissions: string[];
}

// ===================== ROLE VALIDATION =====================

describe('Role Validation', () => {
  const validateRole = (role: Partial<Role>) => {
    const errors: string[] = [];

    if (!role.name || role.name.trim().length < 2) {
      errors.push('Role name must be at least 2 characters');
    }
    if (!role.name_ar || role.name_ar.trim().length < 2) {
      errors.push('Arabic role name must be at least 2 characters');
    }
    if (role.name && role.name.length > 50) {
      errors.push('Role name cannot exceed 50 characters');
    }
    if (!role.permission_ids || role.permission_ids.length === 0) {
      errors.push('At least one permission is required');
    }

    return { valid: errors.length === 0, errors };
  };

  it('should fail for empty role name', () => {
    const result = validateRole({ name: '', name_ar: 'اسم', permission_ids: ['p1'] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  it('should fail for short role name', () => {
    const result = validateRole({ name: 'A', name_ar: 'اسم', permission_ids: ['p1'] });
    expect(result.valid).toBe(false);
  });

  it('should fail for missing Arabic name', () => {
    const result = validateRole({ name: 'Admin', name_ar: '', permission_ids: ['p1'] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Arabic'))).toBe(true);
  });

  it('should fail for no permissions', () => {
    const result = validateRole({ name: 'Admin', name_ar: 'مدير', permission_ids: [] });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('permission'))).toBe(true);
  });

  it('should pass for valid role', () => {
    const result = validateRole({ 
      name: 'Accountant', 
      name_ar: 'محاسب', 
      permission_ids: ['p1', 'p2'] 
    });
    expect(result.valid).toBe(true);
  });
});

// ===================== PERMISSION GROUPING =====================

describe('Permission Grouping', () => {
  const permissions: Permission[] = [
    { id: 'p1', module_id: 'm1', resource: 'sales_orders', resource_ar: 'أوامر البيع', action: 'create', action_ar: 'إنشاء', permission_key: 'sales.orders.create' },
    { id: 'p2', module_id: 'm1', resource: 'sales_orders', resource_ar: 'أوامر البيع', action: 'read', action_ar: 'عرض', permission_key: 'sales.orders.read' },
    { id: 'p3', module_id: 'm1', resource: 'sales_orders', resource_ar: 'أوامر البيع', action: 'update', action_ar: 'تعديل', permission_key: 'sales.orders.update' },
    { id: 'p4', module_id: 'm1', resource: 'sales_orders', resource_ar: 'أوامر البيع', action: 'delete', action_ar: 'حذف', permission_key: 'sales.orders.delete' },
    { id: 'p5', module_id: 'm2', resource: 'inventory', resource_ar: 'المخزون', action: 'read', action_ar: 'عرض', permission_key: 'inventory.read' }
  ];

  const groupByModule = (perms: Permission[]) => {
    return perms.reduce((groups, perm) => {
      const key = perm.module_id;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(perm);
      return groups;
    }, {} as Record<string, Permission[]>);
  };

  const groupByResource = (perms: Permission[]) => {
    return perms.reduce((groups, perm) => {
      const key = perm.resource;
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(perm);
      return groups;
    }, {} as Record<string, Permission[]>);
  };

  const getActions = (perms: Permission[]) => {
    return [...new Set(perms.map(p => p.action))];
  };

  it('should group by module', () => {
    const groups = groupByModule(permissions);
    expect(Object.keys(groups).length).toBe(2);
    expect(groups['m1'].length).toBe(4);
    expect(groups['m2'].length).toBe(1);
  });

  it('should group by resource', () => {
    const groups = groupByResource(permissions);
    expect(groups['sales_orders'].length).toBe(4);
    expect(groups['inventory'].length).toBe(1);
  });

  it('should extract unique actions', () => {
    const actions = getActions(permissions);
    expect(actions).toContain('create');
    expect(actions).toContain('read');
    expect(actions).toContain('update');
    expect(actions).toContain('delete');
  });
});

// ===================== ROLE TEMPLATES =====================

describe('Role Templates', () => {
  const templates: RoleTemplate[] = [
    { id: 't1', name: 'Super Admin', name_ar: 'مدير عام', description: 'Full access', permissions: ['*'] },
    { id: 't2', name: 'Accountant', name_ar: 'محاسب', description: 'Accounting access', permissions: ['accounting.*'] },
    { id: 't3', name: 'Sales Rep', name_ar: 'مندوب مبيعات', description: 'Sales access', permissions: ['sales.orders.create', 'sales.orders.read'] },
    { id: 't4', name: 'Viewer', name_ar: 'مشاهد', description: 'Read only', permissions: ['*.read'] }
  ];

  const findTemplateByName = (name: string) => {
    return templates.find(t => t.name.toLowerCase() === name.toLowerCase());
  };

  const getTemplatePermissionCount = (template: RoleTemplate) => {
    return template.permissions.length;
  };

  const matchesWildcard = (permissionKey: string, pattern: string) => {
    if (pattern === '*') return true;
    if (pattern.endsWith('.*')) {
      const prefix = pattern.slice(0, -2);
      return permissionKey.startsWith(prefix);
    }
    if (pattern.startsWith('*.')) {
      const suffix = pattern.slice(2);
      return permissionKey.endsWith(suffix);
    }
    return permissionKey === pattern;
  };

  it('should find template by name', () => {
    const template = findTemplateByName('accountant');
    expect(template?.name_ar).toBe('محاسب');
  });

  it('should match wildcard patterns', () => {
    expect(matchesWildcard('sales.orders.create', '*')).toBe(true);
    expect(matchesWildcard('accounting.journal.create', 'accounting.*')).toBe(true);
    expect(matchesWildcard('sales.orders.read', '*.read')).toBe(true);
    expect(matchesWildcard('sales.orders.delete', '*.read')).toBe(false);
  });

  it('should match exact permission', () => {
    expect(matchesWildcard('sales.orders.create', 'sales.orders.create')).toBe(true);
    expect(matchesWildcard('sales.orders.create', 'sales.orders.read')).toBe(false);
  });
});

// ===================== SYSTEM ROLES =====================

describe('System Roles', () => {
  const roles: Role[] = [
    { id: 'r1', name: 'Super Admin', name_ar: 'مدير عام', is_system: true, is_active: true, permission_ids: ['*'] },
    { id: 'r2', name: 'Org Admin', name_ar: 'مدير المنظمة', is_system: true, is_active: true, permission_ids: ['admin.*'] },
    { id: 'r3', name: 'Custom Role', name_ar: 'دور مخصص', is_system: false, is_active: true, permission_ids: ['p1', 'p2'] },
    { id: 'r4', name: 'Inactive Role', name_ar: 'دور غير نشط', is_system: false, is_active: false, permission_ids: ['p3'] }
  ];

  const getSystemRoles = () => roles.filter(r => r.is_system);
  const getCustomRoles = () => roles.filter(r => !r.is_system);
  const getActiveRoles = () => roles.filter(r => r.is_active);

  const canDeleteRole = (role: Role) => !role.is_system;
  const canEditRole = (role: Role) => !role.is_system;
  const canDeactivateRole = (role: Role) => !role.is_system && role.is_active;

  it('should identify system roles', () => {
    const systemRoles = getSystemRoles();
    expect(systemRoles.length).toBe(2);
    expect(systemRoles.every(r => r.is_system)).toBe(true);
  });

  it('should identify custom roles', () => {
    const customRoles = getCustomRoles();
    expect(customRoles.length).toBe(2);
    expect(customRoles.every(r => !r.is_system)).toBe(true);
  });

  it('should filter active roles', () => {
    const activeRoles = getActiveRoles();
    expect(activeRoles.length).toBe(3);
  });

  it('should prevent deletion of system roles', () => {
    const superAdmin = roles.find(r => r.name === 'Super Admin')!;
    const customRole = roles.find(r => r.name === 'Custom Role')!;

    expect(canDeleteRole(superAdmin)).toBe(false);
    expect(canDeleteRole(customRole)).toBe(true);
  });

  it('should prevent editing of system roles', () => {
    const superAdmin = roles.find(r => r.name === 'Super Admin')!;
    expect(canEditRole(superAdmin)).toBe(false);
  });
});

// ===================== PERMISSION CHECKING =====================

describe('Permission Checking', () => {
  const userPermissions = [
    'sales.orders.create',
    'sales.orders.read',
    'sales.orders.update',
    'inventory.read'
  ];

  const hasPermission = (permission: string) => {
    return userPermissions.includes(permission);
  };

  const hasAnyPermission = (permissions: string[]) => {
    return permissions.some(p => userPermissions.includes(p));
  };

  const hasAllPermissions = (permissions: string[]) => {
    return permissions.every(p => userPermissions.includes(p));
  };

  const hasModuleAccess = (modulePrefix: string) => {
    return userPermissions.some(p => p.startsWith(modulePrefix));
  };

  it('should check single permission', () => {
    expect(hasPermission('sales.orders.create')).toBe(true);
    expect(hasPermission('sales.orders.delete')).toBe(false);
  });

  it('should check any permission', () => {
    expect(hasAnyPermission(['sales.orders.delete', 'sales.orders.read'])).toBe(true);
    expect(hasAnyPermission(['admin.users.create', 'admin.users.delete'])).toBe(false);
  });

  it('should check all permissions', () => {
    expect(hasAllPermissions(['sales.orders.create', 'sales.orders.read'])).toBe(true);
    expect(hasAllPermissions(['sales.orders.create', 'sales.orders.delete'])).toBe(false);
  });

  it('should check module access', () => {
    expect(hasModuleAccess('sales')).toBe(true);
    expect(hasModuleAccess('inventory')).toBe(true);
    expect(hasModuleAccess('admin')).toBe(false);
  });
});

// ===================== USER ROLE ASSIGNMENT =====================

describe('User Role Assignment', () => {
  interface UserRole {
    user_id: string;
    role_id: string;
    assigned_at: string;
    assigned_by: string;
  }

  const userRoles: UserRole[] = [
    { user_id: 'u1', role_id: 'r1', assigned_at: '2024-01-01', assigned_by: 'admin' },
    { user_id: 'u1', role_id: 'r2', assigned_at: '2024-01-15', assigned_by: 'admin' },
    { user_id: 'u2', role_id: 'r2', assigned_at: '2024-02-01', assigned_by: 'admin' }
  ];

  const getUserRoles = (userId: string) => {
    return userRoles.filter(ur => ur.user_id === userId);
  };

  const getUsersWithRole = (roleId: string) => {
    return userRoles.filter(ur => ur.role_id === roleId);
  };

  const hasRole = (userId: string, roleId: string) => {
    return userRoles.some(ur => ur.user_id === userId && ur.role_id === roleId);
  };

  const canAssignRole = (role: Role, currentUserIsAdmin: boolean) => {
    if (!role.is_active) return false;
    if (role.is_system && !currentUserIsAdmin) return false;
    return true;
  };

  it('should get user roles', () => {
    const roles = getUserRoles('u1');
    expect(roles.length).toBe(2);
  });

  it('should get users with role', () => {
    const users = getUsersWithRole('r2');
    expect(users.length).toBe(2);
  });

  it('should check if user has role', () => {
    expect(hasRole('u1', 'r1')).toBe(true);
    expect(hasRole('u1', 'r3')).toBe(false);
  });

  it('should check role assignment permissions', () => {
    const activeRole: Role = { id: 'r1', name: 'Test', name_ar: 'تجربة', is_system: false, is_active: true, permission_ids: [] };
    const systemRole: Role = { id: 'r2', name: 'System', name_ar: 'نظام', is_system: true, is_active: true, permission_ids: [] };
    const inactiveRole: Role = { id: 'r3', name: 'Inactive', name_ar: 'غير نشط', is_system: false, is_active: false, permission_ids: [] };

    expect(canAssignRole(activeRole, false)).toBe(true);
    expect(canAssignRole(systemRole, false)).toBe(false);
    expect(canAssignRole(systemRole, true)).toBe(true);
    expect(canAssignRole(inactiveRole, true)).toBe(false);
  });
});

// ===================== CATEGORY LABELS =====================

describe('Category Labels', () => {
  const categoryLabels: Record<string, { en: string; ar: string }> = {
    accounting: { en: 'Accounting', ar: 'المحاسبة' },
    manufacturing: { en: 'Manufacturing', ar: 'التصنيع' },
    sales: { en: 'Sales', ar: 'المبيعات' },
    inventory: { en: 'Inventory', ar: 'المخزون' },
    purchasing: { en: 'Purchasing', ar: 'المشتريات' },
    admin: { en: 'Administration', ar: 'الإدارة' }
  };

  const getCategoryLabel = (category: string, lang: 'en' | 'ar') => {
    return categoryLabels[category]?.[lang] || category;
  };

  const getAllCategories = () => Object.keys(categoryLabels);

  it('should get English category label', () => {
    expect(getCategoryLabel('accounting', 'en')).toBe('Accounting');
  });

  it('should get Arabic category label', () => {
    expect(getCategoryLabel('sales', 'ar')).toBe('المبيعات');
  });

  it('should return category code for unknown category', () => {
    expect(getCategoryLabel('unknown', 'en')).toBe('unknown');
  });

  it('should get all categories', () => {
    const categories = getAllCategories();
    expect(categories.length).toBe(6);
    expect(categories).toContain('accounting');
    expect(categories).toContain('sales');
  });
});

// ===================== ROLE COMPARISON =====================

describe('Role Comparison', () => {
  const compareRoles = (roleA: Role, roleB: Role) => {
    const aPermCount = roleA.permission_ids.length;
    const bPermCount = roleB.permission_ids.length;

    const commonPerms = roleA.permission_ids.filter(p => roleB.permission_ids.includes(p));
    const onlyInA = roleA.permission_ids.filter(p => !roleB.permission_ids.includes(p));
    const onlyInB = roleB.permission_ids.filter(p => !roleA.permission_ids.includes(p));

    return {
      roleACount: aPermCount,
      roleBCount: bPermCount,
      commonCount: commonPerms.length,
      onlyInACount: onlyInA.length,
      onlyInBCount: onlyInB.length,
      overlapPercentage: Math.round((commonPerms.length / Math.max(aPermCount, bPermCount)) * 100)
    };
  };

  const roleA: Role = {
    id: 'r1',
    name: 'Role A',
    name_ar: 'دور أ',
    is_system: false,
    is_active: true,
    permission_ids: ['p1', 'p2', 'p3', 'p4', 'p5']
  };

  const roleB: Role = {
    id: 'r2',
    name: 'Role B',
    name_ar: 'دور ب',
    is_system: false,
    is_active: true,
    permission_ids: ['p3', 'p4', 'p5', 'p6', 'p7']
  };

  it('should compare roles correctly', () => {
    const comparison = compareRoles(roleA, roleB);
    expect(comparison.roleACount).toBe(5);
    expect(comparison.roleBCount).toBe(5);
    expect(comparison.commonCount).toBe(3);
    expect(comparison.onlyInACount).toBe(2);
    expect(comparison.onlyInBCount).toBe(2);
    expect(comparison.overlapPercentage).toBe(60);
  });

  it('should handle identical roles', () => {
    const comparison = compareRoles(roleA, roleA);
    expect(comparison.commonCount).toBe(5);
    expect(comparison.onlyInACount).toBe(0);
    expect(comparison.overlapPercentage).toBe(100);
  });

  it('should handle disjoint roles', () => {
    const roleC: Role = {
      id: 'r3',
      name: 'Role C',
      name_ar: 'دور ج',
      is_system: false,
      is_active: true,
      permission_ids: ['p8', 'p9', 'p10']
    };

    const comparison = compareRoles(roleA, roleC);
    expect(comparison.commonCount).toBe(0);
    expect(comparison.overlapPercentage).toBe(0);
  });
});

// ===================== AUDIT LOG =====================

describe('Audit Log', () => {
  interface AuditEntry {
    id: string;
    action: 'create' | 'update' | 'delete' | 'assign' | 'revoke';
    entity_type: 'role' | 'permission' | 'user_role';
    entity_id: string;
    user_id: string;
    timestamp: string;
    changes?: Record<string, { old: any; new: any }>;
  }

  const auditLog: AuditEntry[] = [
    { id: 'a1', action: 'create', entity_type: 'role', entity_id: 'r1', user_id: 'u1', timestamp: '2024-01-15T10:00:00Z' },
    { id: 'a2', action: 'assign', entity_type: 'user_role', entity_id: 'ur1', user_id: 'u1', timestamp: '2024-01-15T11:00:00Z' },
    { id: 'a3', action: 'update', entity_type: 'role', entity_id: 'r1', user_id: 'u1', timestamp: '2024-01-16T09:00:00Z', changes: { name: { old: 'Old Name', new: 'New Name' } } }
  ];

  const filterByAction = (action: string) => {
    return auditLog.filter(e => e.action === action);
  };

  const filterByEntity = (entityType: string) => {
    return auditLog.filter(e => e.entity_type === entityType);
  };

  const getEntityHistory = (entityType: string, entityId: string) => {
    return auditLog
      .filter(e => e.entity_type === entityType && e.entity_id === entityId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  };

  it('should filter by action', () => {
    const creates = filterByAction('create');
    expect(creates.length).toBe(1);
  });

  it('should filter by entity type', () => {
    const roleEntries = filterByEntity('role');
    expect(roleEntries.length).toBe(2);
  });

  it('should get entity history', () => {
    const history = getEntityHistory('role', 'r1');
    expect(history.length).toBe(2);
    expect(history[0].action).toBe('create');
    expect(history[1].action).toBe('update');
  });
});

// ===================== BULK OPERATIONS =====================

describe('Bulk Operations', () => {
  const validateBulkAssignment = (userIds: string[], roleId: string, existingAssignments: { user_id: string; role_id: string }[]) => {
    const alreadyAssigned = userIds.filter(userId =>
      existingAssignments.some(a => a.user_id === userId && a.role_id === roleId)
    );

    const toAssign = userIds.filter(userId =>
      !existingAssignments.some(a => a.user_id === userId && a.role_id === roleId)
    );

    return {
      alreadyAssignedCount: alreadyAssigned.length,
      toAssignCount: toAssign.length,
      alreadyAssignedIds: alreadyAssigned,
      toAssignIds: toAssign
    };
  };

  it('should identify already assigned users', () => {
    const existing = [
      { user_id: 'u1', role_id: 'r1' },
      { user_id: 'u2', role_id: 'r1' }
    ];

    const result = validateBulkAssignment(['u1', 'u2', 'u3', 'u4'], 'r1', existing);
    expect(result.alreadyAssignedCount).toBe(2);
    expect(result.toAssignCount).toBe(2);
    expect(result.toAssignIds).toEqual(['u3', 'u4']);
  });

  it('should handle all new assignments', () => {
    const existing: { user_id: string; role_id: string }[] = [];

    const result = validateBulkAssignment(['u1', 'u2'], 'r1', existing);
    expect(result.alreadyAssignedCount).toBe(0);
    expect(result.toAssignCount).toBe(2);
  });

  it('should handle all existing assignments', () => {
    const existing = [
      { user_id: 'u1', role_id: 'r1' },
      { user_id: 'u2', role_id: 'r1' }
    ];

    const result = validateBulkAssignment(['u1', 'u2'], 'r1', existing);
    expect(result.alreadyAssignedCount).toBe(2);
    expect(result.toAssignCount).toBe(0);
  });
});
