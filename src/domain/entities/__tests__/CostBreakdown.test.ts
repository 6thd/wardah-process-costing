/**
 * Tests for domain/entities/CostBreakdown.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code
 */
import { describe, it, expect } from 'vitest';
import { CostBreakdown } from '../CostBreakdown';

describe('CostBreakdown Entity', () => {
  describe('creation', () => {
    it('should create CostBreakdown with valid values', () => {
      const breakdown = CostBreakdown.create(100, 50, 25, 10);
      expect(breakdown.materialCost.amount).toBe(100);
      expect(breakdown.laborCost.amount).toBe(50);
      expect(breakdown.overheadCost.amount).toBe(25);
      expect(breakdown.quantity.value).toBe(10);
    });

    it('should create CostBreakdown with specific currency', () => {
      const breakdown = CostBreakdown.create(100, 50, 25, 10, 'USD');
      expect(breakdown.materialCost.currency).toBe('USD');
      expect(breakdown.laborCost.currency).toBe('USD');
      expect(breakdown.overheadCost.currency).toBe('USD');
    });

    it('should throw for zero quantity', () => {
      expect(() => CostBreakdown.create(100, 50, 25, 0)).toThrow('Quantity must be positive');
    });

    it('should throw for negative quantity', () => {
      expect(() => CostBreakdown.create(100, 50, 25, -5)).toThrow('Quantity must be positive');
    });

    it('should create from raw data', () => {
      const breakdown = CostBreakdown.fromRawData({
        materialCost: 200,
        laborCost: 100,
        overheadCost: 50,
        quantity: 5,
        currency: 'EUR'
      });
      expect(breakdown.materialCost.amount).toBe(200);
      expect(breakdown.materialCost.currency).toBe('EUR');
    });

    it('should create zero breakdown', () => {
      const breakdown = CostBreakdown.zero();
      expect(breakdown.materialCost.amount).toBe(0);
      expect(breakdown.laborCost.amount).toBe(0);
      expect(breakdown.overheadCost.amount).toBe(0);
      expect(breakdown.quantity.value).toBe(1);
    });

    it('should create zero breakdown with specific currency', () => {
      const breakdown = CostBreakdown.zero('GBP');
      expect(breakdown.materialCost.currency).toBe('GBP');
    });
  });

  describe('totalCost', () => {
    it('should calculate total cost correctly', () => {
      const breakdown = CostBreakdown.create(100, 50, 25, 10);
      expect(breakdown.totalCost.amount).toBe(175);
    });

    it('should handle zero costs', () => {
      const breakdown = CostBreakdown.create(0, 0, 0, 10);
      expect(breakdown.totalCost.amount).toBe(0);
    });
  });

  describe('costPerUnit', () => {
    it('should calculate cost per unit correctly', () => {
      const breakdown = CostBreakdown.create(100, 50, 50, 10);
      expect(breakdown.costPerUnit().amount).toBe(20);
    });

    it('should handle decimal results', () => {
      const breakdown = CostBreakdown.create(100, 50, 25, 7);
      expect(breakdown.costPerUnit().amount).toBeCloseTo(25, 1);
    });
  });

  describe('percentage calculations', () => {
    it('should calculate material percentage', () => {
      const breakdown = CostBreakdown.create(50, 30, 20, 10);
      expect(breakdown.materialPercentage()).toBe(50);
    });

    it('should calculate labor percentage', () => {
      const breakdown = CostBreakdown.create(50, 30, 20, 10);
      expect(breakdown.laborPercentage()).toBe(30);
    });

    it('should calculate overhead percentage', () => {
      const breakdown = CostBreakdown.create(50, 30, 20, 10);
      expect(breakdown.overheadPercentage()).toBe(20);
    });

    it('should return 0 for zero total', () => {
      const breakdown = CostBreakdown.zero();
      expect(breakdown.materialPercentage()).toBe(0);
      expect(breakdown.laborPercentage()).toBe(0);
      expect(breakdown.overheadPercentage()).toBe(0);
    });
  });

  describe('varianceFrom', () => {
    it('should calculate variance correctly', () => {
      const actual = CostBreakdown.create(120, 60, 30, 10);
      const budget = CostBreakdown.create(100, 50, 25, 10);
      const variance = actual.varianceFrom(budget);
      
      expect(variance.materialCost.amount).toBe(20);
      expect(variance.laborCost.amount).toBe(10);
      expect(variance.overheadCost.amount).toBe(5);
    });
  });

  describe('percentageVarianceFrom', () => {
    it('should calculate percentage variance correctly', () => {
      const actual = CostBreakdown.create(120, 60, 30, 10);
      const budget = CostBreakdown.create(100, 50, 25, 10);
      const variance = actual.percentageVarianceFrom(budget);
      
      expect(variance.material).toBe(20);
      expect(variance.labor).toBe(20);
      expect(variance.overhead).toBe(20);
    });

    it('should handle zero base values', () => {
      const actual = CostBreakdown.create(100, 50, 25, 10);
      const budget = CostBreakdown.zero();
      const variance = actual.percentageVarianceFrom(budget);
      
      expect(variance.material).toBe(100);
      expect(variance.labor).toBe(100);
      expect(variance.overhead).toBe(100);
    });

    it('should return 0 when both are zero', () => {
      const actual = CostBreakdown.zero();
      const budget = CostBreakdown.zero();
      const variance = actual.percentageVarianceFrom(budget);
      
      expect(variance.material).toBe(0);
      expect(variance.labor).toBe(0);
      expect(variance.overhead).toBe(0);
    });
  });

  describe('with* methods (immutable updates)', () => {
    it('withMaterialCost should create new breakdown', () => {
      const original = CostBreakdown.create(100, 50, 25, 10);
      const updated = original.withMaterialCost(200);
      
      expect(updated.materialCost.amount).toBe(200);
      expect(original.materialCost.amount).toBe(100);
    });

    it('withLaborCost should create new breakdown', () => {
      const original = CostBreakdown.create(100, 50, 25, 10);
      const updated = original.withLaborCost(80);
      
      expect(updated.laborCost.amount).toBe(80);
      expect(original.laborCost.amount).toBe(50);
    });

    it('withOverheadCost should create new breakdown', () => {
      const original = CostBreakdown.create(100, 50, 25, 10);
      const updated = original.withOverheadCost(40);
      
      expect(updated.overheadCost.amount).toBe(40);
      expect(original.overheadCost.amount).toBe(25);
    });

    it('withQuantity should create new breakdown', () => {
      const original = CostBreakdown.create(100, 50, 25, 10);
      const updated = original.withQuantity(20);
      
      expect(updated.quantity.value).toBe(20);
      expect(original.quantity.value).toBe(10);
    });

    it('withQuantity should throw for invalid quantity', () => {
      const original = CostBreakdown.create(100, 50, 25, 10);
      expect(() => original.withQuantity(0)).toThrow('Quantity must be positive');
      expect(() => original.withQuantity(-5)).toThrow('Quantity must be positive');
    });
  });

  describe('add', () => {
    it('should add two breakdowns correctly', () => {
      const b1 = CostBreakdown.create(100, 50, 25, 10);
      const b2 = CostBreakdown.create(50, 30, 15, 5);
      const result = b1.add(b2);
      
      expect(result.materialCost.amount).toBe(150);
      expect(result.laborCost.amount).toBe(80);
      expect(result.overheadCost.amount).toBe(40);
      expect(result.quantity.value).toBe(15);
    });
  });

  describe('scale', () => {
    it('should scale costs by factor', () => {
      const breakdown = CostBreakdown.create(100, 50, 25, 10);
      const scaled = breakdown.scale(2);
      
      expect(scaled.materialCost.amount).toBe(200);
      expect(scaled.laborCost.amount).toBe(100);
      expect(scaled.overheadCost.amount).toBe(50);
      expect(scaled.quantity.value).toBe(10); // Quantity unchanged
    });

    it('should throw for negative factor', () => {
      const breakdown = CostBreakdown.create(100, 50, 25, 10);
      expect(() => breakdown.scale(-2)).toThrow('Scale factor cannot be negative');
    });

    it('should scale by zero', () => {
      const breakdown = CostBreakdown.create(100, 50, 25, 10);
      const scaled = breakdown.scale(0);
      
      expect(scaled.materialCost.amount).toBe(0);
      expect(scaled.laborCost.amount).toBe(0);
      expect(scaled.overheadCost.amount).toBe(0);
    });
  });

  describe('equals', () => {
    it('should return true for equal breakdowns', () => {
      const b1 = CostBreakdown.create(100, 50, 25, 10);
      const b2 = CostBreakdown.create(100, 50, 25, 10);
      expect(b1.equals(b2)).toBe(true);
    });

    it('should return false for different material cost', () => {
      const b1 = CostBreakdown.create(100, 50, 25, 10);
      const b2 = CostBreakdown.create(200, 50, 25, 10);
      expect(b1.equals(b2)).toBe(false);
    });

    it('should return false for different quantities', () => {
      const b1 = CostBreakdown.create(100, 50, 25, 10);
      const b2 = CostBreakdown.create(100, 50, 25, 20);
      expect(b1.equals(b2)).toBe(false);
    });
  });

  describe('toJSON', () => {
    it('should serialize to JSON correctly', () => {
      const breakdown = CostBreakdown.create(100, 50, 25, 10, 'USD');
      const json = breakdown.toJSON();
      
      expect(json).toEqual({
        materialCost: 100,
        laborCost: 50,
        overheadCost: 25,
        quantity: 10,
        currency: 'USD'
      });
    });
  });
});
