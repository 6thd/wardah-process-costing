/**
 * @fileoverview Tests for ProcessCostingAppService
 * Covers labor time application, overhead application, stage cost calculation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ProcessCostingAppService, IProcessCostingRepositoryExtended } from '../ProcessCostingAppService';

// Mock repository
const createMockRepository = (): IProcessCostingRepositoryExtended => ({
  getStageNumber: vi.fn(),
  getDefaultWorkCenter: vi.fn(),
  insertLaborTimeLog: vi.fn(),
  insertOverheadApplied: vi.fn(),
  getLaborCostsByStage: vi.fn(),
  getOverheadCostsByStage: vi.fn(),
  upsertStageCostRecord: vi.fn(),
  getStageCostsByMO: vi.fn(),
  getManufacturingOrderDetails: vi.fn(),
  getDirectMaterials: vi.fn(),
  getDirectLabor: vi.fn(),
  getOverheadCosts: vi.fn(),
});

describe('ProcessCostingAppService', () => {
  let service: ProcessCostingAppService;
  let mockRepository: IProcessCostingRepositoryExtended;
  let mockGetOrgId: () => Promise<string>;

  beforeEach(() => {
    mockRepository = createMockRepository();
    mockGetOrgId = vi.fn().mockResolvedValue('org-test-1');
    service = new ProcessCostingAppService(mockRepository, mockGetOrgId);
  });

  describe('applyLaborTime', () => {
    it('should apply labor time successfully with all parameters', async () => {
      vi.mocked(mockRepository.insertLaborTimeLog).mockResolvedValue({ id: 'labor-1' });

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        laborHours: 8,
        hourlyRate: 50,
        employeeName: 'John Doe',
        operationCode: 'OP-001',
        notes: 'Regular shift'
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.totalLaborCost).toBe(400); // 8 * 50
      expect(result.data?.hours).toBe(8);
      expect(result.data?.hourlyRate).toBe(50);
    });

    it('should resolve stageNo from stageId when not provided', async () => {
      vi.mocked(mockRepository.getStageNumber).mockResolvedValue(2);
      vi.mocked(mockRepository.insertLaborTimeLog).mockResolvedValue({ id: 'labor-2' });

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageId: 'stage-1',
        workCenterId: 'wc-1',
        laborHours: 4,
        hourlyRate: 60
      });

      expect(mockRepository.getStageNumber).toHaveBeenCalledWith('stage-1');
      expect(result.success).toBe(true);
    });

    it('should use default work center when not provided', async () => {
      vi.mocked(mockRepository.getDefaultWorkCenter).mockResolvedValue('default-wc');
      vi.mocked(mockRepository.insertLaborTimeLog).mockResolvedValue({ id: 'labor-3' });

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        laborHours: 2,
        hourlyRate: 40
      });

      expect(mockRepository.getDefaultWorkCenter).toHaveBeenCalledWith('org-test-1');
      expect(result.success).toBe(true);
    });

    it('should return error when moId is missing', async () => {
      const result = await service.applyLaborTime({
        moId: '',
        stageNo: 1,
        laborHours: 2,
        hourlyRate: 40
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
    });

    it('should return error when laborHours is missing', async () => {
      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        laborHours: 0,
        hourlyRate: 40
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
    });

    it('should return error when hourlyRate is missing', async () => {
      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        laborHours: 8,
        hourlyRate: 0
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
    });

    it('should return error when stageNo cannot be resolved', async () => {
      vi.mocked(mockRepository.getStageNumber).mockResolvedValue(null);

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageId: 'invalid-stage',
        laborHours: 4,
        hourlyRate: 50,
        workCenterId: 'wc-1'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('stage_no is required');
    });

    it('should return error when no work center available', async () => {
      vi.mocked(mockRepository.getDefaultWorkCenter).mockResolvedValue(null);

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        laborHours: 4,
        hourlyRate: 50
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('workCenterId is required');
    });

    it('should return error when database insert fails', async () => {
      vi.mocked(mockRepository.insertLaborTimeLog).mockResolvedValue(null);

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        laborHours: 4,
        hourlyRate: 50
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to save labor time record');
    });

    it('should handle exceptions gracefully', async () => {
      vi.mocked(mockRepository.insertLaborTimeLog).mockRejectedValue(new Error('Database error'));

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        laborHours: 4,
        hourlyRate: 50
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });

    it('should calculate labor cost correctly', async () => {
      vi.mocked(mockRepository.insertLaborTimeLog).mockResolvedValue({ id: 'labor-4' });

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        laborHours: 12.5,
        hourlyRate: 45.50
      });

      expect(result.success).toBe(true);
      expect(result.data?.totalLaborCost).toBe(568.75); // 12.5 * 45.50
    });
  });

  describe('applyOverhead', () => {
    it('should apply overhead successfully with all parameters', async () => {
      vi.mocked(mockRepository.insertOverheadApplied).mockResolvedValue({ id: 'overhead-1' });

      const result = await service.applyOverhead({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        baseQty: 100,
        overheadRate: 5,
        overheadType: 'Fixed',
        notes: 'Monthly overhead'
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.overheadAmount).toBe(500); // 100 * 5
    });

    it('should return error when required parameters are missing', async () => {
      const result = await service.applyOverhead({
        moId: 'mo-1',
        stageNo: 1,
        baseQty: 0,
        overheadRate: 5
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
    });

    it('should resolve stageNo from stageId', async () => {
      vi.mocked(mockRepository.getStageNumber).mockResolvedValue(3);
      vi.mocked(mockRepository.insertOverheadApplied).mockResolvedValue({ id: 'overhead-2' });

      const result = await service.applyOverhead({
        moId: 'mo-1',
        stageId: 'stage-3',
        workCenterId: 'wc-1',
        baseQty: 50,
        overheadRate: 10
      });

      expect(mockRepository.getStageNumber).toHaveBeenCalledWith('stage-3');
      expect(result.success).toBe(true);
    });

    it('should handle database errors', async () => {
      vi.mocked(mockRepository.insertOverheadApplied).mockRejectedValue(new Error('Insert failed'));

      const result = await service.applyOverhead({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        baseQty: 100,
        overheadRate: 5
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insert failed');
    });
  });

  describe('upsertStageCost', () => {
    it('should calculate stage cost correctly', async () => {
      vi.mocked(mockRepository.getLaborCostsByStage).mockResolvedValue(400);
      vi.mocked(mockRepository.getOverheadCostsByStage).mockResolvedValue(200);
      vi.mocked(mockRepository.upsertStageCostRecord).mockResolvedValue({
        id: 'cost-1',
        stageNo: 1,
        goodQty: 100,
        scrapQty: 5,
        materialCost: 1000,
        laborCost: 400,
        overheadCost: 200,
        totalCost: 1600,
        unitCost: 15.24, // 1600 / 105
        status: 'completed'
      });

      const result = await service.upsertStageCost({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        goodQty: 100,
        scrapQty: 5,
        materialCost: 1000
      });

      expect(result.success).toBe(true);
      expect(result.data?.totalCost).toBe(1600);
    });

    it('should return error when goodQty is undefined', async () => {
      const result = await service.upsertStageCost({
        moId: 'mo-1',
        stageNo: 1,
        // goodQty is intentionally missing
        directMaterialCost: 1000
      } as any);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameters');
    });
  });

  describe('getManufacturingOrderCostSummary', () => {
    it('should return cost summary for manufacturing order', async () => {
      vi.mocked(mockRepository.getManufacturingOrderDetails).mockResolvedValue({
        orderNumber: 'MO-001',
        productName: 'Widget A',
        plannedQty: 100,
        completedQty: 95,
        standardCost: 10
      });
      vi.mocked(mockRepository.getStageCostsByMO).mockResolvedValue([
        {
          id: 'stage-1',
          manufacturing_order_id: 'mo-1',
          stage_number: 1,
          good_quantity: 100,
          scrap_quantity: 2,
          material_cost: 500,
          labor_cost: 200,
          overhead_cost: 100,
          total_cost: 800,
          unit_cost: 7.84,
          status: 'completed'
        },
        {
          id: 'stage-2',
          manufacturing_order_id: 'mo-1',
          stage_number: 2,
          good_quantity: 98,
          scrap_quantity: 3,
          material_cost: 300,
          labor_cost: 150,
          overhead_cost: 75,
          total_cost: 525,
          unit_cost: 5.20,
          status: 'completed'
        }
      ]);

      const result = await service.getManufacturingOrderCostSummary('mo-1');

      expect(result.success).toBe(true);
      expect(result.data?.orderNumber).toBe('MO-001');
      expect(result.data?.stageCosts).toHaveLength(2);
      expect(result.data?.totalMaterialCost).toBe(800);
      expect(result.data?.totalLaborCost).toBe(350);
      expect(result.data?.totalOverheadCost).toBe(175);
    });

    it('should return error when order not found', async () => {
      vi.mocked(mockRepository.getManufacturingOrderDetails).mockResolvedValue(null);

      const result = await service.getManufacturingOrderCostSummary('invalid-mo');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle empty stages', async () => {
      vi.mocked(mockRepository.getManufacturingOrderDetails).mockResolvedValue({
        orderNumber: 'MO-002',
        productName: 'Widget B',
        plannedQty: 50,
        completedQty: 0
      });
      vi.mocked(mockRepository.getStageCostsByMO).mockResolvedValue([]);

      const result = await service.getManufacturingOrderCostSummary('mo-2');

      expect(result.success).toBe(true);
      expect(result.data?.stageCosts).toHaveLength(0);
      expect(result.data?.totalCost).toBe(0);
    });

    it('should calculate variance when standard cost is provided', async () => {
      vi.mocked(mockRepository.getManufacturingOrderDetails).mockResolvedValue({
        orderNumber: 'MO-003',
        productName: 'Widget C',
        plannedQty: 100,
        completedQty: 100,
        standardCost: 10
      });
      vi.mocked(mockRepository.getStageCostsByMO).mockResolvedValue([
        {
          id: 'stage-1',
          manufacturing_order_id: 'mo-3',
          stage_number: 1,
          good_quantity: 100,
          scrap_quantity: 0,
          material_cost: 600,
          labor_cost: 300,
          overhead_cost: 200,
          total_cost: 1100,
          unit_cost: 11,
          status: 'completed'
        }
      ]);

      const result = await service.getManufacturingOrderCostSummary('mo-3');

      expect(result.success).toBe(true);
      expect(result.data?.variance).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle decimal labor hours', async () => {
      vi.mocked(mockRepository.insertLaborTimeLog).mockResolvedValue({ id: 'labor-dec' });

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        laborHours: 0.5,
        hourlyRate: 100
      });

      expect(result.success).toBe(true);
      expect(result.data?.totalLaborCost).toBe(50);
    });

    it('should handle very large quantities', async () => {
      vi.mocked(mockRepository.insertOverheadApplied).mockResolvedValue({ id: 'overhead-large' });

      const result = await service.applyOverhead({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        baseQty: 1000000,
        overheadRate: 0.001
      });

      expect(result.success).toBe(true);
      expect(result.data?.overheadAmount).toBe(1000);
    });

    it('should handle unicode in notes', async () => {
      vi.mocked(mockRepository.insertLaborTimeLog).mockResolvedValue({ id: 'labor-uni' });

      const result = await service.applyLaborTime({
        moId: 'mo-1',
        stageNo: 1,
        workCenterId: 'wc-1',
        laborHours: 4,
        hourlyRate: 50,
        notes: 'ملاحظات باللغة العربية'
      });

      expect(result.success).toBe(true);
    });
  });
});
