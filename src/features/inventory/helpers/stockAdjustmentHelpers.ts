/**
 * Stock Adjustments Configuration and Helpers
 * Extracted to reduce complexity
 */

/**
 * Adjustment type configuration
 */
export const ADJUSTMENT_TYPES = {
  'PHYSICAL_COUNT': { label: 'جرد فعلي', icon: '📋', color: 'blue' },
  'DAMAGE': { label: 'تالف', icon: '💔', color: 'red' },
  'THEFT': { label: 'فقد/سرقة', icon: '🚨', color: 'orange' },
  'EXPIRY': { label: 'منتهي الصلاحية', icon: '⏰', color: 'yellow' },
  'QUALITY_ISSUE': { label: 'مشكلة جودة', icon: '⚠️', color: 'amber' },
  'REVALUATION': { label: 'إعادة تقييم', icon: '💰', color: 'green' },
  'OTHER': { label: 'أخرى', icon: '📝', color: 'gray' }
} as const;

export type AdjustmentType = keyof typeof ADJUSTMENT_TYPES;

/**
 * Get adjustment type info
 */
export function getAdjustmentTypeInfo(type: AdjustmentType) {
  return ADJUSTMENT_TYPES[type] || ADJUSTMENT_TYPES['OTHER'];
}

/**
 * Initial adjustment form state
 */
export interface AdjustmentFormState {
  adjustment_date: string;
  adjustment_type: string;
  reason: string;
  reference_number: string;
  warehouse_id: string;
  increase_account_id: string;
  decrease_account_id: string;
  items: AdjustmentItem[];
}

export interface AdjustmentItem {
  id: string;
  product_id: string;
  product: unknown;
  warehouse_id: string;
  current_qty: number;
  new_qty: number;
  difference_qty: number;
  current_rate: number;
  value_difference: number;
  reason: string;
}

export function createInitialAdjustmentState(): AdjustmentFormState {
  return {
    adjustment_date: new Date().toISOString().split('T')[0],
    adjustment_type: 'PHYSICAL_COUNT',
    reason: '',
    reference_number: '',
    warehouse_id: '',
    increase_account_id: '',
    decrease_account_id: '',
    items: []
  };
}

/**
 * Calculate totals from adjustment items
 */
export function calculateAdjustmentTotals(items: AdjustmentItem[]) {
  const totalValueDiff = items.reduce(
    (sum, item) => sum + (item.value_difference || 0),
    0
  );

  const increaseCount = items.filter(i => i.difference_qty > 0).length;
  const decreaseCount = items.filter(i => i.difference_qty < 0).length;

  const totalQtyDiff = items.reduce(
    (sum, item) => sum + (item.difference_qty || 0),
    0
  );

  return { 
    totalValueDiff, 
    increaseCount, 
    decreaseCount,
    totalQtyDiff,
    totalItems: items.length
  };
}

/**
 * Create a new adjustment item from selected product
 */
export function createAdjustmentItem(
  product: { id: string; stock_quantity?: number; cost_price?: number },
  warehouseId: string
): AdjustmentItem {
  return {
    id: Date.now().toString(),
    product_id: product.id,
    product: product,
    warehouse_id: warehouseId,
    current_qty: product.stock_quantity || 0,
    new_qty: 0,
    difference_qty: 0,
    current_rate: product.cost_price || 0,
    value_difference: 0,
    reason: ''
  };
}

/**
 * Update adjustment item with recalculated values
 */
export function updateAdjustmentItemQuantity(
  item: AdjustmentItem,
  newQty: number
): AdjustmentItem {
  const difference_qty = newQty - item.current_qty;
  return {
    ...item,
    new_qty: newQty,
    difference_qty,
    value_difference: difference_qty * item.current_rate
  };
}

/**
 * Validation for adjustment form
 */
export interface ValidationResult {
  valid: boolean;
  message: string;
}

export function validateAdjustmentForm(adjustment: AdjustmentFormState): ValidationResult {
  if (adjustment.items.length === 0) {
    return { valid: false, message: 'الرجاء إضافة منتج واحد على الأقل' };
  }

  if (!adjustment.warehouse_id) {
    return { valid: false, message: 'الرجاء اختيار المخزن' };
  }

  if (!adjustment.increase_account_id) {
    return { valid: false, message: 'الرجاء اختيار حساب الزيادة في المخزون' };
  }

  if (!adjustment.decrease_account_id) {
    return { valid: false, message: 'الرجاء اختيار حساب النقص في المخزون' };
  }

  if (!adjustment.reason.trim()) {
    return { valid: false, message: 'الرجاء إدخال سبب التسوية' };
  }

  const invalidItems = adjustment.items.filter(i => i.difference_qty === 0);
  if (invalidItems.length > 0) {
    return { valid: false, message: 'الرجاء تحديد الكمية الجديدة لجميع المنتجات' };
  }

  return { valid: true, message: '' };
}
