/**
 * FIFO (First In First Out) Valuation Strategy
 * Issues stock from the oldest batches first
 * Commonly used in industries where older inventory should be sold first (food, pharma)
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

export class FIFOValuation implements ValuationStrategy {
  
  /**
   * Calculate valuation after receiving goods
   * Adds new batch to end of queue
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

    console.log('📊 FIFO Incoming:', {
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
   * Calculate rate when issuing goods using FIFO
   * Takes from oldest batches first (queue.shift)
   * 
   * Example:
   * - Queue: [{qty: 100, rate: 45}, {qty: 50, rate: 55}]
   * - Issue: 120 units
   * - Process:
   *   1. Take 100 from first batch (100 × 45 = 4,500)
   *   2. Take 20 from second batch (20 × 55 = 1,100)
   *   3. Total COGS: 5,600, Average Rate: 46.67
   * - Remaining Queue: [{qty: 30, rate: 55}]
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

    console.log('📤 FIFO Issue - Starting:', {
      currentQty,
      outgoingQty,
      batches: currentQueue.length
    });

    // Take from oldest batches first (front of queue)
    while (remaining > 0 && newQueue.length > 0) {
      const batch = newQueue[0];
      
      if (batch.qty <= remaining) {
        // Use entire batch
        const batchCost = batch.qty * batch.rate;
        totalCost += batchCost;
        remaining -= batch.qty;
        
        console.log(`  ✓ Used entire batch: ${batch.qty} × ${batch.rate} = ${batchCost}`);
        
        newQueue.shift(); // Remove first batch
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

    console.log('📤 FIFO Issue - Result:', {
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
   * For FIFO, this is the rate of the oldest batch
   */
  getCurrentRate(queue: StockBatch[]): number {
    if (!queue || queue.length === 0) {
      return 0;
    }
    return queue[0].rate; // First batch (oldest)
  }
}
