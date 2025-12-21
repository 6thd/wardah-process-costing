/**
 * Tests for domain/value-objects/HourlyRate.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code
 */
import { describe, it, expect } from 'vitest';
import { HourlyRate } from '../HourlyRate';
import { Money } from '../Money';

describe('HourlyRate Value Object', () => {
  describe('creation', () => {
    it('should create HourlyRate with amount and default currency', () => {
      const rate = HourlyRate.of(50);
      expect(rate.rate.amount).toBe(50);
      expect(rate.rate.currency).toBe('SAR');
    });

    it('should create HourlyRate with amount and specific currency', () => {
      const rate = HourlyRate.of(100, 'USD');
      expect(rate.rate.amount).toBe(100);
      expect(rate.rate.currency).toBe('USD');
    });

    it('should throw for zero rate', () => {
      expect(() => HourlyRate.of(0)).toThrow('Hourly rate cannot be zero');
    });

    it('should handle decimal rates', () => {
      const rate = HourlyRate.of(25.50);
      expect(rate.rate.amount).toBe(25.50);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for whole hours', () => {
      const rate = HourlyRate.of(50);
      const cost = rate.calculateCost(8);
      expect(cost.amount).toBe(400);
    });

    it('should calculate cost for fractional hours', () => {
      const rate = HourlyRate.of(60);
      const cost = rate.calculateCost(1.5);
      expect(cost.amount).toBe(90);
    });

    it('should return zero cost for zero hours', () => {
      const rate = HourlyRate.of(50);
      const cost = rate.calculateCost(0);
      expect(cost.amount).toBe(0);
    });

    it('should throw for negative hours', () => {
      const rate = HourlyRate.of(50);
      expect(() => rate.calculateCost(-2)).toThrow('Hours cannot be negative');
    });

    it('should preserve currency', () => {
      const rate = HourlyRate.of(100, 'USD');
      const cost = rate.calculateCost(5);
      expect(cost.currency).toBe('USD');
    });
  });

  describe('equals', () => {
    it('should return true for equal rates', () => {
      const r1 = HourlyRate.of(50, 'SAR');
      const r2 = HourlyRate.of(50, 'SAR');
      expect(r1.equals(r2)).toBe(true);
    });

    it('should return false for different amounts', () => {
      const r1 = HourlyRate.of(50);
      const r2 = HourlyRate.of(60);
      expect(r1.equals(r2)).toBe(false);
    });

    it('should return false for different currencies', () => {
      const r1 = HourlyRate.of(50, 'SAR');
      const r2 = HourlyRate.of(50, 'USD');
      expect(r1.equals(r2)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('toJSON should return amount and currency', () => {
      const rate = HourlyRate.of(75, 'EUR');
      const json = rate.toJSON();
      expect(json).toEqual({ amount: 75, currency: 'EUR' });
    });

    it('toString should format with /hour suffix', () => {
      const rate = HourlyRate.of(50, 'SAR');
      expect(rate.toString()).toBe('50.00 SAR/hour');
    });
  });

  describe('integration with Money', () => {
    it('cost should be a Money instance', () => {
      const rate = HourlyRate.of(50);
      const cost = rate.calculateCost(8);
      expect(cost).toBeInstanceOf(Money);
    });

    it('rate should be a Money instance', () => {
      const rate = HourlyRate.of(50);
      expect(rate.rate).toBeInstanceOf(Money);
    });
  });
});
