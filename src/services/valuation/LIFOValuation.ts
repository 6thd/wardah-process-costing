/**
 * LIFO (Last In First Out) Valuation Strategy
 * Issues stock from the newest batches first
 * Used in certain industries or tax strategies
 */

import {
  ValuationStrategy,
  StockBatch,
  IncomingValuationResult,
  OutgoingValuationResult,
  getTotalQtyFromQueue,
  getTotalValueFromQueue,
  getWeightedAverageRate
} from './ValuationStrategy';

export class LIFOValuation implements ValuationStrategy {
  
  /**
   * Calculate valuation after receiving goods
   * Adds new batch to end of queue (same as FIFO)
   * 
   * Example:
   * - Previous Queue: [{qty: 100, rate: 45}]
   * - Incoming: 50 units @ 55 SAR
   * - New Queue: [{qty: 100, rate: 45}, {qty: 50, rate: 55}]
   */
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ): IncomingValuationResult {
    
    // Start with existing queue or empty array
    const newQueue: StockBatch[] = prevQueue && prevQueue.length > 0 
      ? [...prevQueue] 
      : [];

    // Add new batch to end of queue
    if (incomingQty > 0) {
      newQueue.push({
        qty: incomingQty,
        rate: incomingRate
      });
    }

    const newQty = getTotalQtyFromQueue(newQueue);
    const newValue = getTotalValueFromQueue(newQueue);
    const newRate = getWeightedAverageRate(newQueue); // For reporting only

    console.log('📊 LIFO Incoming:', {
      previous: { qty: prevQty, batches: prevQueue?.length || 0 },
      incoming: { qty: incomingQty, rate: incomingRate },
      result: { qty: newQty, batches: newQueue.length, avgRate: newRate }
    });

    return {
      newQty,
      newRate,
      newValue,
      newQueue
    };
  }

  /**
   * Calculate rate when issuing goods using LIFO
   * Takes from newest batches first (queue.pop)
   * 
   * Example:
   * - Queue: [{qty: 100, rate: 45}, {qty: 50, rate: 55}]
   * - Issue: 120 units
   * - Process:
   *   1. Take 50 from last batch (50 × 55 = 2,750)
   *   2. Take 70 from second-last batch (70 × 45 = 3,150)
   *   3. Total COGS: 5,900, Average Rate: 49.17
   * - Remaining Queue: [{qty: 30, rate: 45}]
   */
  calculateOutgoingRate(
    currentQty: number,
    currentQueue: StockBatch[],
    outgoingQty: number
  ): OutgoingValuationResult {
    
    if (outgoingQty > currentQty) {
      throw new Error(`Cannot issue ${outgoingQty} units. Only ${currentQty} units available.`);
    }

    let remaining = outgoingQty;
    let totalCost = 0;
    const newQueue: StockBatch[] = [...currentQueue];

    console.log('📤 LIFO Issue - Starting:', {
      currentQty,
      outgoingQty,
      batches: currentQueue.length
    });

    // Take from newest batches first (back of queue)
    while (remaining > 0 && newQueue.length > 0) {
      const batch = newQueue[newQueue.length - 1]; // Last batch (newest)
      
      if (batch.qty <= remaining) {
        // Use entire batch
        const batchCost = batch.qty * batch.rate;
        totalCost += batchCost;
        remaining -= batch.qty;
        
        console.log(`  ✓ Used entire batch: ${batch.qty} × ${batch.rate} = ${batchCost}`);
        
        newQueue.pop(); // Remove last batch
      } else {
        // Use part of batch
        const batchCost = remaining * batch.rate;
        totalCost += batchCost;
        
        console.log(`  ✓ Used partial batch: ${remaining} × ${batch.rate} = ${batchCost}`);
        
        batch.qty -= remaining;
        remaining = 0;
      }
    }

    const rate = outgoingQty > 0 ? totalCost / outgoingQty : 0;
    const newQty = getTotalQtyFromQueue(newQueue);
    const newValue = getTotalValueFromQueue(newQueue);

    console.log('📤 LIFO Issue - Result:', {
      cogs: totalCost,
      avgRate: rate,
      remainingQty: newQty,
      remainingBatches: newQueue.length
    });

    return {
      rate,
      costOfGoodsSold: totalCost,
      newQty,
      newValue,
      newQueue
    };
  }

  /**
   * Get current valuation rate from queue
   * For LIFO, this is the rate of the newest batch
   */
  getCurrentRate(queue: StockBatch[]): number {
    if (!queue || queue.length === 0) {
      return 0;
    }
    return queue[queue.length - 1].rate; // Last batch (newest)
  }
}
