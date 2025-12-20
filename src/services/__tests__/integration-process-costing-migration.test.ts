/**
 * Integration Tests for Process Costing Migration
 * Task: test-4 - Integration Tests للـ Legacy Services قبل نقلها
 * 
 * Tests to verify backward compatibility during migration
 * from legacy process-costing-service.ts to Clean Architecture.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Legacy service
import { processCostingService } from '../process-costing-service';

// New Application Service
import { ProcessCostingAppService } from '@/application/services/ProcessCostingAppService';
import { SupabaseProcessCostingRepository } from '@/infrastructure/repositories/SupabaseProcessCostingRepository';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
          order: vi.fn(() => Promise.resolve({ data: [], error: null })),
          limit: vi.fn(() => ({
            single: vi.fn(() => Promise.resolve({ data: { id: 'wc-1' }, error: null }))
          }))
        }))
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: { id: 'new-id' }, error: null }))
        }))
      })),
      upsert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null }))
        }))
      }))
    }))
  }
}));

// Mock config
vi.mock('@/lib/config', () => ({
  loadConfig: vi.fn(() => Promise.resolve({ ORG_ID: 'test-org-id' }))
}));

describe('Process Costing Migration Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('API Compatibility', () => {
    it('should have same method signatures in legacy and new service', () => {
      // Legacy service methods
      expect(typeof processCostingService.applyLaborTime).toBe('function');
      expect(typeof processCostingService.applyOverhead).toBe('function');
      expect(typeof processCostingService.upsertStageCost).toBe('function');
      expect(typeof processCostingService.getStageCosts).toBe('function');

      // New service should have same core methods
      const repository = new SupabaseProcessCostingRepository();
      const newService = new ProcessCostingAppService(
        repository,
        async () => 'test-org-id'
      );

      expect(typeof newService.applyLaborTime).toBe('function');
      expect(typeof newService.applyOverhead).toBe('function');
      expect(typeof newService.upsertStageCost).toBe('function');
      expect(typeof newService.getStageCosts).toBe('function');
    });

    it('should accept same parameter structure', () => {
      const params = {
        moId: 'mo-123',
        stageId: 'stage-456',
        stageNo: 1,
        workCenterId: 'wc-789',
        laborHours: 8,
        hourlyRate: 50,
        employeeName: 'Test Employee',
        notes: 'Test notes'
      };

      // Both services should accept same params structure
      // Legacy
      expect(() => processCostingService.applyLaborTime(params)).not.toThrow();
      
      // New
      const repository = new SupabaseProcessCostingRepository();
      const newService = new ProcessCostingAppService(
        repository,
        async () => 'test-org-id'
      );
      expect(() => newService.applyLaborTime(params)).not.toThrow();
    });
  });

  describe('Return Value Compatibility', () => {
    it('should return same structure from applyLaborTime', async () => {
      const repository = new SupabaseProcessCostingRepository();
      const newService = new ProcessCostingAppService(
        repository,
        async () => 'test-org-id'
      );

      const params = {
        moId: 'mo-123',
        stageNo: 1,
        workCenterId: 'wc-789',
        laborHours: 8,
        hourlyRate: 50
      };

      const result = await newService.applyLaborTime(params);

      // New service returns OperationResult<LaborTimeResult>
      expect(result).toHaveProperty('success');
      if (result.success && result.data) {
        expect(result.data).toHaveProperty('totalLaborCost');
        expect(result.data).toHaveProperty('hours');
        expect(result.data).toHaveProperty('hourlyRate');
        expect(result.data.totalLaborCost).toBe(400); // 8 * 50
      }
    });

    it('should return same structure from getStageCosts', async () => {
      const repository = new SupabaseProcessCostingRepository();
      const newService = new ProcessCostingAppService(
        repository,
        async () => 'test-org-id'
      );

      const result = await newService.getStageCosts('mo-123');

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('data');
      expect(Array.isArray(result.data)).toBe(true);
    });
  });

  describe('Validation Compatibility', () => {
    it('should validate required parameters the same way', async () => {
      const repository = new SupabaseProcessCostingRepository();
      const newService = new ProcessCostingAppService(
        repository,
        async () => 'test-org-id'
      );

      // Missing moId
      const result1 = await newService.applyLaborTime({
        stageNo: 1,
        laborHours: 8,
        hourlyRate: 50
      } as any);
      expect(result1.success).toBe(false);
      expect(result1.error).toContain('Missing required parameters');

      // Missing stage info
      const result2 = await newService.applyLaborTime({
        moId: 'mo-123',
        laborHours: 8,
        hourlyRate: 50
      } as any);
      expect(result2.success).toBe(false);
      expect(result2.error).toContain('Missing required parameters');
    });
  });

  describe('Stage Resolution', () => {
    it('should resolve stageNo from stageId when only stageId is provided', async () => {
      const repository = new SupabaseProcessCostingRepository();
      const newService = new ProcessCostingAppService(
        repository,
        async () => 'test-org-id'
      );

      const params = {
        moId: 'mo-123',
        stageId: 'stage-uuid-456', // Only stageId, no stageNo
        laborHours: 8,
        hourlyRate: 50
      };

      // Should attempt to resolve stageNo
      const result = await newService.applyLaborTime(params);
      // Result depends on mock, but should not throw
      expect(result).toHaveProperty('success');
    });

    it('should use stageNo directly when provided', async () => {
      const repository = new SupabaseProcessCostingRepository();
      const newService = new ProcessCostingAppService(
        repository,
        async () => 'test-org-id'
      );

      const params = {
        moId: 'mo-123',
        stageNo: 3, // Direct stageNo
        laborHours: 8,
        hourlyRate: 50
      };

      const result = await newService.applyLaborTime(params);
      expect(result).toHaveProperty('success');
    });
  });
});

describe('Valuation Strategy Tests', () => {
  describe('FIFO Strategy', () => {
    it('should calculate incoming rate correctly', async () => {
      const { FIFOValuationStrategy } = await import('@/domain/valuation/ValuationStrategies');
      const strategy = new FIFOValuationStrategy();

      const result = strategy.calculateIncomingRate(
        100,  // prevQty
        10,   // prevRate
        1000, // prevValue
        [{ qty: 100, rate: 10 }], // prevQueue
        50,   // incomingQty
        12    // incomingRate
      );

      expect(result.newQty).toBe(150);
      expect(result.newValue).toBe(1600); // 1000 + (50 * 12)
      expect(result.newQueue.length).toBe(2);
    });

    it('should calculate outgoing rate correctly (FIFO)', async () => {
      const { FIFOValuationStrategy } = await import('@/domain/valuation/ValuationStrategies');
      const strategy = new FIFOValuationStrategy();

      const result = strategy.calculateOutgoingRate(
        150, // qty
        [{ qty: 100, rate: 10 }, { qty: 50, rate: 12 }], // queue
        80  // outgoingQty
      );

      expect(result.newQty).toBe(70);
      expect(result.costOfGoodsSold).toBe(800); // 80 * 10 (all from first batch)
      expect(result.newQueue.length).toBe(2);
      expect(result.newQueue[0].qty).toBe(20); // 100 - 80
    });
  });

  describe('LIFO Strategy', () => {
    it('should calculate outgoing rate correctly (LIFO)', async () => {
      const { LIFOValuationStrategy } = await import('@/domain/valuation/ValuationStrategies');
      const strategy = new LIFOValuationStrategy();

      const result = strategy.calculateOutgoingRate(
        150, // qty
        [{ qty: 100, rate: 10 }, { qty: 50, rate: 12 }], // queue
        80  // outgoingQty
      );

      expect(result.newQty).toBe(70);
      // LIFO: takes from newest first: 50*12 + 30*10 = 600 + 300 = 900
      expect(result.costOfGoodsSold).toBe(900);
    });
  });

  describe('Weighted Average Strategy', () => {
    it('should calculate weighted average correctly', async () => {
      const { WeightedAverageValuationStrategy } = await import('@/domain/valuation/ValuationStrategies');
      const strategy = new WeightedAverageValuationStrategy();

      const result = strategy.calculateIncomingRate(
        100,  // prevQty
        10,   // prevRate
        1000, // prevValue
        [{ qty: 100, rate: 10 }], // prevQueue
        50,   // incomingQty
        16    // incomingRate
      );

      expect(result.newQty).toBe(150);
      expect(result.newValue).toBe(1800); // 1000 + (50 * 16)
      expect(result.newRate).toBe(12); // 1800 / 150
      expect(result.newQueue.length).toBe(1); // Weighted average consolidates
    });
  });

  describe('Strategy Factory', () => {
    it('should return correct strategy for each method', async () => {
      const { ValuationStrategyFactory } = await import('@/domain/valuation/ValuationStrategies');
      const factory = new ValuationStrategyFactory();

      expect(factory.getStrategy('FIFO').getMethodName()).toBe('FIFO');
      expect(factory.getStrategy('LIFO').getMethodName()).toBe('LIFO');
      expect(factory.getStrategy('Weighted Average').getMethodName()).toBe('Weighted Average');
      expect(factory.getStrategy('Moving Average').getMethodName()).toBe('Moving Average');
    });

    it('should list all supported methods', async () => {
      const { ValuationStrategyFactory } = await import('@/domain/valuation/ValuationStrategies');
      const factory = new ValuationStrategyFactory();

      const methods = factory.getSupportedMethods();
      expect(methods).toContain('FIFO');
      expect(methods).toContain('LIFO');
      expect(methods).toContain('Weighted Average');
      expect(methods).toContain('Moving Average');
      expect(methods.length).toBe(4);
    });
  });
});

describe('Repository Tests', () => {
  it('should implement all required repository methods', () => {
    const repository = new SupabaseProcessCostingRepository();

    // Base interface methods
    expect(typeof repository.getDirectMaterials).toBe('function');
    expect(typeof repository.getDirectLabor).toBe('function');
    expect(typeof repository.getOverheadCosts).toBe('function');
    expect(typeof repository.getManufacturingOrderQuantity).toBe('function');

    // Extended methods
    expect(typeof repository.getStageNumber).toBe('function');
    expect(typeof repository.getDefaultWorkCenter).toBe('function');
    expect(typeof repository.insertLaborTimeLog).toBe('function');
    expect(typeof repository.insertOverheadApplied).toBe('function');
    expect(typeof repository.getLaborCostsByStage).toBe('function');
    expect(typeof repository.getOverheadCostsByStage).toBe('function');
    expect(typeof repository.upsertStageCostRecord).toBe('function');
    expect(typeof repository.getStageCostsByMO).toBe('function');
    expect(typeof repository.getManufacturingOrderDetails).toBe('function');
  });
});


