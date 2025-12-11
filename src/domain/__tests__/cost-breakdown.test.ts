/**
 * CostBreakdown Entity Tests
 */
import { describe, it, expect } from 'vitest';
import { CostBreakdown } from '../entities/CostBreakdown';

describe('CostBreakdown Entity', () => {
  describe('Creation', () => {
    it('should create with valid data', () => {
      const b = CostBreakdown.create(1000, 500, 300, 100);
      expect(b.materialCost.amount).toBe(1000);
      expect(b.laborCost.amount).toBe(500);
      expect(b.overheadCost.amount).toBe(300);
      expect(b.quantity.value).toBe(100);
    });

    it('should use SAR as default currency', () => {
      const b = CostBreakdown.create(1000, 500, 300, 100);
      expect(b.materialCost.currency).toBe('SAR');
    });

    it('should throw for zero quantity', () => {
      expect(() => CostBreakdown.create(1000, 500, 300, 0)).toThrow('Quantity must be positive');
    });

    it('should throw for negative quantity', () => {
      expect(() => CostBreakdown.create(1000, 500, 300, -10)).toThrow('Quantity must be positive');
    });

    it('should create zero breakdown', () => {
      const b = CostBreakdown.zero();
      expect(b.totalCost.amount).toBe(0);
    });
  });

  describe('Calculations', () => {
    it('should calculate total cost', () => {
      const b = CostBreakdown.create(1000, 500, 300, 100);
      expect(b.totalCost.amount).toBe(1800);
    });

    it('should calculate cost per unit', () => {
      const b = CostBreakdown.create(1000, 500, 300, 100);
      expect(b.costPerUnit().amount).toBe(18);
    });

    it('should calculate material percentage', () => {
      const b = CostBreakdown.create(900, 600, 300, 100);
      expect(b.materialPercentage()).toBe(50);
    });

    it('should calculate labor percentage', () => {
      const b = CostBreakdown.create(900, 600, 300, 100);
      expect(b.laborPercentage()).toBeCloseTo(33.33, 1);
    });

    it('should calculate overhead percentage', () => {
      const b = CostBreakdown.create(900, 600, 300, 100);
      expect(b.overheadPercentage()).toBeCloseTo(16.67, 1);
    });
  });

  describe('Variance', () => {
    it('should calculate variance', () => {
      const actual = CostBreakdown.create(1100, 550, 330, 100);
      const budgeted = CostBreakdown.create(1000, 500, 300, 100);
      const variance = actual.varianceFrom(budgeted);
      expect(variance.materialCost.amount).toBe(100);
      expect(variance.laborCost.amount).toBe(50);
      expect(variance.overheadCost.amount).toBe(30);
    });

    it('should calculate percentage variance', () => {
      const actual = CostBreakdown.create(1100, 550, 330, 100);
      const budgeted = CostBreakdown.create(1000, 500, 300, 100);
      const pv = actual.percentageVarianceFrom(budgeted);
      expect(pv.material).toBe(10);
      expect(pv.labor).toBe(10);
    });
  });

  describe('Immutable Operations', () => {
    it('should return new instance with withMaterialCost', () => {
      const o = CostBreakdown.create(1000, 500, 300, 100);
      const m = o.withMaterialCost(1200);
      expect(o.materialCost.amount).toBe(1000);
      expect(m.materialCost.amount).toBe(1200);
    });

    it('should add breakdowns', () => {
      const a = CostBreakdown.create(1000, 500, 300, 100);
      const b = CostBreakdown.create(500, 250, 150, 50);
      const c = a.add(b);
      expect(c.materialCost.amount).toBe(1500);
      expect(c.quantity.value).toBe(150);
    });

    it('should scale breakdown', () => {
      const o = CostBreakdown.create(1000, 500, 300, 100);
      const s = o.scale(2);
      expect(s.materialCost.amount).toBe(2000);
      expect(s.quantity.value).toBe(100);
    });
  });

  describe('Serialization', () => {
    it('should serialize to JSON', () => {
      const b = CostBreakdown.create(1000, 500, 300, 100, 'SAR');
      const j = b.toJSON();
      expect(j.materialCost).toBe(1000);
      expect(j.quantity).toBe(100);
    });

    it('should round-trip', () => {
      const o = CostBreakdown.create(1000, 500, 300, 100);
      const r = CostBreakdown.fromRawData(o.toJSON());
      expect(o.equals(r)).toBe(true);
    });
  });
});
