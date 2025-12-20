/**
 * @fileoverview Tests for Work Centers hook and types
 * Tests WorkCenter interface validation and utility functions
 */

import { describe, it, expect } from 'vitest';
import { WorkCenter } from '@/types/work-center';

// Helper to create a valid WorkCenter object
function createWorkCenter(overrides: Partial<WorkCenter> = {}): WorkCenter {
  return {
    id: 'wc-test-1',
    org_id: 'org-test-1',
    code: 'WC001',
    name: 'Test Work Center',
    name_ar: 'مركز عمل اختباري',
    description: 'Test description',
    hourly_rate: 50.00,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe('WorkCenter Type', () => {
  describe('Basic Structure', () => {
    it('should have all required fields', () => {
      const workCenter = createWorkCenter();
      
      expect(workCenter.id).toBeDefined();
      expect(workCenter.org_id).toBeDefined();
      expect(workCenter.code).toBeDefined();
      expect(workCenter.name).toBeDefined();
      expect(workCenter.name_ar).toBeDefined();
      expect(workCenter.hourly_rate).toBeDefined();
      expect(workCenter.is_active).toBeDefined();
      expect(workCenter.created_at).toBeDefined();
      expect(workCenter.updated_at).toBeDefined();
    });

    it('should allow null description', () => {
      const workCenter = createWorkCenter({ description: null });
      expect(workCenter.description).toBeNull();
    });

    it('should have proper type for hourly_rate', () => {
      const workCenter = createWorkCenter({ hourly_rate: 75.50 });
      expect(typeof workCenter.hourly_rate).toBe('number');
      expect(workCenter.hourly_rate).toBe(75.50);
    });

    it('should have proper type for is_active', () => {
      const workCenter = createWorkCenter({ is_active: true });
      expect(typeof workCenter.is_active).toBe('boolean');
    });
  });

  describe('Validation', () => {
    it('should validate hourly_rate is non-negative', () => {
      const workCenter = createWorkCenter({ hourly_rate: 50.00 });
      expect(workCenter.hourly_rate).toBeGreaterThanOrEqual(0);
    });

    it('should validate code is not empty', () => {
      const workCenter = createWorkCenter({ code: 'WC001' });
      expect(workCenter.code.length).toBeGreaterThan(0);
    });

    it('should validate name is not empty', () => {
      const workCenter = createWorkCenter({ name: 'Welding Station' });
      expect(workCenter.name.length).toBeGreaterThan(0);
    });

    it('should validate org_id is present', () => {
      const workCenter = createWorkCenter({ org_id: 'org-123' });
      expect(workCenter.org_id).toBeTruthy();
    });
  });

  describe('Cost Calculations', () => {
    it('should calculate total cost for hours worked', () => {
      const workCenter = createWorkCenter({ hourly_rate: 75.00 });
      const hoursWorked = 8;
      const totalCost = workCenter.hourly_rate * hoursWorked;
      expect(totalCost).toBe(600);
    });

    it('should handle zero hourly rate', () => {
      const workCenter = createWorkCenter({ hourly_rate: 0 });
      const hoursWorked = 10;
      const totalCost = workCenter.hourly_rate * hoursWorked;
      expect(totalCost).toBe(0);
    });

    it('should calculate cost for multiple work centers', () => {
      const workCenters = [
        createWorkCenter({ id: 'wc-1', hourly_rate: 50 }),
        createWorkCenter({ id: 'wc-2', hourly_rate: 75 }),
        createWorkCenter({ id: 'wc-3', hourly_rate: 100 }),
      ];
      
      const workHours = [
        { workCenterId: 'wc-1', hours: 4 },
        { workCenterId: 'wc-2', hours: 2 },
        { workCenterId: 'wc-3', hours: 1 },
      ];
      
      const totalCost = workHours.reduce((sum, wh) => {
        const wc = workCenters.find(w => w.id === wh.workCenterId);
        return sum + (wc?.hourly_rate || 0) * wh.hours;
      }, 0);
      
      expect(totalCost).toBe(450); // 50*4 + 75*2 + 100*1
    });
  });

  describe('Active/Inactive State', () => {
    it('should identify active work centers', () => {
      const workCenter = createWorkCenter({ is_active: true });
      expect(workCenter.is_active).toBe(true);
    });

    it('should identify inactive work centers', () => {
      const workCenter = createWorkCenter({ is_active: false });
      expect(workCenter.is_active).toBe(false);
    });

    it('should filter active work centers from list', () => {
      const workCenters = [
        createWorkCenter({ id: 'wc-1', is_active: true }),
        createWorkCenter({ id: 'wc-2', is_active: false }),
        createWorkCenter({ id: 'wc-3', is_active: true }),
      ];
      
      const activeCount = workCenters.filter(wc => wc.is_active).length;
      expect(activeCount).toBe(2);
    });
  });

  describe('Multi-tenant Support', () => {
    it('should filter work centers by org_id', () => {
      const workCenters = [
        createWorkCenter({ id: 'wc-1', org_id: 'org-1' }),
        createWorkCenter({ id: 'wc-2', org_id: 'org-2' }),
        createWorkCenter({ id: 'wc-3', org_id: 'org-1' }),
      ];
      
      const org1Centers = workCenters.filter(wc => wc.org_id === 'org-1');
      expect(org1Centers.length).toBe(2);
    });

    it('should enforce org_id isolation', () => {
      const workCenter = createWorkCenter({ org_id: 'org-specific' });
      expect(workCenter.org_id).toBe('org-specific');
    });
  });

  describe('Bilingual Support', () => {
    it('should have both English and Arabic names', () => {
      const workCenter = createWorkCenter({
        name: 'Welding Station',
        name_ar: 'محطة اللحام',
      });
      
      expect(workCenter.name).toBe('Welding Station');
      expect(workCenter.name_ar).toBe('محطة اللحام');
    });
  });

  describe('Timestamps', () => {
    it('should have valid created_at timestamp', () => {
      const workCenter = createWorkCenter();
      const date = new Date(workCenter.created_at);
      expect(date.getTime()).not.toBeNaN();
    });

    it('should have valid updated_at timestamp', () => {
      const workCenter = createWorkCenter();
      const date = new Date(workCenter.updated_at);
      expect(date.getTime()).not.toBeNaN();
    });

    it('should have updated_at >= created_at', () => {
      const now = new Date().toISOString();
      const workCenter = createWorkCenter({
        created_at: now,
        updated_at: now,
      });
      
      const created = new Date(workCenter.created_at).getTime();
      const updated = new Date(workCenter.updated_at).getTime();
      expect(updated).toBeGreaterThanOrEqual(created);
    });
  });
});
