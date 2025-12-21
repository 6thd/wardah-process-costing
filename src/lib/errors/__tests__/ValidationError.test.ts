/**
 * Tests for lib/errors/ValidationError.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code
 */
import { describe, it, expect } from 'vitest';
import { ValidationError, type FieldError } from '../ValidationError';

describe('ValidationError', () => {
  describe('creation', () => {
    it('should create ValidationError with message', () => {
      const error = new ValidationError('Invalid input');
      
      expect(error.message).toBe('Invalid input');
      expect(error.name).toBe('ValidationError');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
    });

    it('should create ValidationError with field errors', () => {
      const fieldErrors: FieldError[] = [
        { field: 'email', message: 'Invalid email format' },
        { field: 'password', message: 'Password too short' }
      ];
      const error = new ValidationError('Validation failed', fieldErrors);
      
      expect(error.errors).toHaveLength(2);
      expect(error.errors[0].field).toBe('email');
      expect(error.errors[1].field).toBe('password');
    });

    it('should create ValidationError with empty errors by default', () => {
      const error = new ValidationError('Error');
      expect(error.errors).toEqual([]);
    });

    it('should be operational error', () => {
      const error = new ValidationError('Error');
      expect(error.isOperational).toBe(true);
    });
  });

  describe('addError', () => {
    it('should add field error', () => {
      const error = new ValidationError('Validation failed');
      error.addError('name', 'Name is required');
      
      expect(error.errors).toHaveLength(1);
      expect(error.errors[0].field).toBe('name');
      expect(error.errors[0].message).toBe('Name is required');
    });

    it('should add field error with code', () => {
      const error = new ValidationError('Validation failed');
      error.addError('email', 'Invalid format', 'INVALID_EMAIL');
      
      expect(error.errors[0].code).toBe('INVALID_EMAIL');
    });

    it('should add multiple errors', () => {
      const error = new ValidationError('Validation failed');
      error.addError('name', 'Name required');
      error.addError('email', 'Email required');
      error.addError('password', 'Password required');
      
      expect(error.errors).toHaveLength(3);
    });
  });

  describe('hasError', () => {
    it('should return true for existing field', () => {
      const error = new ValidationError('Error', [
        { field: 'email', message: 'Invalid' }
      ]);
      
      expect(error.hasError('email')).toBe(true);
    });

    it('should return false for non-existing field', () => {
      const error = new ValidationError('Error', [
        { field: 'email', message: 'Invalid' }
      ]);
      
      expect(error.hasError('password')).toBe(false);
    });

    it('should return false for empty errors', () => {
      const error = new ValidationError('Error');
      expect(error.hasError('any')).toBe(false);
    });
  });

  describe('getError', () => {
    it('should return message for existing field', () => {
      const error = new ValidationError('Error', [
        { field: 'email', message: 'Invalid email format' }
      ]);
      
      expect(error.getError('email')).toBe('Invalid email format');
    });

    it('should return undefined for non-existing field', () => {
      const error = new ValidationError('Error', [
        { field: 'email', message: 'Invalid' }
      ]);
      
      expect(error.getError('password')).toBeUndefined();
    });

    it('should return first error if field has multiple errors', () => {
      const error = new ValidationError('Error');
      error.addError('email', 'First error');
      error.addError('email', 'Second error');
      
      expect(error.getError('email')).toBe('First error');
    });
  });

  describe('inheritance', () => {
    it('should be instance of Error', () => {
      const error = new ValidationError('Error');
      expect(error).toBeInstanceOf(Error);
    });

    it('should have proper stack trace', () => {
      const error = new ValidationError('Error');
      expect(error.stack).toBeDefined();
      expect(typeof error.stack).toBe('string');
    });
  });
});
