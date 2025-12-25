/**
 * BOM Alternative Service Tests
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

const mockSupabaseRpc = vi.fn();
const mockGetEffectiveTenantId = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseQuery),
    rpc: vi.fn(),
  },
  getEffectiveTenantId: vi.fn(),
}));

import { bomAlternativeService } from '../bomAlternativeService';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

describe('bomAlternativeService', () => {
  const testOrgId = 'test-org-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveTenantId).mockResolvedValue(testOrgId);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: 'bom-1', error: null });
    
    // Reset all mock implementations
    Object.keys(mockSupabaseQuery).forEach(key => {
      (mockSupabaseQuery as any)[key].mockReturnThis();
    });
  });

  describe('getAlternatives', () => {
    it('should return alternatives for primary BOM', async () => {
      const mockAlternatives = [
        {
          id: 'alt-1',
          primary_bom_id: 'bom-1',
          alternative_bom_id: 'bom-2',
          priority: 1,
          is_default: true,
          is_active: true,
          org_id: testOrgId,
        },
        {
          id: 'alt-2',
          primary_bom_id: 'bom-1',
          alternative_bom_id: 'bom-3',
          priority: 2,
          is_default: false,
          is_active: true,
          org_id: testOrgId,
        },
      ];

      mockSupabaseQuery.order.mockResolvedValue({ data: mockAlternatives, error: null });

      const result = await bomAlternativeService.getAlternatives('bom-1');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('alt-1');
      expect(result[0].priority).toBe(1);
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomAlternativeService.getAlternatives('bom-1')).rejects.toThrow('Organization ID not found');
    });

    it('should return empty array when no alternatives found', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null });

      const result = await bomAlternativeService.getAlternatives('bom-1');

      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      const dbError = { code: 'PGRST116', message: 'Database error' };
      mockSupabaseQuery.order.mockResolvedValue({ data: null, error: dbError });

      await expect(bomAlternativeService.getAlternatives('bom-1')).rejects.toEqual(dbError);
    });
  });

  describe('addAlternative', () => {
    it('should add alternative BOM successfully', async () => {
      const newAlternative = {
        primary_bom_id: 'bom-1',
        alternative_bom_id: 'bom-2',
        priority: 1,
        is_default: false,
        is_active: true,
        org_id: testOrgId,
      };

      mockSupabaseQuery.single.mockResolvedValue({ data: { id: 'alt-1' }, error: null });

      const result = await bomAlternativeService.addAlternative(newAlternative);

      expect(result).toBe('alt-1');
      expect(mockSupabaseQuery.insert).toHaveBeenCalled();
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      const newAlternative = {
        primary_bom_id: 'bom-1',
        alternative_bom_id: 'bom-2',
        priority: 1,
        is_default: false,
        is_active: true,
        org_id: testOrgId,
      };

      await expect(bomAlternativeService.addAlternative(newAlternative)).rejects.toThrow('Organization ID not found');
    });

    it('should handle insert errors', async () => {
      const dbError = { code: '23505', message: 'Duplicate key' };
      mockSupabaseQuery.single.mockResolvedValue({ data: null, error: dbError });

      const newAlternative = {
        primary_bom_id: 'bom-1',
        alternative_bom_id: 'bom-2',
        priority: 1,
        is_default: false,
        is_active: true,
        org_id: testOrgId,
      };

      await expect(bomAlternativeService.addAlternative(newAlternative)).rejects.toEqual(dbError);
    });
  });

  describe('updateAlternative', () => {
    it('should update alternative successfully', async () => {
      const updates = {
        priority: 2,
        is_default: true,
      };

      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: null });

      await bomAlternativeService.updateAlternative('alt-1', updates);

      expect(mockSupabaseQuery.update).toHaveBeenCalled();
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', 'alt-1');
    });

    it('should handle update errors', async () => {
      const dbError = { code: 'PGRST116', message: 'Update failed' };
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: dbError });

      await expect(
        bomAlternativeService.updateAlternative('alt-1', { priority: 2 })
      ).rejects.toEqual(dbError);
    });
  });

  describe('deleteAlternative', () => {
    it('should delete alternative successfully', async () => {
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: null });

      await bomAlternativeService.deleteAlternative('alt-1');

      expect(mockSupabaseQuery.delete).toHaveBeenCalled();
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', 'alt-1');
    });

    it('should handle delete errors', async () => {
      const dbError = { code: 'PGRST116', message: 'Delete failed' };
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: dbError });

      await expect(bomAlternativeService.deleteAlternative('alt-1')).rejects.toEqual(dbError);
    });
  });

  describe('selectOptimalBOM', () => {
    it('should select optimal BOM using RPC', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: 'bom-2', error: null });

      const result = await bomAlternativeService.selectOptimalBOM('item-1', 100);

      expect(result).toBe('bom-2');
      expect(supabase.rpc).toHaveBeenCalledWith('select_optimal_bom', expect.objectContaining({
        p_item_id: 'item-1',
        p_quantity: 100,
        p_org_id: testOrgId,
      }));
    });

    it('should use provided order date', async () => {
      const orderDate = '2025-01-15';
      vi.mocked(supabase.rpc).mockResolvedValue({ data: 'bom-2', error: null });

      await bomAlternativeService.selectOptimalBOM('item-1', 100, orderDate);

      expect(supabase.rpc).toHaveBeenCalledWith('select_optimal_bom', expect.objectContaining({
        p_order_date: orderDate,
      }));
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomAlternativeService.selectOptimalBOM('item-1', 100)).rejects.toThrow('Organization ID not found');
    });

    it('should handle RPC errors', async () => {
      const rpcError = { code: 'PGRST116', message: 'RPC failed' };
      vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: rpcError });

      await expect(bomAlternativeService.selectOptimalBOM('item-1', 100)).rejects.toEqual(rpcError);
    });
  });

  describe('getSelectionRules', () => {
    it('should return selection rules', async () => {
      const mockRules = [
        {
          id: 'rule-1',
          org_id: testOrgId,
          rule_name: 'Cost-based selection',
          rule_type: 'COST',
          condition_json: { max_cost: 1000 },
          priority: 1,
          is_active: true,
        },
      ];

      mockSupabaseQuery.order.mockResolvedValue({ data: mockRules, error: null });

      const result = await bomAlternativeService.getSelectionRules();

      expect(result).toHaveLength(1);
      expect(result[0].rule_name).toBe('Cost-based selection');
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomAlternativeService.getSelectionRules()).rejects.toThrow('Organization ID not found');
    });

    it('should return empty array when no rules found', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null });

      const result = await bomAlternativeService.getSelectionRules();

      expect(result).toEqual([]);
    });
  });

  describe('addSelectionRule', () => {
    it('should add selection rule successfully', async () => {
      const newRule = {
        org_id: testOrgId,
        rule_name: 'Quantity-based selection',
        rule_type: 'QUANTITY',
        condition_json: { min_quantity: 100 },
        priority: 1,
        is_active: true,
      };

      mockSupabaseQuery.single.mockResolvedValue({ data: { id: 'rule-1' }, error: null });

      const result = await bomAlternativeService.addSelectionRule(newRule);

      expect(result).toBe('rule-1');
      expect(mockSupabaseQuery.insert).toHaveBeenCalled();
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      const newRule = {
        org_id: testOrgId,
        rule_name: 'Test rule',
        rule_type: 'QUANTITY',
        condition_json: {},
        priority: 1,
        is_active: true,
      };

      await expect(bomAlternativeService.addSelectionRule(newRule)).rejects.toThrow('Organization ID not found');
    });
  });

  describe('updateSelectionRule', () => {
    it('should update selection rule successfully', async () => {
      const updates = {
        priority: 2,
        is_active: false,
      };

      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: null });

      await bomAlternativeService.updateSelectionRule('rule-1', updates);

      expect(mockSupabaseQuery.update).toHaveBeenCalled();
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', 'rule-1');
    });

    it('should handle update errors', async () => {
      const dbError = { code: 'PGRST116', message: 'Update failed' };
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: dbError });

      await expect(
        bomAlternativeService.updateSelectionRule('rule-1', { priority: 2 })
      ).rejects.toEqual(dbError);
    });
  });
});
