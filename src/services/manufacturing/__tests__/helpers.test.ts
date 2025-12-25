/**
 * Manufacturing Helpers Unit Tests
 * اختبارات الدوال المساعدة للتصنيع
 * These tests import and test ACTUAL functions from the source code
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeStatus,
  prepareStatusUpdateData,
  shouldSetEndDate,
  shouldSetStartDate,
  isTableNotFoundError,
  isRelationshipNotFoundError,
  calculateTotalCost
} from '../helpers';

// ===================== normalizeStatus =====================

describe('normalizeStatus - Source Function', () => {
  it('should return "draft" for undefined status', () => {
    expect(normalizeStatus(undefined)).toBe('draft');
  });

  it('should normalize "in_progress" to "in-progress"', () => {
    expect(normalizeStatus('in_progress')).toBe('in-progress');
  });

  it('should normalize "done" to "completed"', () => {
    expect(normalizeStatus('done')).toBe('completed');
  });

  it('should return status as-is when not in mapping', () => {
    expect(normalizeStatus('draft')).toBe('draft');
    expect(normalizeStatus('completed')).toBe('completed');
    expect(normalizeStatus('cancelled')).toBe('cancelled');
  });

  it('should handle empty string as falsy (returns draft)', () => {
    // Empty string is falsy in JS, so normalizeStatus returns 'draft'
    expect(normalizeStatus('')).toBe('draft');
  });
});

// ===================== prepareStatusUpdateData =====================

describe('prepareStatusUpdateData - Source Function', () => {
  it('should set status and updated_at', () => {
    const result = prepareStatusUpdateData('completed');
    
    expect(result.status).toBe('completed');
    expect(result.updated_at).toBeDefined();
    expect(typeof result.updated_at).toBe('string');
  });

  it('should merge provided update data', () => {
    const providedData = { notes: 'Test notes', priority: 'high' };
    const result = prepareStatusUpdateData('in-progress', providedData);
    
    expect(result.status).toBe('in-progress');
    expect(result.notes).toBe('Test notes');
    expect(result.priority).toBe('high');
    expect(result.updated_at).toBeDefined();
  });

  it('should override status from provided data', () => {
    const providedData = { status: 'draft' };
    const result = prepareStatusUpdateData('completed', providedData);
    
    expect(result.status).toBe('completed');
  });

  it('should preserve other provided fields', () => {
    const providedData = { quantity: 100, assignee_id: 'user-123' };
    const result = prepareStatusUpdateData('in-progress', providedData);
    
    expect(result.quantity).toBe(100);
    expect(result.assignee_id).toBe('user-123');
  });
});

// ===================== shouldSetEndDate =====================

describe('shouldSetEndDate - Source Function', () => {
  it('should return true for "completed" status without provided end_date', () => {
    expect(shouldSetEndDate('completed')).toBe(true);
    expect(shouldSetEndDate('completed', {})).toBe(true);
    expect(shouldSetEndDate('completed', { notes: 'Done' })).toBe(true);
  });

  it('should return true for "done" status without provided end_date', () => {
    expect(shouldSetEndDate('done')).toBe(true);
    expect(shouldSetEndDate('done', {})).toBe(true);
  });

  it('should return false when end_date is already provided', () => {
    expect(shouldSetEndDate('completed', { end_date: '2024-01-15' })).toBe(false);
    expect(shouldSetEndDate('done', { end_date: new Date().toISOString() })).toBe(false);
  });

  it('should return false for non-completed statuses', () => {
    expect(shouldSetEndDate('draft')).toBe(false);
    expect(shouldSetEndDate('in-progress')).toBe(false);
    expect(shouldSetEndDate('cancelled')).toBe(false);
  });
});

// ===================== shouldSetStartDate =====================

describe('shouldSetStartDate - Source Function', () => {
  it('should return true for "in-progress" status without provided start_date', () => {
    expect(shouldSetStartDate('in-progress')).toBe(true);
    expect(shouldSetStartDate('in-progress', {})).toBe(true);
  });

  it('should return true for "in_progress" status (underscore variant)', () => {
    expect(shouldSetStartDate('in_progress')).toBe(true);
  });

  it('should return false when start_date is already provided', () => {
    expect(shouldSetStartDate('in-progress', { start_date: '2024-01-15' })).toBe(false);
    expect(shouldSetStartDate('in_progress', { start_date: new Date().toISOString() })).toBe(false);
  });

  it('should return false for non-in-progress statuses', () => {
    expect(shouldSetStartDate('draft')).toBe(false);
    expect(shouldSetStartDate('completed')).toBe(false);
    expect(shouldSetStartDate('cancelled')).toBe(false);
  });
});

// ===================== isTableNotFoundError =====================

describe('isTableNotFoundError - Source Function', () => {
  it('should return true for PGRST205 error code', () => {
    expect(isTableNotFoundError({ code: 'PGRST205' })).toBe(true);
  });

  it('should return true for error message containing table not found', () => {
    expect(isTableNotFoundError({ message: 'Could not find the table' })).toBe(true);
    expect(isTableNotFoundError({ message: 'Error: Could not find the table "orders"' })).toBe(true);
  });

  it('should return false for other errors', () => {
    expect(isTableNotFoundError({ code: 'PGRST200' })).toBe(false);
    expect(isTableNotFoundError({ message: 'Connection refused' })).toBe(false);
    expect(isTableNotFoundError({})).toBe(false);
  });

  it('should handle undefined message', () => {
    expect(isTableNotFoundError({ code: 'OTHER' })).toBe(false);
    expect(isTableNotFoundError({ code: undefined, message: undefined })).toBe(false);
  });
});

// ===================== isRelationshipNotFoundError =====================

describe('isRelationshipNotFoundError - Source Function', () => {
  it('should return true for PGRST200 error code', () => {
    expect(isRelationshipNotFoundError({ code: 'PGRST200' })).toBe(true);
  });

  it('should return true for error message containing relationship not found', () => {
    expect(isRelationshipNotFoundError({ message: 'Could not find a relationship' })).toBe(true);
    expect(isRelationshipNotFoundError({ message: 'Could not find a relationship between tables' })).toBe(true);
  });

  it('should return false for other errors', () => {
    expect(isRelationshipNotFoundError({ code: 'PGRST205' })).toBe(false);
    expect(isRelationshipNotFoundError({ message: 'Connection refused' })).toBe(false);
    expect(isRelationshipNotFoundError({})).toBe(false);
  });
});

// ===================== calculateTotalCost =====================

describe('calculateTotalCost - Source Function', () => {
  it('should sum all cost components', () => {
    expect(calculateTotalCost(100, 50, 25)).toBe(175);
    expect(calculateTotalCost(1000, 500, 200)).toBe(1700);
  });

  it('should handle zero values', () => {
    expect(calculateTotalCost(0, 0, 0)).toBe(0);
    expect(calculateTotalCost(100, 0, 0)).toBe(100);
    expect(calculateTotalCost(0, 50, 0)).toBe(50);
    expect(calculateTotalCost(0, 0, 25)).toBe(25);
  });

  it('should handle undefined values as zero', () => {
    expect(calculateTotalCost(undefined, undefined, undefined)).toBe(0);
    expect(calculateTotalCost(100, undefined, undefined)).toBe(100);
    expect(calculateTotalCost(undefined, 50, 25)).toBe(75);
  });

  it('should handle decimal values', () => {
    expect(calculateTotalCost(100.50, 50.25, 25.10)).toBeCloseTo(175.85, 2);
    expect(calculateTotalCost(0.1, 0.2, 0.3)).toBeCloseTo(0.6, 10);
  });

  it('should handle large values', () => {
    expect(calculateTotalCost(1000000, 500000, 250000)).toBe(1750000);
  });
});
