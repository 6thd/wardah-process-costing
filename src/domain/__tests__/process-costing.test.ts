/**
 * Process Costing Domain Logic Tests
 */

import { describe, it, expect } from 'vitest';

/**
 * Process Cost Calculator
 */
class ProcessCostCalculator {
  constructor(
    private rawMaterialCost: number,
    private laborCost: number,
    private overheadRate: number
  ) {}

  calculate() {
    const directCost = this.rawMaterialCost + this.laborCost;
    const overheadCost = directCost * this.overheadRate;
    const totalCost = directCost + overheadCost;

    return {
      directCost,
      overheadCost,
      totalCost,
    };
  }

  calculateEfficiency(standardTime: number, actualTime: number): number {
    if (actualTime === 0) return 0;
    return (standardTime / actualTime) * 100;
  }

  calculateQualityRate(goodUnits: number, totalUnits: number): number {
    if (totalUnits === 0) return 0;
    return (goodUnits / totalUnits) * 100;
  }
}

describe('ProcessCostCalculator', () => {
  describe('calculate()', () => {
    it('should calculate total cost correctly', () => {
      const calculator = new ProcessCostCalculator(1000, 500, 0.15);

      const result = calculator.calculate();

      expect(result.directCost).toBe(1500);
      expect(result.overheadCost).toBe(225); // 15% of 1500
      expect(result.totalCost).toBe(1725);
    });

    it('should handle zero overhead rate', () => {
      const calculator = new ProcessCostCalculator(1000, 500, 0);

      const result = calculator.calculate();

      expect(result.directCost).toBe(1500);
      expect(result.overheadCost).toBe(0);
      expect(result.totalCost).toBe(1500);
    });

    it('should handle negative costs', () => {
      const calculator = new ProcessCostCalculator(-100, 500, 0.15);

      const result = calculator.calculate();

      // Should still calculate (validation should happen elsewhere)
      expect(result.directCost).toBe(400);
      expect(result.overheadCost).toBe(60);
      expect(result.totalCost).toBe(460);
    });
  });

  describe('calculateEfficiency()', () => {
    it('should calculate efficiency correctly', () => {
      const calculator = new ProcessCostCalculator(0, 0, 0);

      const efficiency = calculator.calculateEfficiency(100, 120);

      expect(efficiency).toBeCloseTo(83.33, 2); // 100/120 * 100
    });

    it('should return 100% when actual equals standard', () => {
      const calculator = new ProcessCostCalculator(0, 0, 0);

      const efficiency = calculator.calculateEfficiency(100, 100);

      expect(efficiency).toBe(100);
    });

    it('should handle zero actual time', () => {
      const calculator = new ProcessCostCalculator(0, 0, 0);

      const efficiency = calculator.calculateEfficiency(100, 0);

      expect(efficiency).toBe(0);
    });

    it('should handle actual time greater than standard', () => {
      const calculator = new ProcessCostCalculator(0, 0, 0);

      const efficiency = calculator.calculateEfficiency(100, 200);

      expect(efficiency).toBe(50); // Less than 100% = inefficient
    });
  });

  describe('calculateQualityRate()', () => {
    it('should calculate quality rate correctly', () => {
      const calculator = new ProcessCostCalculator(0, 0, 0);

      const qualityRate = calculator.calculateQualityRate(95, 100);

      expect(qualityRate).toBe(95);
    });

    it('should return 100% when all units are good', () => {
      const calculator = new ProcessCostCalculator(0, 0, 0);

      const qualityRate = calculator.calculateQualityRate(100, 100);

      expect(qualityRate).toBe(100);
    });

    it('should handle zero total units', () => {
      const calculator = new ProcessCostCalculator(0, 0, 0);

      const qualityRate = calculator.calculateQualityRate(95, 0);

      expect(qualityRate).toBe(0);
    });

    it('should handle good units greater than total', () => {
      const calculator = new ProcessCostCalculator(0, 0, 0);

      const qualityRate = calculator.calculateQualityRate(150, 100);

      expect(qualityRate).toBe(150); // Should still calculate (data issue)
    });
  });
});

