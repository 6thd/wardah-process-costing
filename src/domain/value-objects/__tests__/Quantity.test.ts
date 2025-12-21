/**
 * Tests for domain/value-objects/Quantity.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code
 */
import { describe, it, expect } from 'vitest';
import { Quantity } from '../Quantity';

describe('Quantity Value Object', () => {
  describe('creation', () => {
    it('should create Quantity with value and default unit', () => {
      const qty = Quantity.of(100);
      expect(qty.value).toBe(100);
      expect(qty.unit).toBe('units');
    });

    it('should create Quantity with value and specific unit', () => {
      const qty = Quantity.of(100, 'kg');
      expect(qty.value).toBe(100);
      expect(qty.unit).toBe('kg');
    });

    it('should create zero Quantity', () => {
      const qty = Quantity.zero();
      expect(qty.value).toBe(0);
      expect(qty.unit).toBe('units');
    });

    it('should create zero Quantity with specific unit', () => {
      const qty = Quantity.zero('hours');
      expect(qty.value).toBe(0);
      expect(qty.unit).toBe('hours');
    });

    it('should throw for negative value', () => {
      expect(() => Quantity.of(-10)).toThrow('Quantity cannot be negative');
    });

    it('should throw for Infinity', () => {
      expect(() => Quantity.of(Infinity)).toThrow('Quantity must be a finite number');
    });

    it('should throw for NaN', () => {
      expect(() => Quantity.of(NaN)).toThrow('Quantity must be a finite number');
    });

    it('should handle decimal values', () => {
      const qty = Quantity.of(10.5, 'kg');
      expect(qty.value).toBe(10.5);
    });
  });

  describe('add', () => {
    it('should add two Quantities with same unit', () => {
      const q1 = Quantity.of(100, 'kg');
      const q2 = Quantity.of(50, 'kg');
      const result = q1.add(q2);
      expect(result.value).toBe(150);
      expect(result.unit).toBe('kg');
    });

    it('should throw when adding different units', () => {
      const q1 = Quantity.of(100, 'kg');
      const q2 = Quantity.of(50, 'liters');
      expect(() => q1.add(q2)).toThrow('Cannot operate on different units: kg and liters');
    });

    it('should be immutable', () => {
      const q1 = Quantity.of(100);
      const q2 = Quantity.of(50);
      q1.add(q2);
      expect(q1.value).toBe(100);
    });
  });

  describe('subtract', () => {
    it('should subtract two Quantities with same unit', () => {
      const q1 = Quantity.of(100, 'kg');
      const q2 = Quantity.of(30, 'kg');
      const result = q1.subtract(q2);
      expect(result.value).toBe(70);
    });

    it('should throw for negative result', () => {
      const q1 = Quantity.of(30);
      const q2 = Quantity.of(100);
      expect(() => q1.subtract(q2)).toThrow('Subtraction would result in negative quantity');
    });

    it('should throw when subtracting different units', () => {
      const q1 = Quantity.of(100, 'kg');
      const q2 = Quantity.of(50, 'units');
      expect(() => q1.subtract(q2)).toThrow('Cannot operate on different units');
    });
  });

  describe('multiply', () => {
    it('should multiply by positive factor', () => {
      const qty = Quantity.of(10, 'kg');
      const result = qty.multiply(3);
      expect(result.value).toBe(30);
    });

    it('should multiply by zero', () => {
      const qty = Quantity.of(100);
      const result = qty.multiply(0);
      expect(result.value).toBe(0);
    });

    it('should multiply by decimal', () => {
      const qty = Quantity.of(100);
      const result = qty.multiply(0.5);
      expect(result.value).toBe(50);
    });

    it('should throw for negative factor', () => {
      const qty = Quantity.of(100);
      expect(() => qty.multiply(-2)).toThrow('Cannot multiply by negative factor');
    });
  });

  describe('divide', () => {
    it('should divide by positive divisor', () => {
      const qty = Quantity.of(100);
      const result = qty.divide(4);
      expect(result.value).toBe(25);
    });

    it('should throw for division by zero', () => {
      const qty = Quantity.of(100);
      expect(() => qty.divide(0)).toThrow('Cannot divide by zero');
    });

    it('should throw for negative divisor', () => {
      const qty = Quantity.of(100);
      expect(() => qty.divide(-2)).toThrow('Cannot divide by negative divisor');
    });

    it('should handle decimal results', () => {
      const qty = Quantity.of(100);
      const result = qty.divide(3);
      expect(result.value).toBeCloseTo(33.333, 2);
    });
  });

  describe('comparison methods', () => {
    it('isZero should return true for zero value', () => {
      expect(Quantity.zero().isZero()).toBe(true);
      expect(Quantity.of(0).isZero()).toBe(true);
    });

    it('isZero should return false for non-zero value', () => {
      expect(Quantity.of(100).isZero()).toBe(false);
      expect(Quantity.of(0.01).isZero()).toBe(false);
    });

    it('isGreaterThan should compare correctly', () => {
      const q1 = Quantity.of(100);
      const q2 = Quantity.of(50);
      expect(q1.isGreaterThan(q2)).toBe(true);
      expect(q2.isGreaterThan(q1)).toBe(false);
    });

    it('isGreaterThan should throw for different units', () => {
      const q1 = Quantity.of(100, 'kg');
      const q2 = Quantity.of(50, 'liters');
      expect(() => q1.isGreaterThan(q2)).toThrow('Cannot operate on different units');
    });

    it('isLessThan should compare correctly', () => {
      const q1 = Quantity.of(50);
      const q2 = Quantity.of(100);
      expect(q1.isLessThan(q2)).toBe(true);
      expect(q2.isLessThan(q1)).toBe(false);
    });

    it('isLessThan should throw for different units', () => {
      const q1 = Quantity.of(50, 'kg');
      const q2 = Quantity.of(100, 'liters');
      expect(() => q1.isLessThan(q2)).toThrow('Cannot operate on different units');
    });

    it('equals should compare value and unit', () => {
      const q1 = Quantity.of(100, 'kg');
      const q2 = Quantity.of(100, 'kg');
      const q3 = Quantity.of(100, 'liters');
      const q4 = Quantity.of(50, 'kg');

      expect(q1.equals(q2)).toBe(true);
      expect(q1.equals(q3)).toBe(false); // Different unit
      expect(q1.equals(q4)).toBe(false); // Different value
    });
  });

  describe('serialization', () => {
    it('toJSON should return object with value and unit', () => {
      const qty = Quantity.of(99.5, 'kg');
      const json = qty.toJSON();
      expect(json).toEqual({ value: 99.5, unit: 'kg' });
    });

    it('toString should format with unit', () => {
      const qty = Quantity.of(100, 'kg');
      expect(qty.toString()).toBe('100 kg');
    });

    it('toString should handle decimals', () => {
      const qty = Quantity.of(99.9, 'liters');
      expect(qty.toString()).toBe('99.9 liters');
    });
  });

  describe('chained operations', () => {
    it('should support chained add operations', () => {
      const result = Quantity.of(100)
        .add(Quantity.of(50))
        .add(Quantity.of(25));
      expect(result.value).toBe(175);
    });

    it('should support mixed chained operations', () => {
      const result = Quantity.of(100)
        .add(Quantity.of(50))
        .multiply(2)
        .subtract(Quantity.of(100));
      expect(result.value).toBe(200);
    });
  });
});
