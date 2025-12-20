/**
 * ValuationStrategies - Domain Layer Implementation
 * 
 * Pure domain logic for inventory valuation calculations.
 * No external dependencies (Clean Architecture compliant).
 * 
 * IAS 2 Compliant Methods:
 * - FIFO (First In First Out)
 * - LIFO (Last In First Out)
 * - Weighted Average
 * - Moving Average
 */

import type {
  IValuationMethodStrategy,
  IValuationStrategyFactory,
  ValuationMethod,
  StockBatch,
  IncomingRateResult,
  OutgoingRateResult
} from '../interfaces/IValuationMethodStrategy';

/**
 * FIFO Valuation Strategy
 * الوارد أولاً صادر أولاً
 * 
 * Assumes oldest inventory is sold first.
 * Most commonly used method under IFRS.
 */
export class FIFOValuationStrategy implements IValuationMethodStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ): IncomingRateResult {
    const newQty = prevQty + incomingQty;
    const newQueue = [...prevQueue, { qty: incomingQty, rate: incomingRate }];
    const newValue = prevValue + (incomingQty * incomingRate);
    
    return {
      newQty,
      newRate: prevRate, // FIFO doesn't change rate on incoming
      newValue,
      newQueue
    };
  }

  calculateOutgoingRate(
    qty: number,
    queue: StockBatch[],
    outgoingQty: number
  ): OutgoingRateResult {
    let remaining = outgoingQty;
    let costOfGoodsSold = 0;
    const newQueue: StockBatch[] = [];

    // Take from oldest batches first
    for (const batch of queue) {
      if (remaining <= 0) {
        newQueue.push(batch);
        continue;
      }

      const take = Math.min(batch.qty, remaining);
      costOfGoodsSold += take * batch.rate;
      remaining -= take;

      if (batch.qty > take) {
        newQueue.push({ qty: batch.qty - take, rate: batch.rate });
      }
    }

    const newQty = qty - outgoingQty;
    const rate = outgoingQty > 0 ? costOfGoodsSold / outgoingQty : 0;
    const newValue = newQueue.reduce((sum, b) => sum + (b.qty * b.rate), 0);

    return { costOfGoodsSold, rate, newQty, newQueue, newValue };
  }

  getCurrentRate(queue: StockBatch[]): number {
    return queue.length > 0 ? queue[0].rate : 0;
  }

  getMethodName(): ValuationMethod {
    return 'FIFO';
  }
}

/**
 * LIFO Valuation Strategy
 * الوارد أخيراً صادر أولاً
 * 
 * Assumes newest inventory is sold first.
 * Not allowed under IFRS but permitted under US GAAP.
 */
export class LIFOValuationStrategy implements IValuationMethodStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ): IncomingRateResult {
    const newQty = prevQty + incomingQty;
    const newQueue = [...prevQueue, { qty: incomingQty, rate: incomingRate }];
    const newValue = prevValue + (incomingQty * incomingRate);

    return {
      newQty,
      newRate: incomingRate, // LIFO uses latest rate
      newValue,
      newQueue
    };
  }

  calculateOutgoingRate(
    qty: number,
    queue: StockBatch[],
    outgoingQty: number
  ): OutgoingRateResult {
    let remaining = outgoingQty;
    let costOfGoodsSold = 0;
    const newQueue: StockBatch[] = [];

    // Take from newest batches first (reverse iteration)
    for (let i = queue.length - 1; i >= 0; i--) {
      const batch = queue[i];
      
      if (remaining <= 0) {
        newQueue.unshift(batch);
        continue;
      }

      const take = Math.min(batch.qty, remaining);
      costOfGoodsSold += take * batch.rate;
      remaining -= take;

      if (batch.qty > take) {
        newQueue.unshift({ qty: batch.qty - take, rate: batch.rate });
      }
    }

    const newQty = qty - outgoingQty;
    const rate = outgoingQty > 0 ? costOfGoodsSold / outgoingQty : 0;
    const newValue = newQueue.reduce((sum, b) => sum + (b.qty * b.rate), 0);

    return { costOfGoodsSold, rate, newQty, newQueue, newValue };
  }

  getCurrentRate(queue: StockBatch[]): number {
    return queue.length > 0 ? queue[queue.length - 1].rate : 0;
  }

  getMethodName(): ValuationMethod {
    return 'LIFO';
  }
}

/**
 * Weighted Average Valuation Strategy
 * المتوسط المرجح
 * 
 * Calculates weighted average cost per unit.
 * Common under both IFRS and US GAAP.
 */
export class WeightedAverageValuationStrategy implements IValuationMethodStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ): IncomingRateResult {
    const newQty = prevQty + incomingQty;
    const newValue = prevValue + (incomingQty * incomingRate);
    const newRate = newQty > 0 ? newValue / newQty : 0;

    return {
      newQty,
      newRate,
      newValue,
      newQueue: [{ qty: newQty, rate: newRate }]
    };
  }

  calculateOutgoingRate(
    qty: number,
    queue: StockBatch[],
    outgoingQty: number
  ): OutgoingRateResult {
    const currentRate = queue.length > 0 ? queue[0].rate : 0;
    const costOfGoodsSold = outgoingQty * currentRate;
    const newQty = qty - outgoingQty;
    const newValue = newQty * currentRate;

    return {
      costOfGoodsSold,
      rate: currentRate,
      newQty,
      newQueue: newQty > 0 ? [{ qty: newQty, rate: currentRate }] : [],
      newValue
    };
  }

  getCurrentRate(queue: StockBatch[]): number {
    return queue.length > 0 ? queue[0].rate : 0;
  }

  getMethodName(): ValuationMethod {
    return 'Weighted Average';
  }
}

/**
 * Moving Average Valuation Strategy
 * المتوسط المتحرك
 * 
 * Similar to Weighted Average but recalculates after each transaction.
 * Commonly used in perpetual inventory systems.
 */
export class MovingAverageValuationStrategy extends WeightedAverageValuationStrategy {
  override getMethodName(): ValuationMethod {
    return 'Moving Average';
  }
}

/**
 * ValuationStrategyFactory - Factory Implementation
 * 
 * Creates appropriate valuation strategy based on method.
 * Follows Strategy Pattern.
 */
export class ValuationStrategyFactory implements IValuationStrategyFactory {
  private strategies: Map<ValuationMethod, IValuationMethodStrategy>;

  constructor() {
    this.strategies = new Map([
      ['FIFO', new FIFOValuationStrategy()],
      ['LIFO', new LIFOValuationStrategy()],
      ['Weighted Average', new WeightedAverageValuationStrategy()],
      ['Moving Average', new MovingAverageValuationStrategy()]
    ]);
  }

  getStrategy(method: ValuationMethod): IValuationMethodStrategy {
    const strategy = this.strategies.get(method);
    if (!strategy) {
      // Default to Weighted Average if unknown method
      return this.strategies.get('Weighted Average')!;
    }
    return strategy;
  }

  getSupportedMethods(): ValuationMethod[] {
    return Array.from(this.strategies.keys());
  }
}

// Export singleton factory instance
export const valuationStrategyFactory = new ValuationStrategyFactory();


