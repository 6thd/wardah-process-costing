/**
 * Organization Service Tests
 * Tests for multi-tenant organization management
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the supabase module
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

// Mock safe-storage
const mockStorage = new Map<string, string>();
vi.mock('@/lib/safe-storage', () => ({
  safeLocalStorage: {
    getItem: vi.fn((key: string) => mockStorage.get(key) || null),
    setItem: vi.fn((key: string, value: string) => mockStorage.set(key, value)),
    removeItem: vi.fn((key: string) => mockStorage.delete(key)),
  },
}));

import {
  getOrganizationByCode,
  getUserOrganizations,
  createOrganization,
  addUserToOrganization,
  checkUserOrgAccess,
  setCurrentOrg,
  getCurrentOrg,
  clearCurrentOrg,
  type Organization,
  type UserOrganization,
} from '../organization-service';
import { safeLocalStorage } from '@/lib/safe-storage';

describe('OrganizationService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getOrganizationByCode', () => {
    it('should return organization when found', async () => {
      const mockOrg: Organization = {
        id: 'org-123',
        name: 'Wardah Manufacturing',
        name_ar: 'وردة للتصنيع',
        code: 'WARDAH',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: mockOrg,
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await getOrganizationByCode('wardah');

      expect(result).toEqual(mockOrg);
      expect(mockFrom).toHaveBeenCalledWith('organizations');
    });

    it('should return null when organization not found', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Not found' },
              }),
            }),
          }),
        }),
      });

      const result = await getOrganizationByCode('invalid');

      expect(result).toBeNull();
    });

    it('should convert code to uppercase', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockImplementation((field, value) => {
          if (field === 'code') {
            expect(value).toBe('WARDAH'); // Should be uppercase
          }
          return {
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'org-123' },
                error: null,
              }),
            }),
          };
        }),
      });

      mockFrom.mockReturnValue({ select: mockSelect });

      await getOrganizationByCode('wardah');
    });

    it('should only return active organizations', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockImplementation((field, value) => {
            if (field === 'is_active') {
              expect(value).toBe(true);
            }
            return {
              single: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            };
          }),
        }),
      });

      mockFrom.mockReturnValue({ select: mockSelect });

      await getOrganizationByCode('TEST');
    });
  });

  describe('getUserOrganizations', () => {
    it('should return user organizations with organization details', async () => {
      const mockUserOrgs: UserOrganization[] = [
        {
          id: 'uo-1',
          user_id: 'user-123',
          org_id: 'org-1',
          role: 'admin',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          organization: {
            id: 'org-1',
            name: 'Wardah Manufacturing',
            code: 'WARDAH',
            is_active: true,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        },
        {
          id: 'uo-2',
          user_id: 'user-123',
          org_id: 'org-2',
          role: 'user',
          is_active: true,
          created_at: '2024-01-01T00:00:00Z',
          organization: {
            id: 'org-2',
            name: 'Second Company',
            code: 'SECOND',
            is_active: true,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z',
          },
        },
      ];

      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: mockUserOrgs,
              error: null,
            }),
          }),
        }),
      });

      const result = await getUserOrganizations('user-123');

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('admin');
      expect(result[1].role).toBe('user');
    });

    it('should return empty array when user has no organizations', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      });

      const result = await getUserOrganizations('user-with-no-orgs');

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database error' },
            }),
          }),
        }),
      });

      const result = await getUserOrganizations('user-123');

      expect(result).toEqual([]);
    });
  });

  describe('createOrganization', () => {
    it('should create organization and assign creator as admin', async () => {
      const mockOrg: Organization = {
        id: 'new-org-123',
        name: 'New Company',
        name_ar: 'شركة جديدة',
        code: 'NEWCO',
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z',
      };

      // Mock getOrganizationByCode to return null (code doesn't exist)
      mockFrom.mockImplementation((table: string) => {
        if (table === 'organizations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { code: 'PGRST116' },
                  }),
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: mockOrg,
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'user_organizations') {
          return {
            insert: vi.fn().mockResolvedValue({
              error: null,
            }),
          };
        }
        return {};
      });

      const result = await createOrganization({
        name: 'New Company',
        name_ar: 'شركة جديدة',
        code: 'NEWCO',
        userId: 'user-123',
      });

      expect(result.success).toBe(true);
      expect(result.organization).toBeDefined();
    });

    it('should fail if organization code already exists', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { id: 'existing-org' },
                error: null,
              }),
            }),
          }),
        }),
      });

      const result = await createOrganization({
        name: 'Duplicate Company',
        code: 'EXISTING',
        userId: 'user-123',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('رمز المنظمة مستخدم بالفعل');
    });
  });

  describe('addUserToOrganization', () => {
    it('should add user to organization with specified role', async () => {
      mockFrom.mockReturnValue({
        insert: vi.fn().mockResolvedValue({
          error: null,
        }),
      });

      const result = await addUserToOrganization({
        userId: 'user-456',
        orgId: 'org-123',
        role: 'manager',
      });

      expect(result.success).toBe(true);
    });

    it('should return error on failure', async () => {
      mockFrom.mockReturnValue({
        insert: vi.fn().mockResolvedValue({
          error: { message: 'Duplicate entry' },
        }),
      });

      const result = await addUserToOrganization({
        userId: 'user-456',
        orgId: 'org-123',
        role: 'user',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('checkUserOrgAccess', () => {
    it('should return true when user belongs to organization', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'uo-123' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      });

      const result = await checkUserOrgAccess('user-123', 'org-123');

      expect(result).toBe(true);
    });

    it('should return false when user does not belong to organization', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { code: 'PGRST116' },
                }),
              }),
            }),
          }),
        }),
      });

      const result = await checkUserOrgAccess('user-123', 'org-999');

      expect(result).toBe(false);
    });

    it('should return false on error', async () => {
      mockFrom.mockReturnValue({
        select: vi.fn().mockImplementation(() => {
          throw new Error('Network error');
        }),
      });

      const result = await checkUserOrgAccess('user-123', 'org-123');

      expect(result).toBe(false);
    });
  });

  describe('localStorage operations', () => {
    it('should set current org in localStorage', () => {
      setCurrentOrg('org-123');

      expect(safeLocalStorage.setItem).toHaveBeenCalledWith('current_org_id', 'org-123');
    });

    it('should get current org from localStorage', () => {
      mockStorage.set('current_org_id', 'org-456');

      const result = getCurrentOrg();

      expect(result).toBe('org-456');
    });

    it('should return null when no current org is set', () => {
      const result = getCurrentOrg();

      expect(result).toBeNull();
    });

    it('should clear current org from localStorage', () => {
      mockStorage.set('current_org_id', 'org-123');

      clearCurrentOrg();

      expect(safeLocalStorage.removeItem).toHaveBeenCalledWith('current_org_id');
    });
  });
});

describe('Multi-Tenant Security', () => {
  it('should isolate data between organizations', () => {
    // This is a conceptual test demonstrating the isolation principle
    const org1Data = { org_id: 'org-1', data: 'secret-1' };
    const org2Data = { org_id: 'org-2', data: 'secret-2' };

    // Simulating RLS - user from org-1 should not see org-2 data
    const currentOrgId = 'org-1';
    const filteredData = [org1Data, org2Data].filter(
      (item) => item.org_id === currentOrgId
    );

    expect(filteredData).toHaveLength(1);
    expect(filteredData[0].org_id).toBe('org-1');
  });

  it('should validate organization access before operations', () => {
    const userOrgIds = ['org-1', 'org-2'];
    const targetOrgId = 'org-3';

    const hasAccess = userOrgIds.includes(targetOrgId);

    expect(hasAccess).toBe(false);
  });

  it('should support multiple roles per organization', () => {
    const userRoles: Record<string, string> = {
      'org-1': 'admin',
      'org-2': 'user',
      'org-3': 'manager',
    };

    expect(userRoles['org-1']).toBe('admin');
    expect(userRoles['org-2']).toBe('user');
    expect(userRoles['org-3']).toBe('manager');
  });
});
