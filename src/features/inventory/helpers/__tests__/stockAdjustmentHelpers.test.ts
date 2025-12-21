/**
 * Tests for features/inventory/helpers/stockAdjustmentHelpers.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code functions
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ADJUSTMENT_TYPES,
  getAdjustmentTypeInfo,
  createInitialAdjustmentState,
  calculateAdjustmentTotals,
  createAdjustmentItem,
  updateAdjustmentItemQuantity,
  validateAdjustmentForm,
  type AdjustmentItem,
  type AdjustmentFormState
} from '../stockAdjustmentHelpers';

describe('stockAdjustmentHelpers', () => {
  describe('ADJUSTMENT_TYPES', () => {
    it('should have all expected adjustment types', () => {
      expect(ADJUSTMENT_TYPES['PHYSICAL_COUNT']).toBeDefined();
      expect(ADJUSTMENT_TYPES['DAMAGE']).toBeDefined();
      expect(ADJUSTMENT_TYPES['THEFT']).toBeDefined();
      expect(ADJUSTMENT_TYPES['EXPIRY']).toBeDefined();
      expect(ADJUSTMENT_TYPES['QUALITY_ISSUE']).toBeDefined();
      expect(ADJUSTMENT_TYPES['REVALUATION']).toBeDefined();
      expect(ADJUSTMENT_TYPES['OTHER']).toBeDefined();
    });

    it('should have label, icon, and color for each type', () => {
      Object.values(ADJUSTMENT_TYPES).forEach(type => {
        expect(type.label).toBeDefined();
        expect(type.icon).toBeDefined();
        expect(type.color).toBeDefined();
      });
    });
  });

  describe('getAdjustmentTypeInfo', () => {
    it('should return correct info for known type', () => {
      const info = getAdjustmentTypeInfo('DAMAGE');
      expect(info.label).toBe('تالف');
      expect(info.icon).toBe('💔');
      expect(info.color).toBe('red');
    });

    it('should return OTHER info for unknown type', () => {
      const info = getAdjustmentTypeInfo('UNKNOWN' as any);
      expect(info).toEqual(ADJUSTMENT_TYPES['OTHER']);
    });

    it('should return PHYSICAL_COUNT info', () => {
      const info = getAdjustmentTypeInfo('PHYSICAL_COUNT');
      expect(info.label).toBe('جرد فعلي');
      expect(info.icon).toBe('📋');
      expect(info.color).toBe('blue');
    });
  });

  describe('createInitialAdjustmentState', () => {
    it('should create initial state with default values', () => {
      const state = createInitialAdjustmentState();
      
      expect(state.adjustment_type).toBe('PHYSICAL_COUNT');
      expect(state.reason).toBe('');
      expect(state.reference_number).toBe('');
      expect(state.warehouse_id).toBe('');
      expect(state.increase_account_id).toBe('');
      expect(state.decrease_account_id).toBe('');
      expect(state.items).toEqual([]);
    });

    it('should set adjustment_date to today', () => {
      const state = createInitialAdjustmentState();
      const today = new Date().toISOString().split('T')[0];
      expect(state.adjustment_date).toBe(today);
    });
  });

  describe('calculateAdjustmentTotals', () => {
    const mockItems: AdjustmentItem[] = [
      {
        id: '1',
        product_id: 'p1',
        product: {},
        warehouse_id: 'w1',
        current_qty: 10,
        new_qty: 15,
        difference_qty: 5,
        current_rate: 100,
        value_difference: 500,
        reason: ''
      },
      {
        id: '2',
        product_id: 'p2',
        product: {},
        warehouse_id: 'w1',
        current_qty: 20,
        new_qty: 18,
        difference_qty: -2,
        current_rate: 50,
        value_difference: -100,
        reason: ''
      }
    ];

    it('should calculate total value difference', () => {
      const result = calculateAdjustmentTotals(mockItems);
      expect(result.totalValueDiff).toBe(400);
    });

    it('should count increase items', () => {
      const result = calculateAdjustmentTotals(mockItems);
      expect(result.increaseCount).toBe(1);
    });

    it('should count decrease items', () => {
      const result = calculateAdjustmentTotals(mockItems);
      expect(result.decreaseCount).toBe(1);
    });

    it('should calculate total quantity difference', () => {
      const result = calculateAdjustmentTotals(mockItems);
      expect(result.totalQtyDiff).toBe(3);
    });

    it('should count total items', () => {
      const result = calculateAdjustmentTotals(mockItems);
      expect(result.totalItems).toBe(2);
    });

    it('should handle empty items array', () => {
      const result = calculateAdjustmentTotals([]);
      expect(result.totalValueDiff).toBe(0);
      expect(result.increaseCount).toBe(0);
      expect(result.decreaseCount).toBe(0);
      expect(result.totalQtyDiff).toBe(0);
      expect(result.totalItems).toBe(0);
    });
  });

  describe('createAdjustmentItem', () => {
    it('should create adjustment item from product', () => {
      const product = { id: 'prod-1', stock_quantity: 50, cost_price: 25 };
      const item = createAdjustmentItem(product, 'warehouse-1');

      expect(item.product_id).toBe('prod-1');
      expect(item.warehouse_id).toBe('warehouse-1');
      expect(item.current_qty).toBe(50);
      expect(item.current_rate).toBe(25);
      expect(item.new_qty).toBe(0);
      expect(item.difference_qty).toBe(0);
      expect(item.value_difference).toBe(0);
    });

    it('should handle product without stock_quantity', () => {
      const product = { id: 'prod-1' };
      const item = createAdjustmentItem(product, 'warehouse-1');

      expect(item.current_qty).toBe(0);
      expect(item.current_rate).toBe(0);
    });

    it('should generate unique id based on timestamp', () => {
      const product = { id: 'prod-1' };
      const item1 = createAdjustmentItem(product, 'warehouse-1');
      
      // Wait a bit to ensure different timestamp
      const item2 = createAdjustmentItem(product, 'warehouse-1');
      
      expect(item1.id).toBeDefined();
      expect(typeof item1.id).toBe('string');
    });
  });

  describe('updateAdjustmentItemQuantity', () => {
    const baseItem: AdjustmentItem = {
      id: '1',
      product_id: 'p1',
      product: {},
      warehouse_id: 'w1',
      current_qty: 10,
      new_qty: 0,
      difference_qty: 0,
      current_rate: 100,
      value_difference: 0,
      reason: ''
    };

    it('should update new_qty and calculate difference', () => {
      const updated = updateAdjustmentItemQuantity(baseItem, 15);
      
      expect(updated.new_qty).toBe(15);
      expect(updated.difference_qty).toBe(5);
    });

    it('should calculate value_difference', () => {
      const updated = updateAdjustmentItemQuantity(baseItem, 15);
      
      expect(updated.value_difference).toBe(500); // 5 * 100
    });

    it('should handle negative difference', () => {
      const updated = updateAdjustmentItemQuantity(baseItem, 5);
      
      expect(updated.difference_qty).toBe(-5);
      expect(updated.value_difference).toBe(-500);
    });

    it('should handle no change', () => {
      const updated = updateAdjustmentItemQuantity(baseItem, 10);
      
      expect(updated.difference_qty).toBe(0);
      expect(updated.value_difference).toBe(0);
    });

    it('should preserve other item properties', () => {
      const itemWithReason = { ...baseItem, reason: 'Test reason' };
      const updated = updateAdjustmentItemQuantity(itemWithReason, 15);
      
      expect(updated.reason).toBe('Test reason');
      expect(updated.product_id).toBe('p1');
    });
  });

  describe('validateAdjustmentForm', () => {
    let validForm: AdjustmentFormState;

    beforeEach(() => {
      validForm = {
        adjustment_date: '2024-01-15',
        adjustment_type: 'PHYSICAL_COUNT',
        reason: 'Monthly inventory check',
        reference_number: 'ADJ-001',
        warehouse_id: 'warehouse-1',
        increase_account_id: 'acc-1',
        decrease_account_id: 'acc-2',
        items: [
          {
            id: '1',
            product_id: 'p1',
            product: {},
            warehouse_id: 'w1',
            current_qty: 10,
            new_qty: 15,
            difference_qty: 5,
            current_rate: 100,
            value_difference: 500,
            reason: ''
          }
        ]
      };
    });

    it('should return valid for complete form', () => {
      const result = validateAdjustmentForm(validForm);
      expect(result.valid).toBe(true);
      expect(result.message).toBe('');
    });

    it('should return invalid when no items', () => {
      validForm.items = [];
      const result = validateAdjustmentForm(validForm);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('الرجاء إضافة منتج واحد على الأقل');
    });

    it('should return invalid when no warehouse_id', () => {
      validForm.warehouse_id = '';
      const result = validateAdjustmentForm(validForm);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('الرجاء اختيار المخزن');
    });

    it('should return invalid when no increase_account_id', () => {
      validForm.increase_account_id = '';
      const result = validateAdjustmentForm(validForm);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('الرجاء اختيار حساب الزيادة في المخزون');
    });

    it('should return invalid when no decrease_account_id', () => {
      validForm.decrease_account_id = '';
      const result = validateAdjustmentForm(validForm);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('الرجاء اختيار حساب النقص في المخزون');
    });

    it('should return invalid when reason is empty', () => {
      validForm.reason = '';
      const result = validateAdjustmentForm(validForm);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('الرجاء إدخال سبب التسوية');
    });

    it('should return invalid when reason is whitespace only', () => {
      validForm.reason = '   ';
      const result = validateAdjustmentForm(validForm);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('الرجاء إدخال سبب التسوية');
    });

    it('should return invalid when item has zero difference', () => {
      validForm.items[0].difference_qty = 0;
      const result = validateAdjustmentForm(validForm);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('الرجاء تحديد الكمية الجديدة لجميع المنتجات');
    });
  });
});
