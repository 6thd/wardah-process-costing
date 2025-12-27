/**
 * BOM Routing Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  delete: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseQuery),
    rpc: vi.fn(),
  },
  getEffectiveTenantId: vi.fn(),
}));

import { bomRoutingService } from '../bomRoutingService';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

describe('bomRoutingService', () => {
  const testOrgId = 'test-org-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveTenantId).mockResolvedValue(testOrgId);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null, count: null, status: 200, statusText: 'OK' });
    
    // Reset all mock implementations
    Object.keys(mockSupabaseQuery).forEach(key => {
      (mockSupabaseQuery as any)[key].mockReturnThis();
    });
  });

  describe('getOperations', () => {
    it('should get operations for BOM', async () => {
      const mockOperations = [
        {
          id: 'op-1',
          bom_id: 'bom-1',
          operation_sequence: 1,
          operation_code: 'OP001',
          operation_name: 'Cutting',
          setup_time_minutes: 10,
          run_time_minutes: 5,
          labor_rate: 20,
          is_critical: true,
          is_active: true,
          org_id: testOrgId,
        },
      ];

      mockSupabaseQuery.order.mockResolvedValue({ data: mockOperations, error: null, count: null, status: 200, statusText: 'OK' });

      const result = await bomRoutingService.getOperations('bom-1');

      expect(result).toHaveLength(1);
      expect(result[0].operation_code).toBe('OP001');
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomRoutingService.getOperations('bom-1')).rejects.toThrow('Organization ID not found');
    });

    it('should return empty array when no operations found', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null, count: null, status: 200, statusText: 'OK' });

      const result = await bomRoutingService.getOperations('bom-1');

      expect(result).toEqual([]);
    });
  });

  describe('addOperation', () => {
    it('should add operation successfully', async () => {
      const newOperation = {
        bom_id: 'bom-1',
        operation_sequence: 1,
        operation_code: 'OP001',
        operation_name: 'Cutting',
        setup_time_minutes: 10,
        run_time_minutes: 5,
        labor_rate: 20,
        is_critical: true,
        is_active: true,
        org_id: testOrgId,
      };

      mockSupabaseQuery.single.mockResolvedValue({ data: { id: 'op-1' }, error: null, count: null, status: 200, statusText: 'OK' });

      const result = await bomRoutingService.addOperation(newOperation);

      expect(result).toBe('op-1');
      expect(mockSupabaseQuery.insert).toHaveBeenCalled();
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      const newOperation = {
        bom_id: 'bom-1',
        operation_sequence: 1,
        operation_code: 'OP001',
        operation_name: 'Cutting',
        setup_time_minutes: 10,
        run_time_minutes: 5,
        labor_rate: 20,
        is_critical: true,
        is_active: true,
        org_id: testOrgId,
      };

      await expect(bomRoutingService.addOperation(newOperation)).rejects.toThrow('Organization ID not found');
    });
  });

  describe('updateOperation', () => {
    it('should update operation successfully', async () => {
      const updates = {
        setup_time_minutes: 15,
        run_time_minutes: 8,
      };

      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: null, count: null, status: 200, statusText: 'OK' });

      await bomRoutingService.updateOperation('op-1', updates);

      expect(mockSupabaseQuery.update).toHaveBeenCalled();
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', 'op-1');
    });

    it('should handle update errors', async () => {
      const dbError = { code: 'PGRST116', message: 'Update failed' };
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: dbError });

      await expect(
        bomRoutingService.updateOperation('op-1', { setup_time_minutes: 15 })
      ).rejects.toEqual(dbError);
    });
  });

  describe('deleteOperation', () => {
    it('should delete operation successfully', async () => {
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: null, count: null, status: 200, statusText: 'OK' });

      await bomRoutingService.deleteOperation('op-1');

      expect(mockSupabaseQuery.delete).toHaveBeenCalled();
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', 'op-1');
    });

    it('should handle delete errors', async () => {
      const dbError = { code: 'PGRST116', message: 'Delete failed' };
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: dbError });

      await expect(bomRoutingService.deleteOperation('op-1')).rejects.toEqual(dbError);
    });
  });

  describe('calculateRoutingCost', () => {
    it('should calculate routing cost successfully', async () => {
      const mockCosts = [
        {
          operation_sequence: 1,
          operation_code: 'OP001',
          operation_name: 'Cutting',
          setup_cost: 20,
          run_cost: 100,
          total_cost: 120,
          total_time_minutes: 15,
        },
      ];

      vi.mocked(supabase.rpc).mockResolvedValue({ data: mockCosts, error: null, count: null, status: 200, statusText: 'OK' });

      const result = await bomRoutingService.calculateRoutingCost('bom-1', 10);

      expect(result).toHaveLength(1);
      expect(result[0].total_cost).toBe(120);
    });

    it('should use default quantity of 1', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null, count: null, status: 200, statusText: 'OK' });

      await bomRoutingService.calculateRoutingCost('bom-1');

      expect(supabase.rpc).toHaveBeenCalledWith('calculate_routing_cost', expect.objectContaining({
        p_quantity: 1,
      }));
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomRoutingService.calculateRoutingCost('bom-1')).rejects.toThrow('Organization ID not found');
    });
  });

  describe('calculateTotalRoutingCost', () => {
    it('should calculate total routing cost successfully', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: 500, error: null, count: null, status: 200, statusText: 'OK' });

      const result = await bomRoutingService.calculateTotalRoutingCost('bom-1', 10);

      expect(result).toBe(500);
    });

    it('should return 0 when RPC returns null', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null, count: null, status: 200, statusText: 'OK' });

      const result = await bomRoutingService.calculateTotalRoutingCost('bom-1');

      expect(result).toBe(0);
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomRoutingService.calculateTotalRoutingCost('bom-1')).rejects.toThrow('Organization ID not found');
    });
  });

  describe('getOperationMaterials', () => {
    it('should get operation materials successfully', async () => {
      const mockMaterials = [
        {
          id: 'mat-1',
          operation_id: 'op-1',
          item_id: 'item-1',
          quantity_required: 10,
          issue_type: 'AUTO' as const,
          org_id: testOrgId,
        },
      ];

      mockSupabaseQuery.order.mockResolvedValue({ data: mockMaterials, error: null });

      const result = await bomRoutingService.getOperationMaterials('op-1');

      expect(result).toHaveLength(1);
      expect(result[0].item_id).toBe('item-1');
    });

    it('should return empty array when no materials found', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null, count: null, status: 200, statusText: 'OK' });

      const result = await bomRoutingService.getOperationMaterials('op-1');

      expect(result).toEqual([]);
    });
  });

  describe('addOperationMaterial', () => {
    it('should add operation material successfully', async () => {
      const newMaterial = {
        operation_id: 'op-1',
        item_id: 'item-1',
        quantity_required: 10,
        issue_type: 'AUTO' as const,
        org_id: testOrgId,
      };

      mockSupabaseQuery.single.mockResolvedValue({ data: { id: 'mat-1' }, error: null });

      const result = await bomRoutingService.addOperationMaterial(newMaterial);

      expect(result).toBe('mat-1');
      expect(mockSupabaseQuery.insert).toHaveBeenCalled();
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      const newMaterial = {
        operation_id: 'op-1',
        item_id: 'item-1',
        quantity_required: 10,
        issue_type: 'AUTO' as const,
        org_id: testOrgId,
      };

      await expect(bomRoutingService.addOperationMaterial(newMaterial)).rejects.toThrow('Organization ID not found');
    });
  });
});

