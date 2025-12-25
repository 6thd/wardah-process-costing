/**
 * BOM Costing Service Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
const mockSupabaseQuery = {
  select: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  update: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  single: vi.fn().mockReturnThis(),
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => mockSupabaseQuery),
    rpc: vi.fn(),
  },
  getEffectiveTenantId: vi.fn(),
}));

import { bomCostingService } from '../bomCostingService';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

describe('bomCostingService', () => {
  const testOrgId = 'test-org-123';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEffectiveTenantId).mockResolvedValue(testOrgId);
    vi.mocked(supabase.rpc).mockResolvedValue({ data: [{ material_cost: 100, labor_cost: 50, overhead_cost: 25, total_cost: 175, unit_cost: 175 }], error: null });
    
    // Reset all mock implementations
    Object.keys(mockSupabaseQuery).forEach(key => {
      (mockSupabaseQuery as any)[key].mockReturnThis();
    });
  });

  describe('calculateStandardCost', () => {
    it('should calculate standard cost successfully', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({
        data: [{
          material_cost: 100,
          labor_cost: 50,
          overhead_cost: 25,
          total_cost: 175,
          unit_cost: 175
        }],
        error: null
      });

      const result = await bomCostingService.calculateStandardCost('bom-1', 1);

      expect(result.material_cost).toBe(100);
      expect(result.labor_cost).toBe(50);
      expect(result.overhead_cost).toBe(25);
      expect(result.total_cost).toBe(175);
      expect(result.unit_cost).toBe(175);
    });

    it('should use default quantity of 1', async () => {
      await bomCostingService.calculateStandardCost('bom-1');

      expect(supabase.rpc).toHaveBeenCalledWith('calculate_bom_standard_cost', expect.objectContaining({
        p_quantity: 1,
      }));
    });

    it('should use provided quantity', async () => {
      await bomCostingService.calculateStandardCost('bom-1', 10);

      expect(supabase.rpc).toHaveBeenCalledWith('calculate_bom_standard_cost', expect.objectContaining({
        p_quantity: 10,
      }));
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomCostingService.calculateStandardCost('bom-1')).rejects.toThrow('Organization ID not found');
    });

    it('should return zero values when RPC returns empty', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null });

      const result = await bomCostingService.calculateStandardCost('bom-1');

      expect(result.material_cost).toBe(0);
      expect(result.labor_cost).toBe(0);
      expect(result.total_cost).toBe(0);
    });

    it('should handle RPC errors', async () => {
      const rpcError = { code: 'PGRST116', message: 'RPC failed' };
      vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: rpcError });

      await expect(bomCostingService.calculateStandardCost('bom-1')).rejects.toEqual(rpcError);
    });
  });

  describe('compareCosts', () => {
    it('should compare costs successfully', async () => {
      const mockComparison = [
        {
          cost_type: 'material',
          standard_cost: 100,
          actual_cost: 110,
          variance: 10,
          variance_pct: 10,
        },
        {
          cost_type: 'labor',
          standard_cost: 50,
          actual_cost: 45,
          variance: -5,
          variance_pct: -10,
        },
      ];

      vi.mocked(supabase.rpc).mockResolvedValue({ data: mockComparison, error: null });

      const result = await bomCostingService.compareCosts('bom-1', 1);

      expect(result).toHaveLength(2);
      expect(result[0].cost_type).toBe('material');
      expect(result[0].variance).toBe(10);
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomCostingService.compareCosts('bom-1')).rejects.toThrow('Organization ID not found');
    });

    it('should return empty array when no comparison data', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue({ data: [], error: null });

      const result = await bomCostingService.compareCosts('bom-1');

      expect(result).toEqual([]);
    });
  });

  describe('createCostAnalysis', () => {
    it('should create cost analysis successfully', async () => {
      const newAnalysis = {
        bom_id: 'bom-1',
        analysis_date: '2025-01-15',
        quantity: 100,
        standard_material_cost: 10000,
        standard_labor_cost: 5000,
        standard_overhead_cost: 2500,
        standard_total_cost: 17500,
        standard_unit_cost: 175,
        actual_material_cost: 11000,
        actual_labor_cost: 4500,
        actual_overhead_cost: 2500,
        actual_total_cost: 18000,
        actual_unit_cost: 180,
        material_variance: 1000,
        labor_variance: -500,
        overhead_variance: 0,
        total_variance: 500,
        material_variance_pct: 10,
        labor_variance_pct: -10,
        status: 'DRAFT' as const,
      };

      mockSupabaseQuery.single.mockResolvedValue({ data: { id: 'analysis-1' }, error: null });

      const result = await bomCostingService.createCostAnalysis(newAnalysis);

      expect(result).toBe('analysis-1');
      expect(mockSupabaseQuery.insert).toHaveBeenCalled();
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      const newAnalysis = {
        bom_id: 'bom-1',
        analysis_date: '2025-01-15',
        quantity: 100,
        standard_material_cost: 10000,
        standard_labor_cost: 5000,
        standard_overhead_cost: 2500,
        standard_total_cost: 17500,
        standard_unit_cost: 175,
        actual_material_cost: 11000,
        actual_labor_cost: 4500,
        actual_overhead_cost: 2500,
        actual_total_cost: 18000,
        actual_unit_cost: 180,
        material_variance: 1000,
        labor_variance: -500,
        overhead_variance: 0,
        total_variance: 500,
        material_variance_pct: 10,
        labor_variance_pct: -10,
        status: 'DRAFT' as const,
      };

      await expect(bomCostingService.createCostAnalysis(newAnalysis)).rejects.toThrow('Organization ID not found');
    });

    it('should handle insert errors', async () => {
      const dbError = { code: '23505', message: 'Duplicate key' };
      mockSupabaseQuery.single.mockResolvedValue({ data: null, error: dbError });

      const newAnalysis = {
        bom_id: 'bom-1',
        analysis_date: '2025-01-15',
        quantity: 100,
        standard_material_cost: 10000,
        standard_labor_cost: 5000,
        standard_overhead_cost: 2500,
        standard_total_cost: 17500,
        standard_unit_cost: 175,
        actual_material_cost: 11000,
        actual_labor_cost: 4500,
        actual_overhead_cost: 2500,
        actual_total_cost: 18000,
        actual_unit_cost: 180,
        material_variance: 1000,
        labor_variance: -500,
        overhead_variance: 0,
        total_variance: 500,
        material_variance_pct: 10,
        labor_variance_pct: -10,
        status: 'DRAFT' as const,
      };

      await expect(bomCostingService.createCostAnalysis(newAnalysis)).rejects.toEqual(dbError);
    });
  });

  describe('getCostAnalyses', () => {
    it('should get cost analyses successfully', async () => {
      const mockAnalyses = [
        {
          id: 'analysis-1',
          bom_id: 'bom-1',
          analysis_date: '2025-01-15',
          quantity: 100,
          standard_total_cost: 17500,
          actual_total_cost: 18000,
          status: 'DRAFT',
          org_id: testOrgId,
        },
      ];

      mockSupabaseQuery.limit.mockResolvedValue({ data: mockAnalyses, error: null });

      const result = await bomCostingService.getCostAnalyses('bom-1', 10);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('analysis-1');
    });

    it('should use default limit of 10', async () => {
      mockSupabaseQuery.limit.mockResolvedValue({ data: [], error: null });

      await bomCostingService.getCostAnalyses('bom-1');

      expect(mockSupabaseQuery.limit).toHaveBeenCalledWith(10);
    });

    it('should throw error when orgId is not found', async () => {
      vi.mocked(getEffectiveTenantId).mockResolvedValue(null);

      await expect(bomCostingService.getCostAnalyses('bom-1')).rejects.toThrow('Organization ID not found');
    });

    it('should return empty array when no analyses found', async () => {
      mockSupabaseQuery.limit.mockResolvedValue({ data: [], error: null });

      const result = await bomCostingService.getCostAnalyses('bom-1');

      expect(result).toEqual([]);
    });
  });

  describe('getCostDetails', () => {
    it('should get cost details successfully', async () => {
      const mockDetails = [
        {
          id: 'detail-1',
          cost_analysis_id: 'analysis-1',
          item_id: 'item-1',
          level_number: 1,
          quantity_required: 10,
          standard_unit_cost: 10,
          standard_total_cost: 100,
          actual_unit_cost: 11,
          actual_total_cost: 110,
          variance: 10,
          variance_pct: 10,
        },
      ];

      mockSupabaseQuery.order.mockResolvedValue({ data: mockDetails, error: null });

      const result = await bomCostingService.getCostDetails('analysis-1');

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('detail-1');
    });

    it('should return empty array when no details found', async () => {
      mockSupabaseQuery.order.mockResolvedValue({ data: [], error: null });

      const result = await bomCostingService.getCostDetails('analysis-1');

      expect(result).toEqual([]);
    });

    it('should handle database errors', async () => {
      const dbError = { code: 'PGRST116', message: 'Database error' };
      mockSupabaseQuery.order.mockResolvedValue({ data: null, error: dbError });

      await expect(bomCostingService.getCostDetails('analysis-1')).rejects.toEqual(dbError);
    });
  });

  describe('updateCostAnalysis', () => {
    it('should update cost analysis successfully', async () => {
      const updates = {
        status: 'APPROVED' as const,
        notes: 'Approved by manager',
      };

      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: null });

      await bomCostingService.updateCostAnalysis('analysis-1', updates);

      expect(mockSupabaseQuery.update).toHaveBeenCalled();
      expect(mockSupabaseQuery.eq).toHaveBeenCalledWith('id', 'analysis-1');
    });

    it('should handle update errors', async () => {
      const dbError = { code: 'PGRST116', message: 'Update failed' };
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: dbError });

      await expect(
        bomCostingService.updateCostAnalysis('analysis-1', { status: 'APPROVED' })
      ).rejects.toEqual(dbError);
    });
  });

  describe('approveCostAnalysis', () => {
    it('should approve cost analysis', async () => {
      mockSupabaseQuery.eq.mockResolvedValue({ data: null, error: null });

      await bomCostingService.approveCostAnalysis('analysis-1');

      expect(mockSupabaseQuery.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'APPROVED' })
      );
    });
  });
});

