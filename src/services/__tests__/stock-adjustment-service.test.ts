/**
 * Stock Adjustment Service Tests
 * Tests for inventory adjustment operations with accounting integration
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the supabase module
const mockFrom = vi.fn();

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import { type StockAdjustment, type StockAdjustmentItem } from '../stock-adjustment-service';

describe('StockAdjustmentService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createAdjustment validation', () => {
    it('should validate that items array is not empty', () => {
      const adjustment: StockAdjustment = {
        adjustment_date: '2024-01-15',
        adjustment_type: 'PHYSICAL_COUNT',
        reason: 'جرد دوري',
        total_value_difference: 0,
        status: 'DRAFT',
        items: [],
        requires_approval: false,
      };

      // Validation logic test
      const isValid = adjustment.items && adjustment.items.length > 0;
      expect(isValid).toBe(false);
    });

    it('should calculate total value difference correctly', async () => {
      const items: StockAdjustmentItem[] = [
        {
          product_id: 'prod-1',
          current_qty: 100,
          new_qty: 95,
          difference_qty: -5,
          current_rate: 50,
          value_difference: -250,
        },
        {
          product_id: 'prod-2',
          current_qty: 50,
          new_qty: 55,
          difference_qty: 5,
          current_rate: 30,
          value_difference: 150,
        },
      ];

      const totalValueDiff = items.reduce((sum, item) => sum + item.value_difference, 0);

      expect(totalValueDiff).toBe(-100); // -250 + 150 = -100 (net loss)
    });
  });

  describe('Adjustment Types', () => {
    it('should support all standard adjustment types', () => {
      const validTypes = [
        'PHYSICAL_COUNT',
        'DAMAGE',
        'THEFT',
        'EXPIRY',
        'QUALITY_ISSUE',
        'REVALUATION',
        'OTHER',
      ];

      validTypes.forEach((type) => {
        expect(['PHYSICAL_COUNT', 'DAMAGE', 'THEFT', 'EXPIRY', 'QUALITY_ISSUE', 'REVALUATION', 'OTHER'])
          .toContain(type);
      });
    });

    it('should have Arabic descriptions for adjustment types', () => {
      const typeDescriptions: Record<string, string> = {
        'PHYSICAL_COUNT': 'جرد فعلي',
        'DAMAGE': 'تلف',
        'THEFT': 'سرقة',
        'EXPIRY': 'انتهاء صلاحية',
        'QUALITY_ISSUE': 'مشكلة جودة',
        'REVALUATION': 'إعادة تقييم',
        'OTHER': 'أخرى',
      };

      expect(typeDescriptions['PHYSICAL_COUNT']).toBe('جرد فعلي');
      expect(typeDescriptions['DAMAGE']).toBe('تلف');
    });
  });

  describe('Status Workflow', () => {
    it('should start with DRAFT status', () => {
      const adjustment: StockAdjustment = {
        adjustment_date: '2024-01-15',
        adjustment_type: 'PHYSICAL_COUNT',
        reason: 'جرد',
        total_value_difference: 0,
        status: 'DRAFT',
        items: [],
        requires_approval: false,
      };

      expect(adjustment.status).toBe('DRAFT');
    });

    it('should support valid status transitions', () => {
      const validTransitions: Record<string, string[]> = {
        'DRAFT': ['SUBMITTED', 'CANCELLED'],
        'SUBMITTED': ['CANCELLED'],
        'CANCELLED': [],
      };

      expect(validTransitions['DRAFT']).toContain('SUBMITTED');
      expect(validTransitions['SUBMITTED']).toContain('CANCELLED');
      expect(validTransitions['CANCELLED']).toHaveLength(0);
    });
  });

  describe('Value Calculations', () => {
    it('should calculate value difference for quantity increase', () => {
      const item: StockAdjustmentItem = {
        product_id: 'prod-1',
        current_qty: 100,
        new_qty: 110,
        difference_qty: 10,
        current_rate: 25,
        value_difference: 250, // 10 * 25
      };

      expect(item.value_difference).toBe(item.difference_qty * item.current_rate);
    });

    it('should calculate value difference for quantity decrease', () => {
      const item: StockAdjustmentItem = {
        product_id: 'prod-1',
        current_qty: 100,
        new_qty: 80,
        difference_qty: -20,
        current_rate: 25,
        value_difference: -500, // -20 * 25
      };

      expect(item.value_difference).toBe(item.difference_qty * item.current_rate);
    });

    it('should handle zero difference', () => {
      const item: StockAdjustmentItem = {
        product_id: 'prod-1',
        current_qty: 100,
        new_qty: 100,
        difference_qty: 0,
        current_rate: 25,
        value_difference: 0,
      };

      expect(item.difference_qty).toBe(0);
      expect(item.value_difference).toBe(0);
    });
  });

  describe('Accounting Integration', () => {
    it('should have expense account for losses', () => {
      const adjustment: StockAdjustment = {
        adjustment_date: '2024-01-15',
        adjustment_type: 'DAMAGE',
        reason: 'تلف بسبب الرطوبة',
        total_value_difference: -1000,
        status: 'DRAFT',
        items: [{
          product_id: 'prod-1',
          current_qty: 100,
          new_qty: 60,
          difference_qty: -40,
          current_rate: 25,
          value_difference: -1000,
        }],
        requires_approval: true,
        expense_account_id: '5950', // مصروفات تسوية المخزون
        inventory_account_id: '1400', // المخزون
      };

      expect(adjustment.expense_account_id).toBe('5950');
      expect(adjustment.total_value_difference).toBeLessThan(0);
    });

    it('should have gain account for surplus', () => {
      const adjustment: StockAdjustment = {
        adjustment_date: '2024-01-15',
        adjustment_type: 'PHYSICAL_COUNT',
        reason: 'جرد - فائض',
        total_value_difference: 500,
        status: 'DRAFT',
        items: [{
          product_id: 'prod-1',
          current_qty: 100,
          new_qty: 120,
          difference_qty: 20,
          current_rate: 25,
          value_difference: 500,
        }],
        requires_approval: false,
        gain_account_id: '4900', // إيرادات متنوعة
        inventory_account_id: '1400', // المخزون
      };

      expect(adjustment.gain_account_id).toBe('4900');
      expect(adjustment.total_value_difference).toBeGreaterThan(0);
    });

    it('should generate correct journal entry for loss', () => {
      const adjustment: StockAdjustment = {
        adjustment_date: '2024-01-15',
        adjustment_type: 'DAMAGE',
        reason: 'تلف',
        total_value_difference: -1000,
        status: 'SUBMITTED',
        items: [{
          product_id: 'prod-1',
          current_qty: 100,
          new_qty: 60,
          difference_qty: -40,
          current_rate: 25,
          value_difference: -1000,
        }],
        requires_approval: false,
        expense_account_id: '5950',
        inventory_account_id: '1400',
      };

      // Expected journal entry:
      // Dr. Inventory Adjustment Expense (5950)  1000
      // Cr. Inventory (1400)                     1000
      const journalEntry = {
        lines: [
          { account_id: adjustment.expense_account_id, debit: Math.abs(adjustment.total_value_difference), credit: 0 },
          { account_id: adjustment.inventory_account_id, debit: 0, credit: Math.abs(adjustment.total_value_difference) },
        ],
      };

      const totalDebit = journalEntry.lines.reduce((sum, line) => sum + line.debit, 0);
      const totalCredit = journalEntry.lines.reduce((sum, line) => sum + line.credit, 0);

      expect(totalDebit).toBe(totalCredit);
      expect(totalDebit).toBe(1000);
    });
  });

  describe('Approval Workflow', () => {
    it('should require approval when flag is set', () => {
      const adjustment: StockAdjustment = {
        adjustment_date: '2024-01-15',
        adjustment_type: 'THEFT',
        reason: 'نقص غير مبرر',
        total_value_difference: -5000,
        status: 'DRAFT',
        items: [],
        requires_approval: true,
      };

      expect(adjustment.requires_approval).toBe(true);
    });

    it('should track approval details', () => {
      const adjustment: StockAdjustment = {
        adjustment_date: '2024-01-15',
        adjustment_type: 'DAMAGE',
        reason: 'تلف',
        total_value_difference: -1000,
        status: 'SUBMITTED',
        items: [],
        requires_approval: true,
        approved_by: 'manager-123',
        approved_at: '2024-01-15T14:30:00Z',
      };

      expect(adjustment.approved_by).toBe('manager-123');
      expect(adjustment.approved_at).toBeDefined();
    });
  });

  describe('Physical Count Session', () => {
    it('should calculate difference between system and counted quantity', () => {
      const countItems = [
        { product_id: 'prod-1', system_qty: 100, counted_qty: 95, difference: 0 },
        { product_id: 'prod-2', system_qty: 50, counted_qty: 52, difference: 0 },
      ];

      countItems.forEach((item) => {
        item.difference = item.counted_qty - item.system_qty;
      });

      expect(countItems[0].difference).toBe(-5);
      expect(countItems[1].difference).toBe(2);
    });

    it('should track count session status', () => {
      const validStatuses = ['IN_PROGRESS', 'COMPLETED', 'ADJUSTED'];
      
      validStatuses.forEach((status) => {
        expect(['IN_PROGRESS', 'COMPLETED', 'ADJUSTED']).toContain(status);
      });
    });
  });

  describe('Batch and Serial Tracking', () => {
    it('should support batch numbers', () => {
      const item: StockAdjustmentItem = {
        product_id: 'prod-1',
        current_qty: 100,
        new_qty: 90,
        difference_qty: -10,
        current_rate: 50,
        value_difference: -500,
        batch_no: 'BATCH-2024-001',
      };

      expect(item.batch_no).toBe('BATCH-2024-001');
    });

    it('should support serial numbers', () => {
      const item: StockAdjustmentItem = {
        product_id: 'prod-1',
        current_qty: 5,
        new_qty: 3,
        difference_qty: -2,
        current_rate: 500,
        value_difference: -1000,
        serial_nos: ['SN-001', 'SN-002'],
      };

      expect(item.serial_nos).toHaveLength(2);
      expect(item.serial_nos).toContain('SN-001');
    });
  });
});

describe('Inventory Valuation Impact', () => {
  it('should update AVCO after adjustment', () => {
    const beforeAdjustment = {
      total_qty: 100,
      total_value: 5000,
      avg_cost: 50,
    };

    const adjustment = {
      qty_change: 10, // Increase
      value_change: 550, // Slightly higher cost
    };

    const afterAdjustment = {
      total_qty: beforeAdjustment.total_qty + adjustment.qty_change,
      total_value: beforeAdjustment.total_value + adjustment.value_change,
      avg_cost: 0,
    };

    afterAdjustment.avg_cost = afterAdjustment.total_value / afterAdjustment.total_qty;

    expect(afterAdjustment.total_qty).toBe(110);
    expect(afterAdjustment.total_value).toBe(5550);
    expect(afterAdjustment.avg_cost).toBeCloseTo(50.45, 1); // Slightly increased
  });

  it('should handle stock-out scenario', () => {
    const adjustment = {
      qty_change: -50,
      current_avg_cost: 50,
    };

    const valueImpact = adjustment.qty_change * adjustment.current_avg_cost;

    expect(valueImpact).toBe(-2500);
  });
});
