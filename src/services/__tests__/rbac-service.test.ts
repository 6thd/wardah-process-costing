/**
 * RBAC Service Tests
 * Tests for Role-Based Access Control system
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the supabase module
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import {
  getModules,
  getPermissionsGrouped,
  getAllPermissions,
  getOrgRoles,
  getRoleWithPermissions,
  type Module,
  type Permission,
  type Role,
} from '../rbac-service';

describe('RBAC Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getModules', () => {
    it('should return active modules ordered by display_order', async () => {
      const mockModules: Module[] = [
        {
          id: 'mod-1',
          name: 'Manufacturing',
          name_ar: 'التصنيع',
          display_order: 1,
          is_active: true,
        },
        {
          id: 'mod-2',
          name: 'Inventory',
          name_ar: 'المخزون',
          display_order: 2,
          is_active: true,
        },
        {
          id: 'mod-3',
          name: 'Accounting',
          name_ar: 'المحاسبة',
          display_order: 3,
          is_active: true,
        },
      ];

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: mockModules,
              error: null,
            }),
          }),
        }),
      });

      const result = await getModules();

      expect(result).toHaveLength(3);
      expect(result[0].name).toBe('Manufacturing');
      expect(result[2].name).toBe('Accounting');
    });

    it('should return empty array on error', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
      });

      const result = await getModules();

      expect(result).toEqual([]);
    });

    it('should only fetch active modules', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation((field, value) => {
          if (field === 'is_active') {
            expect(value).toBe(true);
          }
          return {
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          };
        }),
      });

      mockFrom.mockReturnValue({ select: mockSelect });

      await getModules();
    });
  });

  describe('getAllPermissions', () => {
    it('should return all permissions with module info', async () => {
      const mockPermissions: Permission[] = [
        {
          id: 'perm-1',
          module_id: 'mod-1',
          resource: 'manufacturing_orders',
          resource_ar: 'أوامر التصنيع',
          action: 'create',
          action_ar: 'إنشاء',
          permission_key: 'manufacturing.orders.create',
        },
        {
          id: 'perm-2',
          module_id: 'mod-1',
          resource: 'manufacturing_orders',
          resource_ar: 'أوامر التصنيع',
          action: 'read',
          action_ar: 'عرض',
          permission_key: 'manufacturing.orders.read',
        },
        {
          id: 'perm-3',
          module_id: 'mod-2',
          resource: 'inventory_items',
          resource_ar: 'الأصناف',
          action: 'update',
          action_ar: 'تعديل',
          permission_key: 'inventory.items.update',
        },
      ];

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockPermissions,
            error: null,
          }),
        }),
      });

      const result = await getAllPermissions();

      expect(result).toHaveLength(3);
      expect(result[0].permission_key).toBe('manufacturing.orders.create');
    });

    it('should return empty array on error', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Error' },
          }),
        }),
      });

      const result = await getAllPermissions();

      expect(result).toEqual([]);
    });
  });

  describe('getPermissionsGrouped', () => {
    it('should group permissions by module', async () => {
      const mockPermissions: Permission[] = [
        {
          id: 'perm-1',
          module_id: 'mod-1',
          resource: 'orders',
          resource_ar: 'الطلبات',
          action: 'create',
          action_ar: 'إنشاء',
          permission_key: 'mod1.orders.create',
        },
        {
          id: 'perm-2',
          module_id: 'mod-1',
          resource: 'orders',
          resource_ar: 'الطلبات',
          action: 'read',
          action_ar: 'عرض',
          permission_key: 'mod1.orders.read',
        },
        {
          id: 'perm-3',
          module_id: 'mod-2',
          resource: 'items',
          resource_ar: 'الأصناف',
          action: 'create',
          action_ar: 'إنشاء',
          permission_key: 'mod2.items.create',
        },
      ];

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockPermissions,
            error: null,
          }),
        }),
      });

      const result = await getPermissionsGrouped();

      expect(result.size).toBe(2);
      expect(result.get('mod-1')).toHaveLength(2);
      expect(result.get('mod-2')).toHaveLength(1);
    });
  });

  describe('getOrgRoles', () => {
    it('should return organization roles', async () => {
      const mockRoles: Role[] = [
        {
          id: 'role-1',
          org_id: 'org-123',
          name: 'Administrator',
          name_ar: 'مدير النظام',
          is_system_role: true,
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
        },
        {
          id: 'role-2',
          org_id: 'org-123',
          name: 'Accountant',
          name_ar: 'محاسب',
          is_system_role: false,
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
        },
      ];

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: mockRoles,
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await getOrgRoles('org-123');

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Administrator');
    });

    it('should filter by org_id', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation((field, value) => {
          if (field === 'org_id') {
            expect(value).toBe('org-456');
          }
          return {
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [],
                error: null,
              }),
            }),
          };
        }),
      });

      mockFrom.mockReturnValue({ select: mockSelect });

      await getOrgRoles('org-456');
    });
  });

  describe('getRoleWithPermissions', () => {
    it('should return role with permissions', async () => {
      const mockRole: Role = {
        id: 'role-1',
        org_id: 'org-123',
        name: 'Manager',
        name_ar: 'مدير',
        is_system_role: false,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
      };

      const mockRolePerms = [
        {
          permission: {
            id: 'perm-1',
            permission_key: 'manufacturing.orders.create',
          },
        },
        {
          permission: {
            id: 'perm-2',
            permission_key: 'manufacturing.orders.read',
          },
        },
      ];

      mockFrom.mockImplementation((table: string) => {
        if (table === 'roles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: mockRole,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'role_permissions') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({
                data: mockRolePerms,
                error: null,
              }),
            }),
          };
        }
        return {};
      });

      const result = await getRoleWithPermissions('role-1');

      expect(result).not.toBeNull();
      expect(result?.permissions).toHaveLength(2);
    });

    it('should return null when role not found', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { code: 'PGRST116' },
            }),
          }),
        }),
      });

      const result = await getRoleWithPermissions('non-existent');

      expect(result).toBeNull();
    });
  });
});

describe('Permission Key Format', () => {
  it('should follow module.resource.action format', () => {
    const validKeys = [
      'manufacturing.orders.create',
      'manufacturing.orders.read',
      'manufacturing.orders.update',
      'manufacturing.orders.delete',
      'inventory.items.read',
      'accounting.journals.create',
    ];

    validKeys.forEach((key) => {
      const parts = key.split('.');
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBeTruthy(); // module
      expect(parts[1]).toBeTruthy(); // resource
      expect(parts[2]).toBeTruthy(); // action
    });
  });

  it('should support standard CRUD actions', () => {
    const standardActions = ['create', 'read', 'update', 'delete'];
    const permissionKeys = [
      'manufacturing.orders.create',
      'manufacturing.orders.read',
      'manufacturing.orders.update',
      'manufacturing.orders.delete',
    ];

    permissionKeys.forEach((key) => {
      const action = key.split('.')[2];
      expect(standardActions).toContain(action);
    });
  });
});

describe('Role Hierarchy', () => {
  it('should identify system roles', () => {
    const roles: Role[] = [
      {
        id: 'role-1',
        org_id: 'org-123',
        name: 'Super Admin',
        name_ar: 'مدير عام',
        is_system_role: true,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'role-2',
        org_id: 'org-123',
        name: 'Custom Role',
        name_ar: 'دور مخصص',
        is_system_role: false,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    const systemRoles = roles.filter((r) => r.is_system_role);
    const customRoles = roles.filter((r) => !r.is_system_role);

    expect(systemRoles).toHaveLength(1);
    expect(customRoles).toHaveLength(1);
  });

  it('should filter inactive roles', () => {
    const roles: Role[] = [
      {
        id: 'role-1',
        org_id: 'org-123',
        name: 'Active Role',
        name_ar: 'دور نشط',
        is_system_role: false,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
      },
      {
        id: 'role-2',
        org_id: 'org-123',
        name: 'Inactive Role',
        name_ar: 'دور غير نشط',
        is_system_role: false,
        is_active: false,
        created_at: '2024-01-01T00:00:00Z',
      },
    ];

    const activeRoles = roles.filter((r) => r.is_active);

    expect(activeRoles).toHaveLength(1);
    expect(activeRoles[0].name).toBe('Active Role');
  });
});

describe('Permission Checking', () => {
  it('should check if user has specific permission', () => {
    const userPermissions = new Set([
      'manufacturing.orders.create',
      'manufacturing.orders.read',
      'inventory.items.read',
    ]);

    expect(userPermissions.has('manufacturing.orders.create')).toBe(true);
    expect(userPermissions.has('manufacturing.orders.delete')).toBe(false);
  });

  it('should support wildcard permissions', () => {
    const hasWildcardPermission = (
      permissions: Set<string>,
      requiredPermission: string
    ): boolean => {
      if (permissions.has(requiredPermission)) return true;

      const [module, resource] = requiredPermission.split('.');
      const wildcardKeys = [
        '*',
        `${module}.*`,
        `${module}.${resource}.*`,
      ];

      return wildcardKeys.some((key) => permissions.has(key));
    };

    const adminPermissions = new Set(['*']);
    const moduleAdminPermissions = new Set(['manufacturing.*']);
    const resourceAdminPermissions = new Set(['manufacturing.orders.*']);

    expect(hasWildcardPermission(adminPermissions, 'manufacturing.orders.delete')).toBe(true);
    expect(hasWildcardPermission(moduleAdminPermissions, 'manufacturing.orders.delete')).toBe(true);
    expect(hasWildcardPermission(resourceAdminPermissions, 'manufacturing.orders.delete')).toBe(true);
  });
});
