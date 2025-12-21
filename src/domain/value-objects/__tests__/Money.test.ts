/**
 * Tests for domain/value-objects/Money.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code
 */
import { describe, it, expect } from 'vitest';
import { Money } from '../Money';

describe('Money Value Object', () => {
  describe('creation', () => {
    it('should create Money with amount and default currency', () => {
      const money = Money.of(100);
      expect(money.amount).toBe(100);
      expect(money.currency).toBe('SAR');
    });

    it('should create Money with amount and specific currency', () => {
      const money = Money.of(100, 'USD');
      expect(money.amount).toBe(100);
      expect(money.currency).toBe('USD');
    });

    it('should create zero Money', () => {
      const money = Money.zero();
      expect(money.amount).toBe(0);
      expect(money.currency).toBe('SAR');
    });

    it('should create zero Money with specific currency', () => {
      const money = Money.zero('EUR');
      expect(money.amount).toBe(0);
      expect(money.currency).toBe('EUR');
    });

    it('should throw for negative amount', () => {
      expect(() => Money.of(-100)).toThrow('Money amount cannot be negative');
    });

    it('should throw for Infinity', () => {
      expect(() => Money.of(Infinity)).toThrow('Money amount must be a finite number');
    });

    it('should throw for NaN', () => {
      expect(() => Money.of(NaN)).toThrow('Money amount must be a finite number');
    });

    it('should handle decimal amounts', () => {
      const money = Money.of(99.99);
      expect(money.amount).toBe(99.99);
    });
  });

  describe('add', () => {
    it('should add two Money objects with same currency', () => {
      const m1 = Money.of(100);
      const m2 = Money.of(50);
      const result = m1.add(m2);
      expect(result.amount).toBe(150);
      expect(result.currency).toBe('SAR');
    });

    it('should throw when adding different currencies', () => {
      const m1 = Money.of(100, 'SAR');
      const m2 = Money.of(50, 'USD');
      expect(() => m1.add(m2)).toThrow('Cannot operate on different currencies: SAR and USD');
    });

    it('should be immutable', () => {
      const m1 = Money.of(100);
      const m2 = Money.of(50);
      m1.add(m2);
      expect(m1.amount).toBe(100);
    });
  });

  describe('subtract', () => {
    it('should subtract two Money objects with same currency', () => {
      const m1 = Money.of(100);
      const m2 = Money.of(30);
      const result = m1.subtract(m2);
      expect(result.amount).toBe(70);
    });

    it('should throw for negative result', () => {
      const m1 = Money.of(30);
      const m2 = Money.of(100);
      expect(() => m1.subtract(m2)).toThrow('Subtraction would result in negative amount');
    });

    it('should throw when subtracting different currencies', () => {
      const m1 = Money.of(100, 'SAR');
      const m2 = Money.of(50, 'USD');
      expect(() => m1.subtract(m2)).toThrow('Cannot operate on different currencies');
    });
  });

  describe('multiply', () => {
    it('should multiply by positive factor', () => {
      const money = Money.of(100);
      const result = money.multiply(3);
      expect(result.amount).toBe(300);
    });

    it('should multiply by zero', () => {
      const money = Money.of(100);
      const result = money.multiply(0);
      expect(result.amount).toBe(0);
    });

    it('should multiply by decimal', () => {
      const money = Money.of(100);
      const result = money.multiply(0.5);
      expect(result.amount).toBe(50);
    });

    it('should throw for negative factor', () => {
      const money = Money.of(100);
      expect(() => money.multiply(-2)).toThrow('Cannot multiply by negative factor');
    });
  });

  describe('divide', () => {
    it('should divide by positive divisor', () => {
      const money = Money.of(100);
      const result = money.divide(4);
      expect(result.amount).toBe(25);
    });

    it('should throw for division by zero', () => {
      const money = Money.of(100);
      expect(() => money.divide(0)).toThrow('Cannot divide by zero');
    });

    it('should throw for negative divisor', () => {
      const money = Money.of(100);
      expect(() => money.divide(-2)).toThrow('Cannot divide by negative divisor');
    });

    it('should handle decimal results', () => {
      const money = Money.of(100);
      const result = money.divide(3);
      expect(result.amount).toBeCloseTo(33.333, 2);
    });
  });

  describe('comparison methods', () => {
    it('isZero should return true for zero amount', () => {
      expect(Money.zero().isZero()).toBe(true);
      expect(Money.of(0).isZero()).toBe(true);
    });

    it('isZero should return false for non-zero amount', () => {
      expect(Money.of(100).isZero()).toBe(false);
      expect(Money.of(0.01).isZero()).toBe(false);
    });

    it('isGreaterThan should compare correctly', () => {
      const m1 = Money.of(100);
      const m2 = Money.of(50);
      expect(m1.isGreaterThan(m2)).toBe(true);
      expect(m2.isGreaterThan(m1)).toBe(false);
    });

    it('isGreaterThan should throw for different currencies', () => {
      const m1 = Money.of(100, 'SAR');
      const m2 = Money.of(50, 'USD');
      expect(() => m1.isGreaterThan(m2)).toThrow('Cannot operate on different currencies');
    });

    it('isLessThan should compare correctly', () => {
      const m1 = Money.of(50);
      const m2 = Money.of(100);
      expect(m1.isLessThan(m2)).toBe(true);
      expect(m2.isLessThan(m1)).toBe(false);
    });

    it('isLessThan should throw for different currencies', () => {
      const m1 = Money.of(50, 'SAR');
      const m2 = Money.of(100, 'USD');
      expect(() => m1.isLessThan(m2)).toThrow('Cannot operate on different currencies');
    });

    it('equals should compare amount and currency', () => {
      const m1 = Money.of(100, 'SAR');
      const m2 = Money.of(100, 'SAR');
      const m3 = Money.of(100, 'USD');
      const m4 = Money.of(50, 'SAR');

      expect(m1.equals(m2)).toBe(true);
      expect(m1.equals(m3)).toBe(false); // Different currency
      expect(m1.equals(m4)).toBe(false); // Different amount
    });
  });

  describe('serialization', () => {
    it('toJSON should return object with amount and currency', () => {
      const money = Money.of(99.99, 'USD');
      const json = money.toJSON();
      expect(json).toEqual({ amount: 99.99, currency: 'USD' });
    });

    it('toString should format with 2 decimal places', () => {
      const money = Money.of(100, 'SAR');
      expect(money.toString()).toBe('100.00 SAR');
    });

    it('toString should handle decimals', () => {
      const money = Money.of(99.9, 'USD');
      expect(money.toString()).toBe('99.90 USD');
    });
  });

  describe('chained operations', () => {
    it('should support chained add operations', () => {
      const result = Money.of(100)
        .add(Money.of(50))
        .add(Money.of(25));
      expect(result.amount).toBe(175);
    });

    it('should support mixed chained operations', () => {
      const result = Money.of(100)
        .add(Money.of(50))
        .multiply(2)
        .subtract(Money.of(100));
      expect(result.amount).toBe(200);
    });
  });
});
