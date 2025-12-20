import { describe, it, expect } from 'vitest';
import { Quantity } from '../value-objects/Quantity';

describe('Quantity Value Object', () => {
  describe('creation', () => {
    it('should create Quantity with value and default unit', () => {
      const qty = Quantity.of(10);
      expect(qty.value).toBe(10);
      expect(qty.unit).toBe('units');
    });

    it('should create Quantity with custom unit', () => {
      const qty = Quantity.of(5, 'hours');
      expect(qty.value).toBe(5);
      expect(qty.unit).toBe('hours');
    });

    it('should create zero Quantity', () => {
      const qty = Quantity.zero();
      expect(qty.value).toBe(0);
      expect(qty.isZero()).toBe(true);
    });

    it('should create zero with custom unit', () => {
      const qty = Quantity.zero('kg');
      expect(qty.value).toBe(0);
      expect(qty.unit).toBe('kg');
    });

    it('should throw for negative value', () => {
      expect(() => Quantity.of(-5)).toThrow('Quantity cannot be negative');
    });

    it('should throw for infinity', () => {
      expect(() => Quantity.of(Infinity)).toThrow('Quantity must be a finite number');
    });

    it('should throw for NaN', () => {
      expect(() => Quantity.of(NaN)).toThrow('Quantity must be a finite number');
    });

    it('should allow decimal values', () => {
      const qty = Quantity.of(2.5, 'hours');
      expect(qty.value).toBe(2.5);
    });
  });

  describe('arithmetic operations', () => {
    describe('add', () => {
      it('should add two quantities with same unit', () => {
        const q1 = Quantity.of(10, 'units');
        const q2 = Quantity.of(5, 'units');
        const result = q1.add(q2);
        
        expect(result.value).toBe(15);
        expect(result.unit).toBe('units');
      });

      it('should throw when adding different units', () => {
        const q1 = Quantity.of(10, 'hours');
        const q2 = Quantity.of(5, 'kg');

        expect(() => q1.add(q2)).toThrow('Cannot operate on different units');
      });
    });

    describe('subtract', () => {
      it('should subtract quantities', () => {
        const q1 = Quantity.of(10, 'units');
        const q2 = Quantity.of(3, 'units');
        const result = q1.subtract(q2);
        
        expect(result.value).toBe(7);
      });

      it('should throw when subtraction results in negative', () => {
        const q1 = Quantity.of(3, 'units');
        const q2 = Quantity.of(10, 'units');
        
        expect(() => q1.subtract(q2)).toThrow('Subtraction would result in negative');
      });

      it('should throw for different units', () => {
        const q1 = Quantity.of(10, 'hours');
        const q2 = Quantity.of(3, 'kg');

        expect(() => q1.subtract(q2)).toThrow('Cannot operate on different units');
      });
    });

    describe('multiply', () => {
      it('should multiply by a factor', () => {
        const qty = Quantity.of(10, 'units');
        const result = qty.multiply(3);
        
        expect(result.value).toBe(30);
        expect(result.unit).toBe('units');
      });

      it('should handle decimal factors', () => {
        const qty = Quantity.of(10, 'hours');
        const result = qty.multiply(1.5);
        
        expect(result.value).toBe(15);
      });

      it('should throw for negative factor', () => {
        const qty = Quantity.of(10, 'units');
        
        expect(() => qty.multiply(-2)).toThrow('Cannot multiply by negative');
      });

      it('should return zero when multiplied by zero', () => {
        const qty = Quantity.of(10, 'units');
        const result = qty.multiply(0);
        
        expect(result.value).toBe(0);
      });
    });

    describe('divide', () => {
      it('should divide by a divisor', () => {
        const qty = Quantity.of(20, 'units');
        const result = qty.divide(4);
        
        expect(result.value).toBe(5);
      });

      it('should handle decimal results', () => {
        const qty = Quantity.of(10, 'hours');
        const result = qty.divide(3);
        
        expect(result.value).toBeCloseTo(3.333, 2);
      });

      it('should throw when dividing by zero', () => {
        const qty = Quantity.of(10, 'units');
        
        expect(() => qty.divide(0)).toThrow('Cannot divide by zero');
      });

      it('should throw for negative divisor', () => {
        const qty = Quantity.of(10, 'units');
        
        expect(() => qty.divide(-2)).toThrow('Cannot divide by negative');
      });
    });
  });

  describe('comparison operations', () => {
    it('should check if zero', () => {
      expect(Quantity.of(0).isZero()).toBe(true);
      expect(Quantity.of(10).isZero()).toBe(false);
    });

    it('should compare greater than', () => {
      const q1 = Quantity.of(10, 'units');
      const q2 = Quantity.of(5, 'units');
      
      expect(q1.isGreaterThan(q2)).toBe(true);
      expect(q2.isGreaterThan(q1)).toBe(false);
      expect(q1.isGreaterThan(Quantity.of(10, 'units'))).toBe(false); // equal
    });

    it('should compare less than', () => {
      const q1 = Quantity.of(5, 'units');
      const q2 = Quantity.of(10, 'units');
      
      expect(q1.isLessThan(q2)).toBe(true);
      expect(q2.isLessThan(q1)).toBe(false);
      expect(q1.isLessThan(Quantity.of(5, 'units'))).toBe(false); // equal
    });

    it('should check equality', () => {
      const q1 = Quantity.of(10, 'units');
      const q2 = Quantity.of(10, 'units');
      const q3 = Quantity.of(10, 'kg');
      const q4 = Quantity.of(5, 'units');
      
      expect(q1.equals(q2)).toBe(true);
      expect(q1.equals(q3)).toBe(false); // Different unit
      expect(q1.equals(q4)).toBe(false); // Different value
    });

    it('should throw for comparison with different units', () => {
      const q1 = Quantity.of(10, 'hours');
      const q2 = Quantity.of(5, 'kg');

      expect(() => q1.isGreaterThan(q2)).toThrow('Cannot operate on different units');
      expect(() => q1.isLessThan(q2)).toThrow('Cannot operate on different units');
    });
  });

  describe('serialization', () => {
    it('should convert to JSON', () => {
      const qty = Quantity.of(10, 'hours');
      const json = qty.toJSON();
      
      expect(json).toEqual({ value: 10, unit: 'hours' });
    });

    it('should convert to string', () => {
      const qty = Quantity.of(10.5, 'hours');
      const str = qty.toString();
      
      expect(str).toContain('10.5');
      expect(str).toContain('hours');
    });
  });

  describe('immutability', () => {
    it('should not modify original when adding', () => {
      const original = Quantity.of(10, 'units');
      const result = original.add(Quantity.of(5, 'units'));
      
      expect(original.value).toBe(10);
      expect(result.value).toBe(15);
    });

    it('should not modify original when multiplying', () => {
      const original = Quantity.of(10, 'units');
      const result = original.multiply(2);
      
      expect(original.value).toBe(10);
      expect(result.value).toBe(20);
    });
  });

  describe('common manufacturing units', () => {
    it('should handle kg units', () => {
      const weight = Quantity.of(100, 'kg');
      expect(weight.unit).toBe('kg');
    });

    it('should handle liters', () => {
      const volume = Quantity.of(50, 'liters');
      expect(volume.unit).toBe('liters');
    });

    it('should handle pieces', () => {
      const pieces = Quantity.of(1000, 'pieces');
      expect(pieces.unit).toBe('pieces');
    });

    it('should handle meters', () => {
      const length = Quantity.of(25.5, 'm');
      expect(length.unit).toBe('m');
    });
  });
});
