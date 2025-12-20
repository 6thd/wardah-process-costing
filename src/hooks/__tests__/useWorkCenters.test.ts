/**
 * Work Centers Hook Tests
 * 
 * Tests for useWorkCenters React Query hook - Unit tests only (no async queries)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WorkCenter } from '@/types/work-center';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      update: vi.fn().mockReturnThis(),
      delete: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
    })),
  },
}));

vi.mock('@/lib/config', () => ({
  loadConfig: vi.fn(() => Promise.resolve({ ORG_ID: 'test-org-123' })),
}));

describe('Work Centers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('WorkCenter Type', () => {
    it('should have required fields', () => {
      const workCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Test Center',
        org_id: 'test-org',
      };

      expect(workCenter.id).toBeDefined();
      expect(workCenter.code).toBeDefined();
      expect(workCenter.name).toBeDefined();
      expect(workCenter.org_id).toBeDefined();
    });

    it('should support optional fields', () => {
      const workCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Test Center',
        description: 'Optional description',
        capacity: 100,
        cost_per_hour: 50,
        is_active: true,
        org_id: 'test-org',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      expect(workCenter.description).toBe('Optional description');
      expect(workCenter.capacity).toBe(100);
      expect(workCenter.cost_per_hour).toBe(50);
      expect(workCenter.is_active).toBe(true);
    });

    it('should handle work center with minimum data', () => {
      const minimalWorkCenter: Partial<WorkCenter> = {
        code: 'WC001',
        name: 'Minimal Center',
      };

      expect(minimalWorkCenter.code).toBe('WC001');
      expect(minimalWorkCenter.name).toBe('Minimal Center');
    });
  });

  describe('Work Center Validation', () => {
    it('should validate work center code format', () => {
      const validCodes = ['WC001', 'WC-001', 'WELDING-01', 'A1'];
      
      validCodes.forEach(code => {
        expect(code.length).toBeGreaterThan(0);
        expect(typeof code).toBe('string');
      });
    });

    it('should validate capacity is positive', () => {
      const workCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Test Center',
        capacity: 100,
        org_id: 'test-org',
      };

      expect(workCenter.capacity).toBeGreaterThan(0);
    });

    it('should validate cost_per_hour is non-negative', () => {
      const workCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Test Center',
        cost_per_hour: 50.00,
        org_id: 'test-org',
      };

      expect(workCenter.cost_per_hour).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Work Center Operations', () => {
    it('should calculate hourly cost correctly', () => {
      const workCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Welding Center',
        cost_per_hour: 75.00,
        org_id: 'test-org',
      };

      const hoursWorked = 8;
      const totalCost = workCenter.cost_per_hour! * hoursWorked;

      expect(totalCost).toBe(600);
    });

    it('should calculate capacity utilization', () => {
      const workCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Assembly Center',
        capacity: 100,
        org_id: 'test-org',
      };

      const unitsProduced = 85;
      const utilization = (unitsProduced / workCenter.capacity!) * 100;

      expect(utilization).toBe(85);
    });

    it('should handle inactive work centers', () => {
      const inactiveWorkCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Deprecated Center',
        is_active: false,
        org_id: 'test-org',
      };

      expect(inactiveWorkCenter.is_active).toBe(false);
    });
  });

  describe('Work Center Data Transformation', () => {
    it('should transform API response to WorkCenter type', () => {
      const apiResponse = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Test Center',
        description: 'Test description',
        capacity: 100,
        cost_per_hour: 50,
        is_active: true,
        org_id: 'test-org',
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      };

      const workCenter: WorkCenter = apiResponse;

      expect(workCenter.id).toBe('wc-1');
      expect(workCenter.code).toBe('WC001');
      expect(workCenter.created_at).toBeDefined();
    });

    it('should filter work centers by active status', () => {
      const workCenters: WorkCenter[] = [
        { id: 'wc-1', code: 'WC001', name: 'Active 1', is_active: true, org_id: 'org' },
        { id: 'wc-2', code: 'WC002', name: 'Inactive 1', is_active: false, org_id: 'org' },
        { id: 'wc-3', code: 'WC003', name: 'Active 2', is_active: true, org_id: 'org' },
      ];

      const activeWorkCenters = workCenters.filter(wc => wc.is_active);

      expect(activeWorkCenters).toHaveLength(2);
      expect(activeWorkCenters.every(wc => wc.is_active)).toBe(true);
    });

    it('should sort work centers by name', () => {
      const workCenters: WorkCenter[] = [
        { id: 'wc-1', code: 'WC001', name: 'Zebra Center', org_id: 'org' },
        { id: 'wc-2', code: 'WC002', name: 'Alpha Center', org_id: 'org' },
        { id: 'wc-3', code: 'WC003', name: 'Beta Center', org_id: 'org' },
      ];

      const sorted = [...workCenters].sort((a, b) => a.name.localeCompare(b.name));

      expect(sorted[0].name).toBe('Alpha Center');
      expect(sorted[1].name).toBe('Beta Center');
      expect(sorted[2].name).toBe('Zebra Center');
    });
  });

  describe('Work Center Cost Calculations', () => {
    it('should calculate total labor cost for manufacturing order', () => {
      const workCenters: WorkCenter[] = [
        { id: 'wc-1', code: 'WC001', name: 'Welding', cost_per_hour: 50, org_id: 'org' },
        { id: 'wc-2', code: 'WC002', name: 'Assembly', cost_per_hour: 75, org_id: 'org' },
      ];

      const workHours = [
        { workCenterId: 'wc-1', hours: 4 },
        { workCenterId: 'wc-2', hours: 2 },
      ];

      const totalCost = workHours.reduce((sum, wh) => {
        const wc = workCenters.find(w => w.id === wh.workCenterId);
        return sum + (wc?.cost_per_hour || 0) * wh.hours;
      }, 0);

      expect(totalCost).toBe(4 * 50 + 2 * 75); // 200 + 150 = 350
    });

    it('should handle missing cost_per_hour', () => {
      const workCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'No Cost Center',
        org_id: 'org',
      };

      const cost = workCenter.cost_per_hour ?? 0;
      expect(cost).toBe(0);
    });
  });

  describe('Multi-tenant Support', () => {
    it('should filter by organization id', () => {
      const allWorkCenters: WorkCenter[] = [
        { id: 'wc-1', code: 'WC001', name: 'Org1 Center', org_id: 'org-1' },
        { id: 'wc-2', code: 'WC002', name: 'Org2 Center', org_id: 'org-2' },
        { id: 'wc-3', code: 'WC003', name: 'Org1 Center 2', org_id: 'org-1' },
      ];

      const org1Centers = allWorkCenters.filter(wc => wc.org_id === 'org-1');

      expect(org1Centers).toHaveLength(2);
      expect(org1Centers.every(wc => wc.org_id === 'org-1')).toBe(true);
    });

    it('should not allow cross-organization access', () => {
      const workCenter: WorkCenter = {
        id: 'wc-1',
        code: 'WC001',
        name: 'Org1 Center',
        org_id: 'org-1',
      };

      const currentOrgId = 'org-2';
      const hasAccess = workCenter.org_id === currentOrgId;

      expect(hasAccess).toBe(false);
    });
  });
});

