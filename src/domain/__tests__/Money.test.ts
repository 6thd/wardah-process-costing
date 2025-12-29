import { describe, it, expect } from 'vitest';
import { Money } from '../value-objects/Money';

describe('Money Value Object', () => {
  describe('creation', () => {
    it('should create Money with amount and default currency', () => {
      const money = Money.of(100);
      expect(money.amount).toBe(100);
      expect(money.currency).toBe('SAR');
    });

    it('should create Money with custom currency', () => {
      const money = Money.of(50, 'USD');
      expect(money.amount).toBe(50);
      expect(money.currency).toBe('USD');
    });

    it('should create zero Money', () => {
      const money = Money.zero();
      expect(money.amount).toBe(0);
      expect(money.isZero()).toBe(true);
    });

    it('should throw for negative amount', () => {
      expect(() => Money.of(-100)).toThrow('Money amount cannot be negative');
    });

    it('should throw for infinity', () => {
      expect(() => Money.of(Infinity)).toThrow('Money amount must be a finite number');
    });

    it('should throw for NaN', () => {
      expect(() => Money.of(Number.NaN)).toThrow('Money amount must be a finite number');
    });
  });

  describe('arithmetic operations', () => {
    describe('add', () => {
      it('should add two Money values with same currency', () => {
        const m1 = Money.of(100, 'SAR');
        const m2 = Money.of(50, 'SAR');
        const result = m1.add(m2);
        
        expect(result.amount).toBe(150);
        expect(result.currency).toBe('SAR');
      });

      it('should throw when adding different currencies', () => {
        const m1 = Money.of(100, 'SAR');
        const m2 = Money.of(50, 'USD');
        
        expect(() => m1.add(m2)).toThrow('Cannot operate on different currencies');
      });
    });

    describe('subtract', () => {
      it('should subtract Money values', () => {
        const m1 = Money.of(100, 'SAR');
        const m2 = Money.of(30, 'SAR');
        const result = m1.subtract(m2);
        
        expect(result.amount).toBe(70);
      });

      it('should throw when subtraction results in negative', () => {
        const m1 = Money.of(30, 'SAR');
        const m2 = Money.of(100, 'SAR');
        
        expect(() => m1.subtract(m2)).toThrow('Subtraction would result in negative');
      });

      it('should throw for different currencies', () => {
        const m1 = Money.of(100, 'SAR');
        const m2 = Money.of(30, 'USD');
        
        expect(() => m1.subtract(m2)).toThrow('Cannot operate on different currencies');
      });
    });

    describe('multiply', () => {
      it('should multiply by a factor', () => {
        const money = Money.of(100, 'SAR');
        const result = money.multiply(3);
        
        expect(result.amount).toBe(300);
      });

      it('should handle decimal factors', () => {
        const money = Money.of(100, 'SAR');
        const result = money.multiply(0.5);
        
        expect(result.amount).toBe(50);
      });

      it('should throw for negative factor', () => {
        const money = Money.of(100, 'SAR');
        
        expect(() => money.multiply(-2)).toThrow('Cannot multiply by negative');
      });
    });

    describe('divide', () => {
      it('should divide by a divisor', () => {
        const money = Money.of(100, 'SAR');
        const result = money.divide(4);
        
        expect(result.amount).toBe(25);
      });

      it('should throw when dividing by zero', () => {
        const money = Money.of(100, 'SAR');
        
        expect(() => money.divide(0)).toThrow('Cannot divide by zero');
      });

      it('should throw for negative divisor', () => {
        const money = Money.of(100, 'SAR');
        
        expect(() => money.divide(-2)).toThrow('Cannot divide by negative');
      });
    });
  });

  describe('comparison operations', () => {
    it('should check if zero', () => {
      expect(Money.of(0).isZero()).toBe(true);
      expect(Money.of(100).isZero()).toBe(false);
    });

    it('should compare greater than', () => {
      const m1 = Money.of(100, 'SAR');
      const m2 = Money.of(50, 'SAR');
      
      expect(m1.isGreaterThan(m2)).toBe(true);
      expect(m2.isGreaterThan(m1)).toBe(false);
    });

    it('should compare less than', () => {
      const m1 = Money.of(50, 'SAR');
      const m2 = Money.of(100, 'SAR');
      
      expect(m1.isLessThan(m2)).toBe(true);
      expect(m2.isLessThan(m1)).toBe(false);
    });

    it('should check equality', () => {
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
    it('should convert to JSON', () => {
      const money = Money.of(100, 'SAR');
      const json = money.toJSON();
      
      expect(json).toEqual({ amount: 100, currency: 'SAR' });
    });

    it('should convert to string', () => {
      const money = Money.of(1234.56, 'SAR');
      const str = money.toString();
      
      expect(str).toContain('1234.56');
      expect(str).toContain('SAR');
    });
  });

  describe('immutability', () => {
    it('should not modify original when adding', () => {
      const original = Money.of(100, 'SAR');
      const result = original.add(Money.of(50, 'SAR'));
      
      expect(original.amount).toBe(100);
      expect(result.amount).toBe(150);
    });

    it('should not modify original when multiplying', () => {
      const original = Money.of(100, 'SAR');
      const result = original.multiply(2);
      
      expect(original.amount).toBe(100);
      expect(result.amount).toBe(200);
    });
  });
});
