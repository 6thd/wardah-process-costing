/**
 * IValuationMethodStrategy - Domain Interface (Port)
 * 
 * Strategy Pattern for Inventory Valuation Methods
 * IAS 2 Compliant: FIFO, LIFO, Weighted Average, Moving Average
 * 
 * @description
 * This interface defines the contract for inventory valuation strategies.
 * Each strategy implements different methods of calculating Cost of Goods Sold (COGS)
 * and inventory values according to international accounting standards.
 * 
 * @see https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/
 */

/**
 * Supported inventory valuation methods
 * - FIFO: First In First Out (الوارد أولاً صادر أولاً)
 * - LIFO: Last In First Out (الوارد أخيراً صادر أولاً)
 * - Weighted Average: المتوسط المرجح
 * - Moving Average: المتوسط المتحرك
 */
export type ValuationMethod = 'FIFO' | 'LIFO' | 'Weighted Average' | 'Moving Average';

/**
 * Represents a batch of stock with quantity and rate
 */
export interface StockBatch {
  /** Quantity in this batch */
  qty: number;
  /** Unit cost/rate for this batch */
  rate: number;
  /** Optional: date when batch was received */
  receivedDate?: Date;
  /** Optional: batch/lot number */
  batchNumber?: string;
}

/**
 * Result of calculating incoming stock rate
 */
export interface IncomingRateResult {
  /** New total quantity after receiving */
  newQty: number;
  /** New weighted average rate (for average methods) */
  newRate: number;
  /** New total inventory value */
  newValue: number;
  /** Updated batch queue */
  newQueue: StockBatch[];
}

/**
 * Result of calculating outgoing stock rate (COGS)
 */
export interface OutgoingRateResult {
  /** Cost of Goods Sold for this transaction */
  costOfGoodsSold: number;
  /** Unit rate used for this transaction */
  rate: number;
  /** New quantity after issuing */
  newQty: number;
  /** Updated batch queue */
  newQueue: StockBatch[];
  /** New total inventory value */
  newValue: number;
}

/**
 * IValuationMethodStrategy - Strategy Interface
 * 
 * Defines the contract for inventory valuation calculations.
 * Implementations must handle:
 * - Incoming stock (purchases, returns)
 * - Outgoing stock (sales, issues)
 * - Current rate determination
 */
export interface IValuationMethodStrategy {
  /**
   * Calculate the new inventory state after receiving stock
   * 
   * @param prevQty - Previous total quantity
   * @param prevRate - Previous weighted average rate
   * @param prevValue - Previous total inventory value
   * @param prevQueue - Previous batch queue
   * @param incomingQty - Quantity being received
   * @param incomingRate - Unit cost of incoming stock
   * @returns New inventory state
   */
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ): IncomingRateResult;

  /**
   * Calculate COGS and new inventory state after issuing stock
   * 
   * @param qty - Current total quantity
   * @param queue - Current batch queue
   * @param outgoingQty - Quantity being issued
   * @returns COGS and new inventory state
   */
  calculateOutgoingRate(
    qty: number,
    queue: StockBatch[],
    outgoingQty: number
  ): OutgoingRateResult;

  /**
   * Get the current unit rate for valuation purposes
   * 
   * @param queue - Current batch queue
   * @returns Current unit rate
   */
  getCurrentRate(queue: StockBatch[]): number;

  /**
   * Get the valuation method name
   * @returns The valuation method type
   */
  getMethodName(): ValuationMethod;
}

/**
 * IValuationStrategyFactory - Factory Interface
 * 
 * Creates appropriate valuation strategy based on method
 */
export interface IValuationStrategyFactory {
  /**
   * Get a valuation strategy for the specified method
   * 
   * @param method - The valuation method to use
   * @returns The appropriate strategy implementation
   */
  getStrategy(method: ValuationMethod): IValuationMethodStrategy;

  /**
   * Get all supported valuation methods
   * @returns Array of supported methods
   */
  getSupportedMethods(): ValuationMethod[];
}

/**
 * Inventory movement types for valuation tracking
 */
export type InventoryMovementType = 
  | 'purchase'           // شراء
  | 'purchase_return'    // مرتجع شراء
  | 'sale'               // بيع
  | 'sale_return'        // مرتجع بيع
  | 'transfer_in'        // تحويل وارد
  | 'transfer_out'       // تحويل صادر
  | 'adjustment_in'      // تعديل زيادة
  | 'adjustment_out'     // تعديل نقص
  | 'production_in'      // إنتاج (إدخال)
  | 'production_out'     // إنتاج (إخراج مواد)
  | 'opening_balance';   // رصيد افتتاحي

/**
 * Input for recording an inventory valuation movement
 */
export interface ValuationMovementInput {
  /** Organization ID (multi-tenant) */
  orgId: string;
  /** Item/Product ID */
  itemId: string;
  /** Movement type */
  movementType: InventoryMovementType;
  /** Quantity (positive for in, negative for out) */
  quantity: number;
  /** Unit cost (for incoming movements) */
  unitCost?: number;
  /** Reference document type */
  referenceType?: string;
  /** Reference document ID */
  referenceId?: string;
  /** Notes */
  notes?: string;
  /** Transaction date */
  transactionDate?: Date;
}

/**
 * Result of a valuation movement
 */
export interface ValuationMovementResult {
  /** Success indicator */
  success: boolean;
  /** Movement ID */
  movementId?: string;
  /** COGS (for outgoing movements) */
  costOfGoodsSold?: number;
  /** Unit rate used */
  unitRate?: number;
  /** New inventory quantity */
  newQuantity?: number;
  /** New inventory value */
  newValue?: number;
  /** Error message if failed */
  error?: string;
}

/**
 * Batch-level valuation details
 */
export interface BatchValuationDetail {
  /** Batch number */
  batchNumber: string;
  /** Received date */
  receivedDate: Date;
  /** Remaining quantity */
  quantity: number;
  /** Unit cost */
  unitCost: number;
  /** Total value */
  totalValue: number;
  /** Age in days */
  ageDays: number;
}

/**
 * Item valuation summary
 */
export interface ItemValuationSummary {
  /** Item ID */
  itemId: string;
  /** Item name */
  itemName: string;
  /** SKU/Code */
  itemCode: string;
  /** Valuation method used */
  valuationMethod: ValuationMethod;
  /** Total quantity on hand */
  quantityOnHand: number;
  /** Weighted average cost */
  averageCost: number;
  /** Total inventory value */
  totalValue: number;
  /** Batch details (for FIFO/LIFO) */
  batches?: BatchValuationDetail[];
  /** Last movement date */
  lastMovementDate?: Date;
}

/**
 * Valuation comparison for reporting
 */
export interface ValuationComparison {
  /** Item ID */
  itemId: string;
  /** Item name */
  itemName: string;
  /** FIFO value */
  fifoValue: number;
  /** LIFO value */
  lifoValue: number;
  /** Weighted Average value */
  weightedAverageValue: number;
  /** Moving Average value */
  movingAverageValue: number;
  /** Variance between methods */
  maxVariance: number;
  /** Variance percentage */
  variancePercentage: number;
}


