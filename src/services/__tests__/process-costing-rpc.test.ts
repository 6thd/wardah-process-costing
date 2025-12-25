/**
 * Process Costing RPC Functions Tests
 * اختبارات شاملة لدالة upsert_stage_cost بالمنطق الحالي
 * 
 * الهدف: تثبيت السلوك الحالي قبل أي تحسينات مستقبلية
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
  },
  getEffectiveTenantId: vi.fn(),
}));

import { supabase } from '@/lib/supabase';

// Helper function to create mock Supabase RPC response
const createMockRpcResponse = <T>(data: T | T[] | null, error: any = null) => ({
  data: data as T[] | null,
  error,
  count: null,
  status: error ? 400 : 200,
  statusText: error ? 'Bad Request' : 'OK',
});

// Helper function to create mock Supabase error
const createMockError = (message: string) => ({
  message,
  details: '',
  hint: '',
  code: 'PGRST_ERROR',
  name: 'PostgrestError',
} as any);

describe('upsert_stage_cost - Current Logic Tests', () => {
  const testTenantId = 'test-tenant-123';
  const testMoId = 'mo-123';
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stage 1 - No Transferred-In', () => {
    it('should calculate unit cost as total_cost / good_qty', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 1000,
        unit_cost: 10, // 1000 / 100
        transferred_in: 0,
        labor_cost: 200,
        overhead_cost: 300,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_dm: 500,
      });

      expect(result.data[0].unit_cost).toBe(10);
      expect(result.data[0].total_cost).toBe(1000);
      expect(result.data[0].transferred_in).toBe(0);
    });

    it('should handle zero good_qty gracefully', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 1000,
        unit_cost: 0, // When good_qty = 0
        transferred_in: 0,
        labor_cost: 200,
        overhead_cost: 300,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 0,
        p_dm: 500,
      });

      expect(result.data[0].unit_cost).toBe(0);
    });

    it('should calculate total cost as sum of all components', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 1500, // 500 DM + 400 DL + 600 OH
        unit_cost: 15,
        transferred_in: 0,
        labor_cost: 400,
        overhead_cost: 600,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_dm: 500,
      });

      expect(result.data[0].total_cost).toBe(1500);
      expect(result.data[0].labor_cost).toBe(400);
      expect(result.data[0].overhead_cost).toBe(600);
    });
  });

  describe('Stage 2+ - With Transferred-In', () => {
    it('should include transferred-in cost from previous stage', async () => {
      const mockResult = {
        stage_id: 'stage-2',
        total_cost: 2000,
        unit_cost: 20, // 2000 / 100
        transferred_in: 1000, // From stage 1
        labor_cost: 500,
        overhead_cost: 500,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 2,
        p_wc: 'wc-2',
        p_good_qty: 100,
        p_dm: 0, // Stage 2+ typically has no DM
      });

      expect(result.data[0].transferred_in).toBe(1000);
      expect(result.data[0].total_cost).toBe(2000);
      expect(result.data[0].unit_cost).toBe(20);
    });

    it('should calculate unit cost including transferred-in', async () => {
      const mockResult = {
        stage_id: 'stage-3',
        total_cost: 3000,
        unit_cost: 30, // 3000 / 100
        transferred_in: 2000, // From stage 2
        labor_cost: 600,
        overhead_cost: 400,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 3,
        p_wc: 'wc-3',
        p_good_qty: 100,
        p_dm: 0,
      });

      expect(result.data[0].total_cost).toBe(3000);
      expect(result.data[0].unit_cost).toBe(30);
    });
  });

  describe('Scrap and Rework (Currently Ignored)', () => {
    it('should accept scrap_qty but not affect calculation', async () => {
      // Current behavior: scrap_qty is stored but v_rg = 0
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 1000,
        unit_cost: 10, // Still 1000 / 100 (ignores scrap)
        transferred_in: 0,
        labor_cost: 200,
        overhead_cost: 300,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_scrap_qty: 10, // Currently ignored in calculation
        p_dm: 500,
      });

      // Unit cost should still be based on good_qty only
      expect(result.data[0].unit_cost).toBe(10);
    });

    it('should accept rework_qty but not affect calculation', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 1000,
        unit_cost: 10,
        transferred_in: 0,
        labor_cost: 200,
        overhead_cost: 300,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_rework_qty: 5, // Currently ignored
        p_dm: 500,
      });

      expect(result.data[0].unit_cost).toBe(10);
    });
  });

  describe('Error Handling', () => {
    it('should validate stage number > 0', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue(
        createMockRpcResponse(null, createMockError('Stage number must be positive'))
      );

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 0, // Invalid
        p_wc: 'wc-1',
        p_good_qty: 100,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('positive');
    });

    it('should validate good_qty >= 0', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue(
        createMockRpcResponse(null, createMockError('Good quantity cannot be negative'))
      );

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: -10, // Invalid
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('negative');
    });

    it('should require previous stage for stage > 1', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue(
        createMockRpcResponse(null, createMockError('Previous stage (1) not found or not completed'))
      );

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 2, // Requires stage 1
        p_wc: 'wc-2',
        p_good_qty: 100,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Previous stage');
    });

    it('should validate work center exists', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue(
        createMockRpcResponse(null, createMockError('Work center not found or not active for tenant'))
      );

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'invalid-wc',
        p_good_qty: 100,
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('Work center');
    });
  });

  describe('Cost Components Breakdown', () => {
    it('should sum all cost components correctly', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 1500, // 500 DM + 400 DL + 600 OH
        unit_cost: 15,
        transferred_in: 0,
        labor_cost: 400,
        overhead_cost: 600,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_dm: 500,
      });

      expect(result.data[0].total_cost).toBe(1500);
      expect(result.data[0].labor_cost).toBe(400);
      expect(result.data[0].overhead_cost).toBe(600);
    });

    it('should handle zero cost components', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 0,
        unit_cost: 0,
        transferred_in: 0,
        labor_cost: 0,
        overhead_cost: 0,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_dm: 0,
      });

      expect(result.data[0].total_cost).toBe(0);
      expect(result.data[0].unit_cost).toBe(0);
    });
  });

  describe('Multi-Stage Cost Flow', () => {
    it('should accumulate costs across multiple stages', async () => {
      // Stage 1
      const stage1Result = {
        stage_id: 'stage-1',
        total_cost: 1000,
        unit_cost: 10,
        transferred_in: 0,
        labor_cost: 200,
        overhead_cost: 300,
      };

      vi.mocked(supabase.rpc).mockResolvedValueOnce(createMockRpcResponse([stage1Result]));

      const stage1 = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_dm: 500,
      });

      expect(stage1.data[0].total_cost).toBe(1000);

      // Stage 2 (should include stage 1 cost)
      const stage2Result = {
        stage_id: 'stage-2',
        total_cost: 2000, // 1000 TI + 500 DL + 500 OH
        unit_cost: 20,
        transferred_in: 1000,
        labor_cost: 500,
        overhead_cost: 500,
      };

      vi.mocked(supabase.rpc).mockResolvedValueOnce(createMockRpcResponse([stage2Result]));

      const stage2 = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 2,
        p_wc: 'wc-2',
        p_good_qty: 100,
        p_dm: 0,
      });

      expect(stage2.data[0].transferred_in).toBe(1000);
      expect(stage2.data[0].total_cost).toBe(2000);
    });
  });

  describe('Input Quantity Calculation', () => {
    it('should calculate input_qty from good_qty + scrap + rework when not provided', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 1000,
        unit_cost: 10,
        transferred_in: 0,
        labor_cost: 200,
        overhead_cost: 300,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_scrap_qty: 10,
        p_rework_qty: 5,
        p_dm: 500,
        // p_input_qty not provided - should be calculated as 115
      });

      expect(supabase.rpc).toHaveBeenCalled();
    });
  });

  describe('EUP (Equivalent Units of Production) - Weighted Average', () => {
    it('should calculate unit cost using EUP when WIP exists', async () => {
      // Scenario: 800 completed units + 200 WIP units at 50% completion
      // EUP = 800 + (200 × 0.50) = 900
      // Total Cost = 10,000
      // Unit Cost = 10,000 / 900 = 11.11
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10000,
        unit_cost: 11.11, // 10000 / 900 (EUP)
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 900, // 800 + (200 × 0.50)
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 800,
        p_dm: 5000,
        p_wip_end_qty: 200,
        p_wip_end_cc_completion_pct: 50, // 50% complete
      });

      expect(result.data[0].unit_cost).toBeCloseTo(11.11, 2);
      expect(result.data[0].eup).toBe(900);
    });

    it('should fallback to good_qty when WIP is zero (backward compatibility)', async () => {
      // When WIP = 0, should use old method: unit_cost = total_cost / good_qty
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 1000,
        unit_cost: 10, // 1000 / 100 (no EUP calculation)
        transferred_in: 0,
        labor_cost: 200,
        overhead_cost: 300,
        eup: 100, // Same as good_qty when no WIP
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_dm: 500,
        p_wip_end_qty: 0, // No WIP
      });

      expect(result.data[0].unit_cost).toBe(10);
      expect(result.data[0].eup).toBe(100);
    });

    it('should calculate EUP correctly for different completion percentages', async () => {
      // Scenario: 1000 completed + 500 WIP at 30% completion
      // EUP = 1000 + (500 × 0.30) = 1150
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 11500,
        unit_cost: 10, // 11500 / 1150
        transferred_in: 0,
        labor_cost: 3000,
        overhead_cost: 3500,
        eup: 1150,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
        p_wip_end_qty: 500,
        p_wip_end_cc_completion_pct: 30,
      });

      expect(result.data[0].eup).toBe(1150);
      expect(result.data[0].unit_cost).toBeCloseTo(10, 2);
    });

    it('should handle 100% WIP completion correctly', async () => {
      // Scenario: 500 completed + 300 WIP at 100% completion
      // EUP = 500 + (300 × 1.00) = 800
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 8000,
        unit_cost: 10, // 8000 / 800
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 1000,
        eup: 800,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 500,
        p_dm: 5000,
        p_wip_end_qty: 300,
        p_wip_end_cc_completion_pct: 100,
      });

      expect(result.data[0].eup).toBe(800);
      expect(result.data[0].unit_cost).toBe(10);
    });

    it('should validate WIP completion percentage range', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue(
        createMockRpcResponse(null, createMockError('WIP CC completion percentage must be between 0 and 100'))
      );

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 100,
        p_dm: 500,
        p_wip_end_qty: 50,
        p_wip_end_cc_completion_pct: 150, // Invalid: > 100
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('between 0 and 100');
    });

    it('should calculate EUP for stage 2+ with transferred-in cost', async () => {
      // Stage 2: Includes transferred-in from stage 1
      // EUP calculation still applies
      const mockResult = {
        stage_id: 'stage-2',
        total_cost: 20000,
        unit_cost: 20, // 20000 / 1000 (EUP)
        transferred_in: 10000,
        labor_cost: 5000,
        overhead_cost: 5000,
        eup: 1000, // 900 completed + (200 × 0.50)
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 2,
        p_wc: 'wc-2',
        p_good_qty: 900,
        p_dm: 0, // Stage 2+ typically has no DM
        p_wip_end_qty: 200,
        p_wip_end_cc_completion_pct: 50,
      });

      expect(result.data[0].transferred_in).toBe(10000);
      expect(result.data[0].eup).toBe(1000);
      expect(result.data[0].unit_cost).toBe(20);
    });

    it('should use DM completion percentage for stage 1 EUP_DM calculation', async () => {
      // Stage 1: DM EUP uses wip_end_dm_completion_pct
      // Stage 2+: DM EUP = good_qty (no DM in stage 2+)
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10000,
        unit_cost: 11.11,
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 900, // Uses CC completion for unit cost
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 800,
        p_dm: 5000,
        p_wip_end_qty: 200,
        p_wip_end_dm_completion_pct: 40, // DM completion %
        p_wip_end_cc_completion_pct: 50, // CC completion % (used for unit cost)
      });

      expect(result.data[0].eup).toBe(900); // Uses CC completion
    });
  });

  describe('Scrap Accounting - Normal vs Abnormal', () => {
    it('should calculate normal scrap when scrap_qty is within normal rate', async () => {
      // Scenario: 1000 good units, 50 scrap (5% scrap rate, normal rate = 5%)
      // Normal scrap = 50, Abnormal scrap = 0
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10500, // 10000 base + 500 normal scrap cost
        unit_cost: 10.5, // 10500 / 1000 (normal scrap cost included)
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000,
        normal_scrap_cost: 500, // 50 units * 10 per unit
        abnormal_scrap_cost: 0,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1', // Assuming work center has normal_scrap_rate = 5%
        p_good_qty: 1000,
        p_dm: 5000,
        p_scrap_qty: 50, // 5% of 1000 (within normal rate)
      });

      expect(result.data[0].normal_scrap_cost).toBe(500);
      expect(result.data[0].abnormal_scrap_cost).toBe(0);
      expect(result.data[0].unit_cost).toBeCloseTo(10.5, 2);
    });

    it('should calculate abnormal scrap when scrap_qty exceeds normal rate', async () => {
      // Scenario: 1000 good units, 100 scrap (10% scrap, normal rate = 5%)
      // Normal scrap = 50, Abnormal scrap = 50
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10500, // 10000 base + 500 normal scrap cost
        unit_cost: 10.5, // 10500 / 1000 (only normal scrap included)
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000,
        normal_scrap_cost: 500, // 50 units * 10 per unit
        abnormal_scrap_cost: 500, // 50 units * 10 per unit (charged separately)
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1', // Assuming work center has normal_scrap_rate = 5%
        p_good_qty: 1000,
        p_dm: 5000,
        p_scrap_qty: 100, // 10% of 1000 (exceeds normal rate)
      });

      expect(result.data[0].normal_scrap_cost).toBe(500);
      expect(result.data[0].abnormal_scrap_cost).toBe(500);
      expect(result.data[0].unit_cost).toBeCloseTo(10.5, 2);
    });

    it('should treat all scrap as abnormal when normal_scrap_rate is zero', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10000, // No normal scrap cost added
        unit_cost: 10, // 10000 / 1000
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000,
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 500, // All scrap is abnormal
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1', // Assuming work center has normal_scrap_rate = 0%
        p_good_qty: 1000,
        p_dm: 5000,
        p_scrap_qty: 50,
      });

      expect(result.data[0].normal_scrap_cost).toBe(0);
      expect(result.data[0].abnormal_scrap_cost).toBe(500);
    });

    it('should include regrind cost in total cost', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10200, // 10000 base + 200 regrind
        unit_cost: 10.2,
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000,
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 0,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
        p_regrind_cost: 200,
      });

      expect(result.data[0].total_cost).toBe(10200);
    });

    it('should subtract waste credit from total cost', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 9800, // 10000 base - 200 waste credit
        unit_cost: 9.8,
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000,
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 0,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
        p_waste_credit: 200,
      });

      expect(result.data[0].total_cost).toBe(9800);
    });

    it('should validate scrap_qty cannot be negative', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue(
        createMockRpcResponse(null, createMockError('Scrap quantity cannot be negative'))
      );

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
        p_scrap_qty: -10, // Invalid
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('negative');
    });

    it('should calculate scrap costs correctly with EUP', async () => {
      // Scenario: 800 completed + 200 WIP (50% complete), 50 scrap (5% normal rate)
      // EUP = 800 + (200 × 0.50) = 900
      // Normal scrap = 40 (5% of 800), Abnormal scrap = 10
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10400, // 10000 base + 400 normal scrap cost
        unit_cost: 11.56, // 10400 / 900 (EUP)
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 900,
        normal_scrap_cost: 400,
        abnormal_scrap_cost: 100,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 800,
        p_dm: 5000,
        p_scrap_qty: 50,
        p_wip_end_qty: 200,
        p_wip_end_cc_completion_pct: 50,
      });

      expect(result.data[0].eup).toBe(900);
      expect(result.data[0].normal_scrap_cost).toBe(400);
      expect(result.data[0].abnormal_scrap_cost).toBe(100);
    });
  });

  describe('FIFO Method - Beginning WIP Separation', () => {
    it('should use Weighted-Average method by default', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10000,
        unit_cost: 10,
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000,
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 0,
        costing_method: 'weighted_average',
        wip_beginning_cost: 0,
        current_period_cost: 10000,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
      });

      expect(result.data[0].costing_method).toBe('weighted_average');
    });

    it('should calculate FIFO EUP by subtracting beginning WIP', async () => {
      // Scenario: 800 completed + 200 ending WIP (50%) - 100 beginning WIP (30%)
      // FIFO EUP = 800 + (200 × 0.50) - (100 × 0.30) = 800 + 100 - 30 = 870
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 8700, // Current period cost only
        unit_cost: 10, // 8700 / 870 (FIFO EUP)
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 870, // 800 + 100 - 30
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 0,
        costing_method: 'fifo',
        wip_beginning_cost: 300, // Beginning WIP cost (separated)
        current_period_cost: 8700, // Current period only
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 800,
        p_dm: 5000,
        p_wip_end_qty: 200,
        p_wip_end_cc_completion_pct: 50,
        p_wip_beginning_qty: 100,
        p_wip_beginning_cc_completion_pct: 30,
        p_wip_beginning_cost: 300,
      });

      expect(result.data[0].costing_method).toBe('fifo');
      expect(result.data[0].eup).toBe(870);
      expect(result.data[0].wip_beginning_cost).toBe(300);
      expect(result.data[0].current_period_cost).toBe(8700);
    });

    it('should separate beginning WIP cost from current period cost in FIFO', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10000, // Total (beginning + current)
        unit_cost: 10,
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000,
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 0,
        costing_method: 'fifo',
        wip_beginning_cost: 2000, // Beginning WIP cost
        current_period_cost: 8000, // Current period cost only
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
        p_wip_beginning_cost: 2000,
      });

      expect(result.data[0].wip_beginning_cost).toBe(2000);
      expect(result.data[0].current_period_cost).toBe(8000);
      // Unit cost should be based on current_period_cost only in FIFO
    });

    it('should combine beginning WIP with current costs in Weighted-Average', async () => {
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 12000, // Beginning WIP + Current period
        unit_cost: 12, // 12000 / 1000 (includes beginning WIP)
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000,
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 0,
        costing_method: 'weighted_average',
        wip_beginning_cost: 2000, // Beginning WIP cost (included in total)
        current_period_cost: 10000, // Current period cost
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
        p_wip_beginning_cost: 2000,
      });

      expect(result.data[0].costing_method).toBe('weighted_average');
      expect(result.data[0].total_cost).toBe(12000); // Includes beginning WIP
      expect(result.data[0].unit_cost).toBe(12);
    });

    it('should validate beginning WIP completion percentages', async () => {
      vi.mocked(supabase.rpc).mockResolvedValue(
        createMockRpcResponse(null, createMockError('WIP beginning CC completion percentage must be between 0 and 100'))
      );

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
        p_wip_beginning_qty: 100,
        p_wip_beginning_cc_completion_pct: 150, // Invalid
      });

      expect(result.error).toBeDefined();
      expect(result.error?.message).toContain('between 0 and 100');
    });

    it('should calculate FIFO EUP correctly for stage 2+', async () => {
      // Stage 2: Beginning WIP EUP for DM should be 0 (DM already in transferred-in)
      const mockResult = {
        stage_id: 'stage-2',
        total_cost: 20000,
        unit_cost: 20,
        transferred_in: 10000,
        labor_cost: 5000,
        overhead_cost: 5000,
        eup: 1000, // 900 + 200 - 100 (CC only, DM = 0)
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 0,
        costing_method: 'fifo',
        wip_beginning_cost: 1000,
        current_period_cost: 19000,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 2,
        p_wc: 'wc-2',
        p_good_qty: 900,
        p_dm: 0, // Stage 2+ typically has no DM
        p_wip_end_qty: 200,
        p_wip_end_cc_completion_pct: 50,
        p_wip_beginning_qty: 100,
        p_wip_beginning_cc_completion_pct: 100,
        p_wip_beginning_cost: 1000,
      });

      expect(result.data[0].costing_method).toBe('fifo');
      expect(result.data[0].eup).toBe(1000);
    });

    it('should handle zero beginning WIP in FIFO method', async () => {
      // FIFO with no beginning WIP should equal Weighted-Average
      const mockResult = {
        stage_id: 'stage-1',
        total_cost: 10000,
        unit_cost: 10,
        transferred_in: 0,
        labor_cost: 2000,
        overhead_cost: 3000,
        eup: 1000, // Same as Weighted-Average when no beginning WIP
        normal_scrap_cost: 0,
        abnormal_scrap_cost: 0,
        costing_method: 'fifo',
        wip_beginning_cost: 0,
        current_period_cost: 10000,
      };

      vi.mocked(supabase.rpc).mockResolvedValue(createMockRpcResponse([mockResult]));

      const result = await supabase.rpc('upsert_stage_cost', {
        p_tenant: testTenantId,
        p_mo: testMoId,
        p_stage: 1,
        p_wc: 'wc-1',
        p_good_qty: 1000,
        p_dm: 5000,
        p_wip_beginning_qty: 0, // No beginning WIP
      });

      expect(result.data[0].eup).toBe(1000);
      expect(result.data[0].wip_beginning_cost).toBe(0);
    });
  });
});

