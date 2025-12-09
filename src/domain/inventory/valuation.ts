/**
 * Inventory Valuation Module
 * Integrates FIFO, LIFO, and Weighted Average (AVCO) valuation methods
 * with the inventory management system
 */

import { 
  ValuationFactory, 
  ValuationMethod,
  StockBatch 
} from '../../services/valuation';

export interface Product {
  id: string;
  code: string;
  name: string;
  valuation_method: ValuationMethod;
  stock_quantity: number;
  cost_price: number;
  stock_value: number;
  stock_queue?: StockBatch[];
}

export interface StockMovement {
  product_id: string;
  move_type: 'IN' | 'OUT';
  quantity: number;
  rate: number;
  ref_type?: string;
  ref_id?: string;
  notes?: string;
}

export interface ValuationResult {
  newQty: number;
  newRate: number;
  newValue: number;
  newQueue: StockBatch[];
  costOfGoodsSold?: number;
}

/**
 * Process incoming stock with appropriate valuation method
 */
export async function processIncomingStock(
  product: Product,
  quantity: number,
  rate: number
): Promise<ValuationResult> {
  
  console.log(`📦 Processing incoming stock for ${product.code}:`, {
    method: product.valuation_method,
    quantity,
    rate,
    currentQty: product.stock_quantity,
    currentRate: product.cost_price
  });

  // Get valuation strategy
  const strategy = ValuationFactory.getStrategy(product.valuation_method);
  
  // Calculate new valuation
  const result = strategy.calculateIncomingRate(
    product.stock_quantity || 0,
    product.cost_price || 0,
    product.stock_value || 0,
    product.stock_queue || [],
    quantity,
    rate
  );

  console.log(`✅ Incoming stock processed:`, {
    newQty: result.newQty,
    newRate: result.newRate,
    newValue: result.newValue,
    batches: result.newQueue.length
  });

  return result;
}

/**
 * Process outgoing stock with appropriate valuation method
 */
export async function processOutgoingStock(
  product: Product,
  quantity: number
): Promise<ValuationResult> {
  
  console.log(`📤 Processing outgoing stock for ${product.code}:`, {
    method: product.valuation_method,
    quantity,
    currentQty: product.stock_quantity,
    currentRate: product.cost_price
  });

  // Validation
  if (quantity > product.stock_quantity) {
    throw new Error(
      `Insufficient stock for ${product.code}. ` +
      `Available: ${product.stock_quantity}, Required: ${quantity}`
    );
  }

  // Get valuation strategy
  const strategy = ValuationFactory.getStrategy(product.valuation_method);
  
  // Calculate COGS and new valuation
  const result = strategy.calculateOutgoingRate(
    product.stock_quantity,
    product.stock_queue || [{ qty: product.stock_quantity, rate: product.cost_price }],
    quantity
  );

  console.log(`✅ Outgoing stock processed:`, {
    quantity,
    rate: result.rate,
    cogs: result.costOfGoodsSold,
    remainingQty: result.newQty,
    remainingValue: result.newValue
  });

  return {
    newQty: result.newQty,
    newRate: result.rate,
    newValue: result.newValue,
    newQueue: result.newQueue,
    costOfGoodsSold: result.costOfGoodsSold
  };
}

/**
 * Get current valuation rate for a product
 */
export function getCurrentRate(product: Product): number {
  const strategy = ValuationFactory.getStrategy(product.valuation_method);
  const queue = product.stock_queue || [{ qty: product.stock_quantity, rate: product.cost_price }];
  return strategy.getCurrentRate(queue);
}

/**
 * Convert product valuation method
 * This is a destructive operation that recalculates stock value
 */
export async function convertValuationMethod(
  product: Product,
  newMethod: ValuationMethod
): Promise<Product> {
  
  console.warn(`⚠️ Converting ${product.code} from ${product.valuation_method} to ${newMethod}`);
  
  // Calculate current total value
  const currentValue = product.stock_quantity * product.cost_price;
  
  // Create new queue based on method
  // For all methods, convert existing stock into a single batch
  // Future incoming stock will create new batches
  const newQueue: StockBatch[] = product.stock_quantity > 0 
    ? [{ qty: product.stock_quantity, rate: product.cost_price }]
    : [];

  const updatedProduct: Product = {
    ...product,
    valuation_method: newMethod,
    stock_queue: newQueue,
    stock_value: currentValue
  };

  console.log(`✅ Conversion complete:`, {
    newMethod,
    qty: updatedProduct.stock_quantity,
    rate: updatedProduct.cost_price,
    value: updatedProduct.stock_value,
    batches: newQueue.length
  });

  return updatedProduct;
}

/**
 * Validate stock queue integrity
 */
export function validateStockQueue(product: Product): boolean {
  const queue = product.stock_queue || [];
  
  // Calculate total from queue
  const qtyFromQueue = queue.reduce((sum, batch) => sum + batch.qty, 0);
  const valueFromQueue = queue.reduce((sum, batch) => sum + (batch.qty * batch.rate), 0);
  
  // Check if queue matches product quantities
  const qtyMatch = Math.abs(qtyFromQueue - product.stock_quantity) < 0.01;
  const valueMatch = Math.abs(valueFromQueue - product.stock_value) < 0.01;
  
  if (!qtyMatch || !valueMatch) {
    console.error(`❌ Stock queue mismatch for ${product.code}:`, {
      product: { qty: product.stock_quantity, value: product.stock_value },
      queue: { qty: qtyFromQueue, value: valueFromQueue },
      difference: { 
        qty: product.stock_quantity - qtyFromQueue,
        value: product.stock_value - valueFromQueue
      }
    });
    return false;
  }
  
  return true;
}

/**
 * Repair stock queue by rebuilding from current values
 */
export function repairStockQueue(product: Product): Product {
  console.warn(`🔧 Repairing stock queue for ${product.code}`);
  
  const newQueue: StockBatch[] = product.stock_quantity > 0 
    ? [{ qty: product.stock_quantity, rate: product.cost_price }]
    : [];

  return {
    ...product,
    stock_queue: newQueue,
    stock_value: product.stock_quantity * product.cost_price
  };
}

/**
 * Get valuation method info in Arabic
 */
export function getValuationMethodInfo(method: ValuationMethod): {
  name: string;
  nameAr: string;
  description: string;
  descriptionAr: string;
} {
  const info = {
    'Weighted Average': {
      name: 'Weighted Average',
      nameAr: 'المتوسط المرجح',
      description: 'Calculates weighted average cost on each receipt',
      descriptionAr: 'يحسب متوسط التكلفة المرجح عند كل استلام'
    },
    'FIFO': {
      name: 'First In First Out',
      nameAr: 'الوارد أولاً صادر أولاً',
      description: 'Issues stock from oldest batches first',
      descriptionAr: 'يصرف المخزون من أقدم الدفعات أولاً'
    },
    'LIFO': {
      name: 'Last In First Out',
      nameAr: 'الوارد أخيراً صادر أولاً',
      description: 'Issues stock from newest batches first',
      descriptionAr: 'يصرف المخزون من أحدث الدفعات أولاً'
    },
    'Moving Average': {
      name: 'Moving Average',
      nameAr: 'المتوسط المتحرك',
      description: 'Similar to weighted average, updates on each transaction',
      descriptionAr: 'مشابه للمتوسط المرجح، يحدث مع كل حركة'
    }
  };

  return info[method] || info['Weighted Average'];
}

export default {
  processIncomingStock,
  processOutgoingStock,
  getCurrentRate,
  convertValuationMethod,
  validateStockQueue,
  repairStockQueue,
  getValuationMethodInfo
};
