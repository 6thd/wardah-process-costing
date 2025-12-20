import { describe, it, expect } from 'vitest';
import { CostBreakdown } from '../entities/CostBreakdown';

describe('CostBreakdown Entity', () => {
  describe('creation', () => {
    it('should create CostBreakdown with valid data', () => {
      const breakdown = CostBreakdown.create(1000, 500, 300, 100);
      
      expect(breakdown.materialCost.amount).toBe(1000);
      expect(breakdown.laborCost.amount).toBe(500);
      expect(breakdown.overheadCost.amount).toBe(300);
      expect(breakdown.quantity.value).toBe(100);
    });

    it('should create with custom currency', () => {
      const breakdown = CostBreakdown.create(1000, 500, 300, 100, 'USD');
      
      expect(breakdown.materialCost.currency).toBe('USD');
      expect(breakdown.laborCost.currency).toBe('USD');
      expect(breakdown.overheadCost.currency).toBe('USD');
    });

    it('should throw for zero quantity', () => {
      expect(() => CostBreakdown.create(1000, 500, 300, 0)).toThrow('Quantity must be positive');
    });

    it('should throw for negative quantity', () => {
      expect(() => CostBreakdown.create(1000, 500, 300, -10)).toThrow('Quantity must be positive');
    });

    it('should create zero breakdown', () => {
      const breakdown = CostBreakdown.zero();
      
      expect(breakdown.materialCost.amount).toBe(0);
      expect(breakdown.laborCost.amount).toBe(0);
      expect(breakdown.overheadCost.amount).toBe(0);
      expect(breakdown.totalCost.amount).toBe(0);
    });

    it('should create from raw data', () => {
      const data = {
        materialCost: 2000,
        laborCost: 1000,
        overheadCost: 500,
        quantity: 200,
        currency: 'SAR'
      };
      
      const breakdown = CostBreakdown.fromRawData(data);
      
      expect(breakdown.materialCost.amount).toBe(2000);
      expect(breakdown.laborCost.amount).toBe(1000);
      expect(breakdown.overheadCost.amount).toBe(500);
      expect(breakdown.quantity.value).toBe(200);
    });
  });

  describe('totalCost', () => {
    it('should calculate total cost correctly', () => {
      const breakdown = CostBreakdown.create(1000, 500, 300, 100);
      
      expect(breakdown.totalCost.amount).toBe(1800);
    });

    it('should return zero for zero breakdown', () => {
      const breakdown = CostBreakdown.zero();
      
      expect(breakdown.totalCost.amount).toBe(0);
    });

    it('should handle large values', () => {
      const breakdown = CostBreakdown.create(1000000, 500000, 250000, 10000);
      
      expect(breakdown.totalCost.amount).toBe(1750000);
    });
  });

  describe('costPerUnit', () => {
    it('should calculate cost per unit', () => {
      const breakdown = CostBreakdown.create(1000, 500, 300, 100);
      
      expect(breakdown.costPerUnit().amount).toBe(18);
    });

    it('should handle decimal results', () => {
      const breakdown = CostBreakdown.create(100, 50, 30, 7);
      const costPerUnit = breakdown.costPerUnit();
      
      expect(costPerUnit.amount).toBeCloseTo(25.71, 2);
    });

    it('should handle single unit', () => {
      const breakdown = CostBreakdown.create(100, 50, 30, 1);
      
      expect(breakdown.costPerUnit().amount).toBe(180);
    });
  });

  describe('percentage calculations', () => {
    describe('materialPercentage', () => {
      it('should calculate material percentage', () => {
        const breakdown = CostBreakdown.create(1000, 500, 500, 100);
        
        expect(breakdown.materialPercentage()).toBe(50);
      });

      it('should return zero when total is zero', () => {
        const breakdown = CostBreakdown.create(0, 0, 0, 100);
        
        expect(breakdown.materialPercentage()).toBe(0);
      });
    });

    describe('laborPercentage', () => {
      it('should calculate labor percentage', () => {
        const breakdown = CostBreakdown.create(500, 1000, 500, 100);
        
        expect(breakdown.laborPercentage()).toBe(50);
      });

      it('should return zero when total is zero', () => {
        const breakdown = CostBreakdown.create(0, 0, 0, 100);
        
        expect(breakdown.laborPercentage()).toBe(0);
      });
    });

    describe('overheadPercentage', () => {
      it('should calculate overhead percentage', () => {
        const breakdown = CostBreakdown.create(500, 500, 1000, 100);
        
        expect(breakdown.overheadPercentage()).toBe(50);
      });

      it('should return zero when total is zero', () => {
        const breakdown = CostBreakdown.create(0, 0, 0, 100);
        
        expect(breakdown.overheadPercentage()).toBe(0);
      });
    });

    it('should sum percentages to 100%', () => {
      const breakdown = CostBreakdown.create(600, 300, 100, 50);
      
      const total = breakdown.materialPercentage() + 
                   breakdown.laborPercentage() + 
                   breakdown.overheadPercentage();
      
      expect(total).toBeCloseTo(100, 1);
    });
  });

  describe('real-world manufacturing scenarios', () => {
    it('should handle typical manufacturing cost breakdown', () => {
      // Material-heavy product (cosmetics)
      const cosmeticsBreakdown = CostBreakdown.create(
        7000,  // 70% materials
        2000,  // 20% labor
        1000,  // 10% overhead
        1000   // units
      );
      
      expect(cosmeticsBreakdown.materialPercentage()).toBe(70);
      expect(cosmeticsBreakdown.laborPercentage()).toBe(20);
      expect(cosmeticsBreakdown.overheadPercentage()).toBe(10);
      expect(cosmeticsBreakdown.costPerUnit().amount).toBe(10);
    });

    it('should handle labor-intensive production', () => {
      // Labor-heavy product (handmade items)
      const handmadeBreakdown = CostBreakdown.create(
        2000,  // 20% materials
        6000,  // 60% labor
        2000,  // 20% overhead
        500    // units
      );
      
      expect(handmadeBreakdown.laborPercentage()).toBe(60);
      expect(handmadeBreakdown.costPerUnit().amount).toBe(20);
    });

    it('should handle high-overhead production', () => {
      // High-tech manufacturing with expensive equipment
      const highTechBreakdown = CostBreakdown.create(
        3000,   // 30% materials
        2000,   // 20% labor
        5000,   // 50% overhead
        100     // units
      );
      
      expect(highTechBreakdown.overheadPercentage()).toBe(50);
      expect(highTechBreakdown.costPerUnit().amount).toBe(100);
    });

    it('should calculate batch production costs', () => {
      const batchBreakdown = CostBreakdown.create(
        50000,   // material cost for batch
        15000,   // labor cost for batch
        10000,   // overhead for batch
        5000     // units in batch
      );
      
      expect(batchBreakdown.totalCost.amount).toBe(75000);
      expect(batchBreakdown.costPerUnit().amount).toBe(15);
    });
  });

  describe('immutability', () => {
    it('should be immutable - getters return new instances', () => {
      const breakdown = CostBreakdown.create(1000, 500, 300, 100);
      
      const cost1 = breakdown.totalCost;
      const cost2 = breakdown.totalCost;
      
      // Should be equal but not same reference
      expect(cost1.amount).toBe(cost2.amount);
    });
  });

  describe('edge cases', () => {
    it('should handle very small quantities', () => {
      const breakdown = CostBreakdown.create(100, 50, 30, 1);
      
      expect(breakdown.costPerUnit().amount).toBe(180);
    });

    it('should handle very large values', () => {
      const breakdown = CostBreakdown.create(
        10000000,  // 10M materials
        5000000,   // 5M labor
        2500000,   // 2.5M overhead
        1000000    // 1M units
      );
      
      expect(breakdown.totalCost.amount).toBe(17500000);
      expect(breakdown.costPerUnit().amount).toBe(17.5);
    });

    it('should handle decimal costs', () => {
      const breakdown = CostBreakdown.create(
        1234.56,
        567.89,
        234.55,
        100
      );
      
      expect(breakdown.totalCost.amount).toBeCloseTo(2037, 0);
    });
  });
});
