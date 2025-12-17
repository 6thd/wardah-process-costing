/**
 * Core Utils Tests
 * Tests for formatting and validation utilities
 */

import { describe, it, expect, vi } from 'vitest';
import {
  formatCurrency,
  formatNumber,
  formatQuantity,
  formatDate,
  formatDateTime,
  validateRequired,
  validatePositiveNumber,
  validateEmail,
  validateStageNumber,
} from '../utils';

describe('Core Utils', () => {
  describe('formatCurrency', () => {
    it('should format currency and return a string', () => {
      const result = formatCurrency(1000);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('-');
    });

    it('should return dash for null value', () => {
      expect(formatCurrency(null)).toBe('-');
    });

    it('should return dash for undefined value', () => {
      expect(formatCurrency(undefined)).toBe('-');
    });

    it('should format with custom currency', () => {
      const result = formatCurrency(100, 'USD', 'en-US');
      expect(result).toContain('$');
    });

    it('should handle zero amount', () => {
      const result = formatCurrency(0);
      expect(result).not.toBe('-');
    });

    it('should handle negative amounts', () => {
      const result = formatCurrency(-500);
      expect(typeof result).toBe('string');
    });

    it('should handle decimal amounts', () => {
      const result = formatCurrency(99.99);
      expect(typeof result).toBe('string');
    });
  });

  describe('formatNumber', () => {
    it('should format number and return a string', () => {
      const result = formatNumber(1234.567);
      expect(typeof result).toBe('string');
    });

    it('should return dash for null', () => {
      expect(formatNumber(null)).toBe('-');
    });

    it('should return dash for undefined', () => {
      expect(formatNumber(undefined)).toBe('-');
    });

    it('should format with custom precision', () => {
      const result = formatNumber(100.123456, 4);
      expect(typeof result).toBe('string');
    });

    it('should handle zero', () => {
      const result = formatNumber(0);
      expect(result).not.toBe('-');
    });
  });

  describe('formatQuantity', () => {
    it('should format quantity and return a string', () => {
      const result = formatQuantity(50);
      expect(typeof result).toBe('string');
      expect(result).not.toBe('-');
    });

    it('should format quantity with unit', () => {
      const result = formatQuantity(50, 'kg');
      expect(result).toContain('kg');
    });

    it('should return dash for null', () => {
      expect(formatQuantity(null)).toBe('-');
    });

    it('should return dash for undefined', () => {
      expect(formatQuantity(undefined)).toBe('-');
    });

    it('should format with custom precision', () => {
      const result = formatQuantity(100.5678, 'pcs', 3);
      expect(result).toContain('pcs');
    });
  });

  describe('formatDate', () => {
    it('should format valid date', () => {
      const result = formatDate('2024-01-15');
      expect(result).not.toBe('-');
    });

    it('should return dash for null', () => {
      expect(formatDate(null)).toBe('-');
    });

    it('should return dash for undefined', () => {
      expect(formatDate(undefined)).toBe('-');
    });

    it('should return dash for empty string', () => {
      expect(formatDate('')).toBe('-');
    });

    it('should format Date object', () => {
      const date = new Date('2024-06-15');
      const result = formatDate(date);
      expect(result).not.toBe('-');
    });
  });

  describe('formatDateTime', () => {
    it('should format valid datetime', () => {
      const result = formatDateTime('2024-01-15T10:30:00');
      expect(result).not.toBe('-');
    });

    it('should return dash for null', () => {
      expect(formatDateTime(null)).toBe('-');
    });

    it('should return dash for undefined', () => {
      expect(formatDateTime(undefined)).toBe('-');
    });

    it('should return dash for empty string', () => {
      expect(formatDateTime('')).toBe('-');
    });

    it('should format Date object', () => {
      const date = new Date('2024-06-15T14:30:00');
      const result = formatDateTime(date);
      expect(result).not.toBe('-');
    });
  });

  describe('validateRequired', () => {
    it('should pass for valid string', () => {
      expect(() => validateRequired('test', 'Field')).not.toThrow();
    });

    it('should pass for valid number', () => {
      expect(() => validateRequired(123, 'Field')).not.toThrow();
    });

    it('should pass for zero (valid number)', () => {
      expect(() => validateRequired(0, 'Field')).not.toThrow();
    });

    it('should throw for null', () => {
      expect(() => validateRequired(null, 'Field')).toThrow('Field is required');
    });

    it('should throw for undefined', () => {
      expect(() => validateRequired(undefined, 'Field')).toThrow('Field is required');
    });

    it('should throw for empty string', () => {
      expect(() => validateRequired('', 'Field')).toThrow('Field is required');
    });
  });

  describe('validatePositiveNumber', () => {
    it('should pass for positive number', () => {
      expect(() => validatePositiveNumber(100, 'Amount')).not.toThrow();
    });

    it('should pass for zero', () => {
      expect(() => validatePositiveNumber(0, 'Amount')).not.toThrow();
    });

    it('should throw for negative number', () => {
      expect(() => validatePositiveNumber(-5, 'Amount')).toThrow('Amount must be a positive number');
    });

    it('should throw for NaN', () => {
      expect(() => validatePositiveNumber(NaN, 'Amount')).toThrow('Amount must be a positive number');
    });

    it('should throw for null', () => {
      expect(() => validatePositiveNumber(null, 'Amount')).toThrow('Amount is required');
    });
  });

  describe('validateEmail', () => {
    it('should pass for valid email', () => {
      expect(() => validateEmail('test@example.com')).not.toThrow();
    });

    it('should pass for email with subdomain', () => {
      expect(() => validateEmail('user@mail.example.com')).not.toThrow();
    });

    it('should throw for email without @', () => {
      expect(() => validateEmail('testexample.com')).toThrow('Invalid email format');
    });

    it('should throw for email without domain', () => {
      expect(() => validateEmail('test@')).toThrow('Invalid email format');
    });

    it('should throw for email without username', () => {
      expect(() => validateEmail('@example.com')).toThrow('Invalid email format');
    });

    it('should throw for empty string', () => {
      expect(() => validateEmail('')).toThrow('Invalid email format');
    });
  });

  describe('validateStageNumber', () => {
    it('should pass for positive integer', () => {
      expect(() => validateStageNumber(1)).not.toThrow();
      expect(() => validateStageNumber(5)).not.toThrow();
      expect(() => validateStageNumber(100)).not.toThrow();
    });

    it('should throw for zero', () => {
      expect(() => validateStageNumber(0)).toThrow('Stage number must be a positive integer');
    });

    it('should throw for negative number', () => {
      expect(() => validateStageNumber(-1)).toThrow('Stage number must be a positive integer');
    });

    it('should throw for decimal number', () => {
      expect(() => validateStageNumber(1.5)).toThrow('Stage number must be a positive integer');
    });

    it('should throw for null', () => {
      expect(() => validateStageNumber(null)).toThrow('Stage number is required');
    });

    it('should throw for undefined', () => {
      expect(() => validateStageNumber(undefined)).toThrow('Stage number is required');
    });
  });
});
