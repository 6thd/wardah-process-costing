/**
 * Valuation Service - Inventory Valuation Methods
 * IAS 2 Compliant: FIFO, LIFO, Weighted Average
 */

export type ValuationMethod = 'FIFO' | 'LIFO' | 'Weighted Average' | 'Moving Average';

export interface StockBatch {
  qty: number;
  rate: number;
}

export interface ValuationStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ): {
    newQty: number;
    newRate: number;
    newValue: number;
    newQueue: StockBatch[];
  };

  calculateOutgoingRate(
    qty: number,
    queue: StockBatch[],
    outgoingQty: number
  ): {
    costOfGoodsSold: number;
    rate: number;
    newQty: number;
    newQueue: StockBatch[];
    newValue: number;
  };

  getCurrentRate(queue: StockBatch[]): number;
}

/**
 * FIFO (First In First Out) - الوارد أولاً صادر أولاً
 * IAS 2: Assumes oldest inventory is sold first
 */
class FIFOValuation implements ValuationStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ) {
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

  calculateOutgoingRate(qty: number, queue: StockBatch[], outgoingQty: number) {
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
}

/**
 * LIFO (Last In First Out) - الوارد أخيراً صادر أولاً
 * IAS 2: Assumes newest inventory is sold first
 */
class LIFOValuation implements ValuationStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ) {
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

  calculateOutgoingRate(qty: number, queue: StockBatch[], outgoingQty: number) {
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
}

/**
 * Weighted Average - المتوسط المرجح
 * IAS 2: Calculates weighted average cost per unit
 */
class WeightedAverageValuation implements ValuationStrategy {
  calculateIncomingRate(
    prevQty: number,
    prevRate: number,
    prevValue: number,
    prevQueue: StockBatch[],
    incomingQty: number,
    incomingRate: number
  ) {
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

  calculateOutgoingRate(qty: number, queue: StockBatch[], outgoingQty: number) {
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
}

/**
 * Moving Average - المتوسط المتحرك
 * Similar to Weighted Average but recalculates after each transaction
 */
class MovingAverageValuation extends WeightedAverageValuation {}

/**
 * ValuationFactory - Strategy Pattern
 * Returns appropriate valuation strategy based on method
 */
export const ValuationFactory = {
  getStrategy(method: ValuationMethod): ValuationStrategy {
    switch (method) {
      case 'FIFO':
        return new FIFOValuation();
      case 'LIFO':
        return new LIFOValuation();
      case 'Moving Average':
        return new MovingAverageValuation();
      case 'Weighted Average':
      default:
        return new WeightedAverageValuation();
    }
  }
};
