/**
 * Valuation Strategy Pattern - Interface
 * Supports multiple inventory valuation methods: Weighted Average, FIFO, LIFO
 */

export interface StockBatch {
  qty: number;
  rate: number;
}

export interface IncomingValuationResult {
  newQty: number;
  newRate: number;
  newValue: number;
  newQueue: StockBatch[];
}

export interface OutgoingValuationResult {
  rate: number;
  costOfGoodsSold: number;
  newQty: number;
  newValue: number;
  newQueue: StockBatch[];
}

/**
 * Base interface for all valuation strategies
 */
export interface ValuationStrategy {
  /**
   * Calculate new valuation rate after receiving goods
   * 
   * @param prevQty - Previous quantity in stock
   * @param prevRate - Previous valuation rate
   * @param prevValue - Previous stock value
   * @param prevQueue - Previous stock queue (for FIFO/LIFO)
   * @param incomingQty - Quantity being received
   * @param incomingRate - Cost per unit of incoming stock
   * @returns New quantity, rate, value, and updated queue
   */
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ): IncomingValuationResult;

  /**
   * Calculate rate and update queue when issuing goods
   * 
   * @param currentQty - Current quantity in stock
   * @param currentQueue - Current stock queue
   * @param outgoingQty - Quantity being issued
   * @returns Rate, COGS, new quantity, new value, and updated queue
   */
  calculateOutgoingRate(
    currentQty: number,
    currentQueue: StockBatch[],
    outgoingQty: number
  ): OutgoingValuationResult;

  /**
   * Get the current valuation rate from queue
   */
  getCurrentRate(queue: StockBatch[]): number;
}

/**
 * Helper function to calculate total quantity from queue
 */
export function getTotalQtyFromQueue(queue: StockBatch[]): number {
  return queue.reduce((sum, batch) => sum + batch.qty, 0);
}

/**
 * Helper function to calculate total value from queue
 */
export function getTotalValueFromQueue(queue: StockBatch[]): number {
  return queue.reduce((sum, batch) => sum + (batch.qty * batch.rate), 0);
}

/**
 * Helper function to calculate weighted average rate from queue
 */
export function getWeightedAverageRate(queue: StockBatch[]): number {
  const totalQty = getTotalQtyFromQueue(queue);
  const totalValue = getTotalValueFromQueue(queue);
  return totalQty > 0 ? totalValue / totalQty : 0;
}
