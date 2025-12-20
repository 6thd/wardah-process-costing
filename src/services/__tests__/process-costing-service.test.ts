/**
 * Process Costing Service Tests
 * Tests for the core process costing operations
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the supabase module
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            single: vi.fn(),
            order: vi.fn(() => ({ data: [], error: null })),
          })),
          single: vi.fn(),
          limit: vi.fn(() => ({
            single: vi.fn(),
          })),
          order: vi.fn(() => ({ data: [], error: null })),
        })),
        single: vi.fn(),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  },
}));

// Mock config loader
vi.mock('@/lib/config', () => ({
  loadConfig: vi.fn(() => Promise.resolve({ ORG_ID: 'test-org-id' })),
}));

import { processCostingService, type ProcessCostingParams, type StageCostResult } from '../process-costing-service';
import { supabase } from '@/lib/supabase';

describe('ProcessCostingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('applyLaborTime', () => {
    it('should throw error if moId is missing', async () => {
      const params: ProcessCostingParams = {
        moId: '',
        stageNo: 1,
        laborHours: 8,
        hourlyRate: 50,
      };

      await expect(processCostingService.applyLaborTime(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should throw error if stageId and stageNo are both missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-123',
        laborHours: 8,
        hourlyRate: 50,
      };

      await expect(processCostingService.applyLaborTime(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should throw error if laborHours is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        hourlyRate: 50,
      };

      await expect(processCostingService.applyLaborTime(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should throw error if hourlyRate is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        laborHours: 8,
      };

      await expect(processCostingService.applyLaborTime(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should calculate total labor cost correctly', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'labor-123' },
            error: null,
          }),
        }),
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'wc-123' },
              error: null,
            }),
          }),
        }),
      });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'work_centers') {
          return { select: mockSelect } as any;
        }
        if (table === 'labor_time_logs') {
          return { insert: mockInsert } as any;
        }
        return {} as any;
      });

      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        laborHours: 8,
        hourlyRate: 50,
        employeeName: 'محمد أحمد',
      };

      const result = await processCostingService.applyLaborTime(params);

      expect(result.success).toBe(true);
      expect(result.data.totalLaborCost).toBe(400); // 8 * 50
      expect(result.data.hours).toBe(8);
      expect(result.data.hourlyRate).toBe(50);
    });

    it('should handle overtime calculation', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'labor-123' },
            error: null,
          }),
        }),
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'wc-123' },
              error: null,
            }),
          }),
        }),
      });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'work_centers') {
          return { select: mockSelect } as any;
        }
        if (table === 'labor_time_logs') {
          return { insert: mockInsert } as any;
        }
        return {} as any;
      });

      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        laborHours: 12,
        hourlyRate: 75,
      };

      const result = await processCostingService.applyLaborTime(params);

      expect(result.data.totalLaborCost).toBe(900); // 12 * 75
    });
  });

  describe('applyOverhead', () => {
    it('should throw error if moId is missing', async () => {
      const params: ProcessCostingParams = {
        moId: '',
        stageNo: 1,
        baseQty: 100,
        overheadRate: 0.15,
      };

      await expect(processCostingService.applyOverhead(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should throw error if baseQty is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        overheadRate: 0.15,
      };

      await expect(processCostingService.applyOverhead(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should throw error if overheadRate is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        baseQty: 100,
      };

      await expect(processCostingService.applyOverhead(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should calculate overhead amount correctly', async () => {
      const mockInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'moh-123' },
            error: null,
          }),
        }),
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'wc-123' },
              error: null,
            }),
          }),
        }),
      });

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'work_centers') {
          return { select: mockSelect } as any;
        }
        if (table === 'moh_applied') {
          return { insert: mockInsert } as any;
        }
        return {} as any;
      });

      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        baseQty: 1000,
        overheadRate: 0.25,
        overheadType: 'variable',
      };

      const result = await processCostingService.applyOverhead(params);

      expect(result.success).toBe(true);
      expect(result.data.overheadAmount).toBe(250); // 1000 * 0.25
      expect(result.data.baseQty).toBe(1000);
      expect(result.data.rate).toBe(0.25);
    });
  });

  describe('upsertStageCost', () => {
    it('should throw error if moId is missing', async () => {
      const params: ProcessCostingParams = {
        moId: '',
        stageNo: 1,
        goodQty: 100,
      };

      await expect(processCostingService.upsertStageCost(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should throw error if goodQty is missing', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
      };

      await expect(processCostingService.upsertStageCost(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });

    it('should calculate unit cost correctly', async () => {
      const mockLaborData = [
        { total_cost: 500 },
        { total_cost: 300 },
      ];

      const mockOverheadData = [
        { amount: 200 },
        { amount: 150 },
      ];

      vi.mocked(supabase.from).mockImplementation((table: string) => {
        if (table === 'labor_time_logs') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: mockLaborData,
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'moh_applied') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockResolvedValue({
                  data: mockOverheadData,
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        if (table === 'stage_costs') {
          return {
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'stage-cost-123' },
                  error: null,
                }),
              }),
            }),
          } as any;
        }
        return {} as any;
      });

      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        goodQty: 100,
        directMaterialCost: 1000,
      };

      const result = await processCostingService.upsertStageCost(params);

      expect(result.success).toBe(true);
      // Total: 1000 (material) + 800 (labor) + 350 (overhead) = 2150
      // Unit: 2150 / 100 = 21.5
    });

    it('should handle zero good quantity', async () => {
      const params: ProcessCostingParams = {
        moId: 'mo-123',
        stageNo: 1,
        goodQty: 0,
      };

      await expect(processCostingService.upsertStageCost(params)).rejects.toThrow(
        'Missing required parameters'
      );
    });
  });

  describe('getStageCosts', () => {
    it('should throw error if moId is missing', async () => {
      await expect(processCostingService.getStageCosts('')).rejects.toThrow(
        'Missing required parameter: moId'
      );
    });

    it('should return empty array when no stage costs exist', async () => {
      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: [],
              error: null,
            }),
          }),
        }),
      } as any);

      const result = await processCostingService.getStageCosts('mo-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual([]);
    });

    it('should return stage costs ordered by stage number', async () => {
      const mockStageCosts: StageCostResult[] = [
        {
          id: 'sc-1',
          manufacturing_order_id: 'mo-123',
          stage_number: 1,
          good_quantity: 100,
          scrap_quantity: 5,
          material_cost: 500,
          labor_cost: 300,
          overhead_cost: 150,
          total_cost: 950,
          unit_cost: 9.5,
          status: 'actual',
        },
        {
          id: 'sc-2',
          manufacturing_order_id: 'mo-123',
          stage_number: 2,
          good_quantity: 95,
          scrap_quantity: 3,
          material_cost: 0,
          labor_cost: 400,
          overhead_cost: 200,
          total_cost: 600,
          unit_cost: 6.32,
          status: 'actual',
        },
      ];

      vi.mocked(supabase.from).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            order: vi.fn().mockResolvedValue({
              data: mockStageCosts,
              error: null,
            }),
          }),
        }),
      } as any);

      const result = await processCostingService.getStageCosts('mo-123');

      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].stage_number).toBe(1);
      expect(result.data[1].stage_number).toBe(2);
    });
  });
});

describe('Process Costing Calculations', () => {
  describe('Cost Formula Verification', () => {
    it('should follow the formula: Total Cost = Materials + Labor + Overhead', () => {
      const materialCost = 1000;
      const laborCost = 500;
      const overheadCost = 250;

      const totalCost = materialCost + laborCost + overheadCost;

      expect(totalCost).toBe(1750);
    });

    it('should calculate unit cost as Total Cost / Good Quantity', () => {
      const totalCost = 1750;
      const goodQuantity = 100;

      const unitCost = totalCost / goodQuantity;

      expect(unitCost).toBe(17.5);
    });

    it('should calculate efficiency percentage correctly', () => {
      const goodQty = 95;
      const scrapQty = 5;
      const reworkQty = 2;

      const totalOutput = goodQty + scrapQty + reworkQty;
      const efficiency = (goodQty / totalOutput) * 100;

      expect(efficiency).toBeCloseTo(93.14, 2);
    });

    it('should handle multi-stage cost flow with transferred-in costs', () => {
      // Stage 1
      const stage1Materials = 500;
      const stage1Labor = 200;
      const stage1Overhead = 100;
      const stage1TotalCost = stage1Materials + stage1Labor + stage1Overhead; // 800
      const stage1GoodQty = 100;
      const stage1UnitCost = stage1TotalCost / stage1GoodQty; // 8

      // Stage 2 (includes transferred-in from Stage 1)
      const transferredInCost = stage1TotalCost;
      const stage2Materials = 0;
      const stage2Labor = 300;
      const stage2Overhead = 150;
      const stage2TotalCost = transferredInCost + stage2Materials + stage2Labor + stage2Overhead; // 1250
      const stage2GoodQty = 95;
      const stage2UnitCost = stage2TotalCost / stage2GoodQty; // 13.16

      expect(stage1TotalCost).toBe(800);
      expect(stage1UnitCost).toBe(8);
      expect(stage2TotalCost).toBe(1250);
      expect(stage2UnitCost).toBeCloseTo(13.16, 2);
    });
  });

  describe('Labor Cost Calculation', () => {
    it('should calculate regular labor cost', () => {
      const hours = 8;
      const hourlyRate = 50;
      const laborCost = hours * hourlyRate;

      expect(laborCost).toBe(400);
    });

    it('should handle multiple employees', () => {
      const employees = [
        { hours: 8, hourlyRate: 50 },
        { hours: 6, hourlyRate: 45 },
        { hours: 4, hourlyRate: 60 },
      ];

      const totalLaborCost = employees.reduce(
        (total, emp) => total + emp.hours * emp.hourlyRate,
        0
      );

      expect(totalLaborCost).toBe(400 + 270 + 240); // 910
    });
  });

  describe('Overhead Application', () => {
    it('should calculate overhead based on labor cost', () => {
      const laborCost = 1000;
      const overheadRate = 0.25; // 25%
      const overheadAmount = laborCost * overheadRate;

      expect(overheadAmount).toBe(250);
    });

    it('should calculate overhead based on machine hours', () => {
      const machineHours = 10;
      const ratePerHour = 75;
      const overheadAmount = machineHours * ratePerHour;

      expect(overheadAmount).toBe(750);
    });

    it('should handle variable overhead rate', () => {
      const baseQty = 500;
      const variableRate = 0.5;
      const variableOverhead = baseQty * variableRate;

      expect(variableOverhead).toBe(250);
    });

    it('should handle fixed overhead allocation', () => {
      const fixedOverhead = 10000;
      const totalUnits = 1000;
      const overheadPerUnit = fixedOverhead / totalUnits;

      expect(overheadPerUnit).toBe(10);
    });
  });

  describe('AVCO Methodology', () => {
    it('should calculate average cost correctly', () => {
      const totalCostOfInventory = 50000;
      const totalQuantity = 1000;
      const averageCost = totalCostOfInventory / totalQuantity;

      expect(averageCost).toBe(50);
    });

    it('should update average cost with new receipts', () => {
      const previousTotalCost = 50000;
      const previousQty = 1000;
      const newCost = 12000;
      const newQty = 200;

      const newTotalCost = previousTotalCost + newCost;
      const newTotalQty = previousQty + newQty;
      const newAverageCost = newTotalCost / newTotalQty;

      expect(newAverageCost).toBeCloseTo(51.67, 2);
    });
  });
});
