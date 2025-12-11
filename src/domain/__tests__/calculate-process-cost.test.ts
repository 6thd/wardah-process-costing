/**
 * CalculateProcessCost Use Case Tests
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalculateProcessCostUseCase } from '../use-cases/CalculateProcessCost';
import type { IProcessCostingRepository } from '../interfaces/IProcessCostingRepository';

describe('CalculateProcessCost Use Case', () => {
  let mockRepository: IProcessCostingRepository;
  let useCase: CalculateProcessCostUseCase;

  beforeEach(() => {
    mockRepository = {
      getDirectMaterials: vi.fn(),
      getDirectLabor: vi.fn(),
      getOverheadCosts: vi.fn(),
      getManufacturingOrderQuantity: vi.fn()
    };
    useCase = new CalculateProcessCostUseCase(mockRepository);
  });

  describe('Basic Calculation', () => {
    it('should calculate process cost', async () => {
      vi.mocked(mockRepository.getDirectMaterials).mockResolvedValue([
        { id: '1', itemId: 'I1', itemName: 'Material A', quantity: 10, unitCost: 50, totalCost: 500 }
      ]);
      vi.mocked(mockRepository.getDirectLabor).mockResolvedValue([
        { id: '1', hours: 8, hourlyRate: 50, totalCost: 400 }
      ]);
      vi.mocked(mockRepository.getOverheadCosts).mockResolvedValue([
        { id: '1', type: 'utilities', description: 'Power', amount: 200 }
      ]);
      vi.mocked(mockRepository.getManufacturingOrderQuantity).mockResolvedValue(100);

      const result = await useCase.execute({ moId: 'MO-001' });

      expect(result.costBreakdown.materialCost.amount).toBe(500);
      expect(result.costBreakdown.laborCost.amount).toBe(400);
      expect(result.costBreakdown.overheadCost.amount).toBe(200);
      expect(result.costBreakdown.totalCost.amount).toBe(1100);
    });

    it('should return details', async () => {
      vi.mocked(mockRepository.getDirectMaterials).mockResolvedValue([
        { id: '1', itemId: 'I1', itemName: 'A', quantity: 1, unitCost: 10, totalCost: 10 },
        { id: '2', itemId: 'I2', itemName: 'B', quantity: 1, unitCost: 10, totalCost: 10 }
      ]);
      vi.mocked(mockRepository.getDirectLabor).mockResolvedValue([
        { id: '1', hours: 5, hourlyRate: 20, totalCost: 100 }
      ]);
      vi.mocked(mockRepository.getOverheadCosts).mockResolvedValue([]);
      vi.mocked(mockRepository.getManufacturingOrderQuantity).mockResolvedValue(50);

      const result = await useCase.execute({ moId: 'MO-001' });

      expect(result.details.materialItems).toBe(2);
      expect(result.details.laborEntries).toBe(1);
      expect(result.details.overheadEntries).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty data', async () => {
      vi.mocked(mockRepository.getDirectMaterials).mockResolvedValue([]);
      vi.mocked(mockRepository.getDirectLabor).mockResolvedValue([]);
      vi.mocked(mockRepository.getOverheadCosts).mockResolvedValue([]);
      vi.mocked(mockRepository.getManufacturingOrderQuantity).mockResolvedValue(100);

      const result = await useCase.execute({ moId: 'MO-001' });

      expect(result.costBreakdown.totalCost.amount).toBe(0);
    });

    it('should use 1 as default quantity', async () => {
      vi.mocked(mockRepository.getDirectMaterials).mockResolvedValue([]);
      vi.mocked(mockRepository.getDirectLabor).mockResolvedValue([]);
      vi.mocked(mockRepository.getOverheadCosts).mockResolvedValue([]);
      vi.mocked(mockRepository.getManufacturingOrderQuantity).mockResolvedValue(0);

      const result = await useCase.execute({ moId: 'MO-001' });

      expect(result.costBreakdown.quantity.value).toBe(1);
    });

    it('should use custom currency', async () => {
      vi.mocked(mockRepository.getDirectMaterials).mockResolvedValue([]);
      vi.mocked(mockRepository.getDirectLabor).mockResolvedValue([]);
      vi.mocked(mockRepository.getOverheadCosts).mockResolvedValue([]);
      vi.mocked(mockRepository.getManufacturingOrderQuantity).mockResolvedValue(100);

      const result = await useCase.execute({ moId: 'MO-001', currency: 'USD' });

      expect(result.costBreakdown.materialCost.currency).toBe('USD');
    });
  });

  describe('Repository Interaction', () => {
    it('should call repository with correct ID', async () => {
      vi.mocked(mockRepository.getDirectMaterials).mockResolvedValue([]);
      vi.mocked(mockRepository.getDirectLabor).mockResolvedValue([]);
      vi.mocked(mockRepository.getOverheadCosts).mockResolvedValue([]);
      vi.mocked(mockRepository.getManufacturingOrderQuantity).mockResolvedValue(100);

      await useCase.execute({ moId: 'MO-12345' });

      expect(mockRepository.getDirectMaterials).toHaveBeenCalledWith('MO-12345');
      expect(mockRepository.getDirectLabor).toHaveBeenCalledWith('MO-12345');
    });
  });
});
