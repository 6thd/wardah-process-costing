/**
 * Inventory Domain Logic Tests
 */

import { describe, it, expect } from 'vitest';

/**
 * AVCO (Average Cost) Calculator
 */
class AVCOCalculator {
  calculateNewAverage(
    currentStock: number,
    currentValue: number,
    incomingQty: number,
    incomingCost: number
  ): { newStock: number; newValue: number; newAverageCost: number } {
    const newStock = currentStock + incomingQty;
    const newValue = currentValue + (incomingQty * incomingCost);
    const newAverageCost = newStock > 0 ? newValue / newStock : 0;

    return {
      newStock,
      newValue,
      newAverageCost,
    };
  }

  calculateAvailableQuantity(
    onHand: number,
    reserved: number
  ): number {
    return Math.max(0, onHand - reserved);
  }
}

describe('AVCOCalculator', () => {
  describe('calculateNewAverage()', () => {
    it('should calculate new average cost correctly', () => {
      const calculator = new AVCOCalculator();

      const result = calculator.calculateNewAverage(100, 1000, 50, 25);

      expect(result.newStock).toBe(150);
      expect(result.newValue).toBe(2250); // 1000 + (50 * 25)
      expect(result.newAverageCost).toBe(15); // 2250 / 150
    });

    it('should handle zero current stock', () => {
      const calculator = new AVCOCalculator();

      const result = calculator.calculateNewAverage(0, 0, 100, 10);

      expect(result.newStock).toBe(100);
      expect(result.newValue).toBe(1000);
      expect(result.newAverageCost).toBe(10);
    });

    it('should handle zero incoming quantity', () => {
      const calculator = new AVCOCalculator();

      const result = calculator.calculateNewAverage(100, 1000, 0, 0);

      expect(result.newStock).toBe(100);
      expect(result.newValue).toBe(1000);
      expect(result.newAverageCost).toBe(10);
    });

    it('should handle negative stock (should not happen, but test edge case)', () => {
      const calculator = new AVCOCalculator();

      const result = calculator.calculateNewAverage(-10, -100, 50, 10);

      expect(result.newStock).toBe(40);
      expect(result.newValue).toBe(400);
      expect(result.newAverageCost).toBe(10);
    });
  });

  describe('calculateAvailableQuantity()', () => {
    it('should calculate available quantity correctly', () => {
      const calculator = new AVCOCalculator();

      const available = calculator.calculateAvailableQuantity(100, 30);

      expect(available).toBe(70);
    });

    it('should return zero when reserved equals on hand', () => {
      const calculator = new AVCOCalculator();

      const available = calculator.calculateAvailableQuantity(100, 100);

      expect(available).toBe(0);
    });

    it('should return zero when reserved exceeds on hand', () => {
      const calculator = new AVCOCalculator();

      const available = calculator.calculateAvailableQuantity(100, 150);

      expect(available).toBe(0); // Should not go negative
    });

    it('should handle zero reserved', () => {
      const calculator = new AVCOCalculator();

      const available = calculator.calculateAvailableQuantity(100, 0);

      expect(available).toBe(100);
    });
  });
});

