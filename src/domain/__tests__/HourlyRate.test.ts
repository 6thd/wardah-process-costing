import { describe, it, expect } from 'vitest';
import { HourlyRate } from '../value-objects/HourlyRate';

describe('HourlyRate Value Object', () => {
  describe('creation', () => {
    it('should create HourlyRate with default currency', () => {
      const rate = HourlyRate.of(50);
      expect(rate.rate.amount).toBe(50);
      expect(rate.rate.currency).toBe('SAR');
    });

    it('should create HourlyRate with custom currency', () => {
      const rate = HourlyRate.of(25, 'USD');
      expect(rate.rate.amount).toBe(25);
      expect(rate.rate.currency).toBe('USD');
    });

    it('should throw for zero rate', () => {
      expect(() => HourlyRate.of(0)).toThrow('Hourly rate cannot be zero');
    });

    it('should throw for negative rate', () => {
      expect(() => HourlyRate.of(-10)).toThrow();
    });

    it('should allow decimal rates', () => {
      const rate = HourlyRate.of(25.5, 'SAR');
      expect(rate.rate.amount).toBe(25.5);
    });

    it('should handle integer rates', () => {
      const rate = HourlyRate.of(40, 'SAR');
      expect(rate.rate.amount).toBe(40);
    });

    it('should handle integer rates', () => {
      const rate = HourlyRate.of(40, 'SAR');
      expect(rate.rate.amount).toBe(40);
    });

    it('should handle zero fraction rates', () => {
      const rate = HourlyRate.of(40, 'SAR');
      expect(rate.rate.amount).toBe(40);
    });
  });

  describe('calculateCost', () => {
    it('should calculate cost for whole hours', () => {
      const rate = HourlyRate.of(50, 'SAR');
      const cost = rate.calculateCost(8);
      
      expect(cost.amount).toBe(400);
      expect(cost.currency).toBe('SAR');
    });

    it('should calculate cost for fractional hours', () => {
      const rate = HourlyRate.of(60, 'SAR');
      const cost = rate.calculateCost(1.5);
      
      expect(cost.amount).toBe(90);
    });

    it('should return zero cost for zero hours', () => {
      const rate = HourlyRate.of(50, 'SAR');
      const cost = rate.calculateCost(0);
      
      expect(cost.amount).toBe(0);
    });

    it('should throw for negative hours', () => {
      const rate = HourlyRate.of(50, 'SAR');
      
      expect(() => rate.calculateCost(-5)).toThrow('Hours cannot be negative');
    });

    it('should handle large hour values', () => {
      const rate = HourlyRate.of(100, 'SAR');
      const cost = rate.calculateCost(2000); // 2000 hours
      
      expect(cost.amount).toBe(200000);
    });
  });

  describe('equality', () => {
    it('should be equal with same rate and currency', () => {
      const rate1 = HourlyRate.of(50, 'SAR');
      const rate2 = HourlyRate.of(50, 'SAR');
      
      expect(rate1.equals(rate2)).toBe(true);
    });

    it('should not be equal with different rate', () => {
      const rate1 = HourlyRate.of(50, 'SAR');
      const rate2 = HourlyRate.of(60, 'SAR');
      
      expect(rate1.equals(rate2)).toBe(false);
    });

    it('should not be equal with different currency', () => {
      const rate1 = HourlyRate.of(50, 'SAR');
      const rate2 = HourlyRate.of(50, 'USD');
      
      expect(rate1.equals(rate2)).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should convert to JSON', () => {
      const rate = HourlyRate.of(75, 'SAR');
      const json = rate.toJSON();
      
      expect(json).toEqual({ amount: 75, currency: 'SAR' });
    });

    it('should convert to string with per hour suffix', () => {
      const rate = HourlyRate.of(50, 'SAR');
      const str = rate.toString();
      
      expect(str).toContain('/hour');
      expect(str).toContain('50');
    });
  });

  describe('real-world scenarios', () => {
    it('should calculate full workday cost', () => {
      const rate = HourlyRate.of(45, 'SAR');
      expect(rate.calculateCost(8).amount).toBe(360);
    });

    it('should calculate overtime cost (1.5x)', () => {
      const regularRate = HourlyRate.of(50, 'SAR');
      const overtimeRate = HourlyRate.of(75, 'SAR'); // 1.5x
      
      const regularCost = regularRate.calculateCost(8);
      const overtimeCost = overtimeRate.calculateCost(2);
      
      expect(regularCost.amount).toBe(400);
      expect(overtimeCost.amount).toBe(150);
    });

    it('should handle shift differential rates', () => {
      const nightRate = HourlyRate.of(48, 'SAR'); // 20% differential
      
      expect(nightRate.rate.amount).toBe(48);
    });

    it('should handle shift differential rates', () => {
      const nightRate = HourlyRate.of(48, 'SAR'); // 20% differential
      
      expect(nightRate.rate.amount).toBe(48);
    });

    it('should calculate weekly labor cost', () => {
      const rate = HourlyRate.of(55, 'SAR');
      const weeklyCost = rate.calculateCost(40); // 40 hour week
      
      expect(weeklyCost.amount).toBe(2200);
    });
  });

  describe('immutability', () => {
    it('should return new Money instance when calculating cost', () => {
      const rate = HourlyRate.of(50, 'SAR');
      const cost1 = rate.calculateCost(8);
      const cost2 = rate.calculateCost(4);
      
      expect(cost1.amount).toBe(400);
      expect(cost2.amount).toBe(200);
      expect(cost1).not.toBe(cost2);
    });
  });
});
