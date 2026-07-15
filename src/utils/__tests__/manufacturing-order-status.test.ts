import { describe, it, expect } from 'vitest';
import {
  ManufacturingOrderStatus,
  STATUS_WORKFLOW,
  getValidNextStatuses,
  isValidStatusTransition,
  STATUS_INFO,
} from '../manufacturing-order-status';

describe('manufacturing-order-status', () => {
  describe('STATUS_WORKFLOW', () => {
    it('should define valid transitions for draft status', () => {
      expect(STATUS_WORKFLOW['draft']).toContain('confirmed');
      expect(STATUS_WORKFLOW['draft']).toContain('pending');
      expect(STATUS_WORKFLOW['draft']).toContain('cancelled');
    });

    it('should define valid transitions for pending status', () => {
      expect(STATUS_WORKFLOW['pending']).toContain('in_progress');
      expect(STATUS_WORKFLOW['pending']).toContain('confirmed');
      expect(STATUS_WORKFLOW['pending']).toContain('cancelled');
      expect(STATUS_WORKFLOW['pending']).toContain('on_hold');
    });

    it('should define valid transitions for in_progress status', () => {
      expect(STATUS_WORKFLOW['in_progress']).toContain('completed');
      expect(STATUS_WORKFLOW['in_progress']).toContain('quality_check');
      expect(STATUS_WORKFLOW['in_progress']).toContain('on_hold');
      expect(STATUS_WORKFLOW['in_progress']).toContain('cancelled');
    });

    it('should have no transitions from completed status', () => {
      expect(STATUS_WORKFLOW['completed']).toEqual([]);
    });

    it('should have no transitions from cancelled status', () => {
      expect(STATUS_WORKFLOW['cancelled']).toEqual([]);
    });

    it('should allow resuming from on_hold', () => {
      expect(STATUS_WORKFLOW['on_hold']).toContain('in_progress');
      expect(STATUS_WORKFLOW['on_hold']).toContain('pending');
      expect(STATUS_WORKFLOW['on_hold']).toContain('cancelled');
    });
  });

  describe('getValidNextStatuses', () => {
    it('should return valid next statuses for draft', () => {
      const nextStatuses = getValidNextStatuses('draft');
      expect(nextStatuses).toContain('confirmed');
      expect(nextStatuses).toContain('pending');
      expect(nextStatuses).not.toContain('completed');
    });

    it('should return empty array for completed status', () => {
      const nextStatuses = getValidNextStatuses('completed');
      expect(nextStatuses).toEqual([]);
    });

    it('should return empty array for cancelled status', () => {
      const nextStatuses = getValidNextStatuses('cancelled');
      expect(nextStatuses).toEqual([]);
    });

    it('should return valid options for in_progress', () => {
      const nextStatuses = getValidNextStatuses('in_progress');
      expect(nextStatuses.length).toBeGreaterThan(0);
      expect(nextStatuses).toContain('completed');
    });

    it('should return empty array for unknown status', () => {
      const nextStatuses = getValidNextStatuses('unknown' as ManufacturingOrderStatus);
      expect(nextStatuses).toEqual([]);
    });
  });

  describe('isValidStatusTransition', () => {
    // Valid transitions
    it('should allow draft -> confirmed', () => {
      expect(isValidStatusTransition('draft', 'confirmed')).toBe(true);
    });

    it('should allow draft -> pending', () => {
      expect(isValidStatusTransition('draft', 'pending')).toBe(true);
    });

    it('should allow draft -> cancelled', () => {
      expect(isValidStatusTransition('draft', 'cancelled')).toBe(true);
    });

    it('should allow pending -> in_progress', () => {
      expect(isValidStatusTransition('pending', 'in_progress')).toBe(true);
    });

    it('should allow in_progress -> completed', () => {
      expect(isValidStatusTransition('in_progress', 'completed')).toBe(true);
    });

    it('should allow in_progress -> quality_check', () => {
      expect(isValidStatusTransition('in_progress', 'quality_check')).toBe(true);
    });

    it('should allow quality_check -> completed', () => {
      expect(isValidStatusTransition('quality_check', 'completed')).toBe(true);
    });

    // Invalid transitions
    it('should not allow draft -> completed directly', () => {
      expect(isValidStatusTransition('draft', 'completed')).toBe(false);
    });

    it('should not allow completed -> any status', () => {
      expect(isValidStatusTransition('completed', 'draft')).toBe(false);
      expect(isValidStatusTransition('completed', 'in_progress')).toBe(false);
      expect(isValidStatusTransition('completed', 'cancelled')).toBe(false);
    });

    it('should not allow cancelled -> any status', () => {
      expect(isValidStatusTransition('cancelled', 'draft')).toBe(false);
      expect(isValidStatusTransition('cancelled', 'in_progress')).toBe(false);
    });

    it('should return false for unknown from status', () => {
      expect(isValidStatusTransition('unknown' as ManufacturingOrderStatus, 'completed')).toBe(false);
    });
  });

  describe('STATUS_INFO', () => {
    it('should have info for all statuses', () => {
      const statuses: ManufacturingOrderStatus[] = [
        'draft', 'pending', 'confirmed', 'in_progress',
        'completed', 'cancelled', 'on_hold', 'quality_check'
      ];

      statuses.forEach(status => {
        expect(STATUS_INFO[status]).toBeDefined();
        expect(STATUS_INFO[status].label).toBeTruthy();
        expect(STATUS_INFO[status].labelAr).toBeTruthy();
        expect(STATUS_INFO[status].description).toBeTruthy();
        expect(STATUS_INFO[status].descriptionAr).toBeTruthy();
        expect(STATUS_INFO[status].variant).toBeTruthy();
      });
    });

    it('should have correct variant for destructive statuses', () => {
      expect(STATUS_INFO['cancelled'].variant).toBe('destructive');
    });

    it('should have correct variant for completed status', () => {
      expect(STATUS_INFO['completed'].variant).toBe('default');
    });

    it('should have Arabic labels for all statuses', () => {
      expect(STATUS_INFO['draft'].labelAr).toBe('مسودة');
      expect(STATUS_INFO['pending'].labelAr).toBe('في الانتظار');
      expect(STATUS_INFO['confirmed'].labelAr).toBe('مؤكد');
      expect(STATUS_INFO['in_progress'].labelAr).toBe('قيد التنفيذ');
      expect(STATUS_INFO['completed'].labelAr).toBe('مكتمل');
      expect(STATUS_INFO['cancelled'].labelAr).toBe('ملغي');
    });
  });
});
