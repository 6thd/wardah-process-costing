/**
 * Weighted Average (AVCO) Valuation Strategy
 * Calculates a new weighted average rate whenever stock is received
 * This is the default method and simplest to implement
 */

import {
  ValuationStrategy,
  StockBatch,
  IncomingValuationResult,
  OutgoingValuationResult
} from './ValuationStrategy';

export class WeightedAverageValuation implements ValuationStrategy {
  
  /**
   * Calculate new weighted average rate after receiving goods
   * 
   * Formula: newRate = (prevValue + incomingValue) / (prevQty + incomingQty)
   * 
   * Example:
   * - Previous: 100 units @ 45 SAR = 4,500 SAR
   * - Incoming: 50 units @ 55 SAR = 2,750 SAR
   * - New: 150 units @ 48.33 SAR = 7,250 SAR
   */
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ): IncomingValuationResult {
    
    const incomingValue = incomingQty * incomingRate;
    const newQty = prevQty + incomingQty;
    const newValue = prevValue + incomingValue;
    const newRate = newQty > 0 ? newValue / newQty : 0;

    // Weighted average uses a single batch with combined rate
    const newQueue: StockBatch[] = newQty > 0 
      ? [{ qty: newQty, rate: newRate }]
      : [];

    console.log('📊 Weighted Average Calculation:', {
      previous: { qty: prevQty, rate: prevRate, value: prevValue },
      incoming: { qty: incomingQty, rate: incomingRate, value: incomingValue },
      result: { qty: newQty, rate: newRate, value: newValue }
    });

    return {
      newQty,
      newRate,
      newValue,
      newQueue
    };
  }

  /**
   * Calculate rate when issuing goods using weighted average
   * Rate remains constant for all issues until new stock is received
   */
  calculateOutgoingRate(
    currentQty: number,
    currentQueue: StockBatch[],
    outgoingQty: number
  ): OutgoingValuationResult {
    
    if (outgoingQty > currentQty) {
      throw new Error(`Cannot issue ${outgoingQty} units. Only ${currentQty} units available.`);
    }

    // Use current weighted average rate
    const rate = this.getCurrentRate(currentQueue);
    const costOfGoodsSold = outgoingQty * rate;
    
    const newQty = currentQty - outgoingQty;
    const newValue = newQty * rate;
    
    // Update queue with remaining quantity
    const newQueue: StockBatch[] = newQty > 0 
      ? [{ qty: newQty, rate }]
      : [];

    console.log('📤 Weighted Average Issue:', {
      current: { qty: currentQty, rate },
      outgoing: { qty: outgoingQty, rate, cogs: costOfGoodsSold },
      remaining: { qty: newQty, rate, value: newValue }
    });

    return {
      rate,
      costOfGoodsSold,
      newQty,
      newValue,
      newQueue
    };
  }

  /**
   * Get current valuation rate from queue
   * For weighted average, this is simply the rate in the single batch
   */
  getCurrentRate(queue: StockBatch[]): number {
    if (!queue || queue.length === 0) {
      return 0;
    }
    return queue[0].rate;
  }
}
