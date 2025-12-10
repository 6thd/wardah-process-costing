/**
 * Unit Tests for Inventory Valuation System
 * Tests FIFO, LIFO, and Weighted Average methods
 * 
 * Note: These tests use mock implementations as the actual valuation classes
 * are not yet implemented. Once implemented, update imports to use actual classes.
 */

import { describe, it, expect } from 'vitest';

// Mock types
export interface StockBatch {
  qty: number;
  rate: number;
}

// Mock implementations for testing
class FIFOValuation {
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
    return { newQty, newRate: prevRate, newValue, newQueue };
  }

  calculateOutgoingRate(qty: number, queue: StockBatch[], outgoingQty: number) {
    if (outgoingQty > qty) {
      throw new Error(`Cannot issue ${outgoingQty} units. Only ${qty} units available`);
    }
    let remaining = outgoingQty;
    let costOfGoodsSold = 0;
    const newQueue: StockBatch[] = [];
    
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
    return { costOfGoodsSold, rate, newQty, newQueue };
  }
}

class LIFOValuation {
  // NOSONAR S4144 - calculateIncomingRate has same signature as FIFO but different semantic meaning (LIFO vs FIFO)
  // The implementation is intentionally similar for incoming stock, but outgoing logic differs
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
    return { newQty, newRate: prevRate, newValue, newQueue };
  }

  calculateOutgoingRate(qty: number, queue: StockBatch[], outgoingQty: number) {
    if (outgoingQty > qty) {
      throw new Error(`Cannot issue ${outgoingQty} units. Only ${qty} units available`);
    }
    let remaining = outgoingQty;
    let costOfGoodsSold = 0;
    const newQueue: StockBatch[] = [];
    
    // Process from end (newest first)
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
    return { costOfGoodsSold, rate, newQty, newQueue };
  }

  getCurrentRate(queue: StockBatch[]): number {
    return queue.length > 0 ? queue[queue.length - 1].rate : 0;
  }
}

class WeightedAverageValuation {
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
    const newQueue = [{ qty: newQty, rate: newRate }];
    return { newQty, newRate, newValue, newQueue };
  }

  calculateOutgoingRate(qty: number, queue: StockBatch[], outgoingQty: number) {
    if (outgoingQty > qty) {
      throw new Error(`Cannot issue ${outgoingQty} units. Only ${qty} units available`);
    }
    const currentRate = queue.length > 0 ? queue[0].rate : 0;
    const costOfGoodsSold = outgoingQty * currentRate;
    const newQty = qty - outgoingQty;
    const newQueue = newQty > 0 ? [{ qty: newQty, rate: currentRate }] : [];
    return { costOfGoodsSold, rate: currentRate, newQty, newQueue };
  }
}

class ValuationFactory {
  static getStrategy(method: string | null) {
    switch (method) {
      case 'FIFO':
        return new FIFOValuation();
      case 'LIFO':
        return new LIFOValuation();
      case 'Weighted Average':
      default:
        return new WeightedAverageValuation();
    }
  }

  static isValidMethod(method: string): boolean {
    return ['FIFO', 'LIFO', 'Weighted Average'].includes(method);
  }

  static getSupportedMethods(): string[] {
    return ['FIFO', 'LIFO', 'Weighted Average'];
  }

  static getMethodNameAr(method: string): string {
    const names: Record<string, string> = {
      'FIFO': 'الوارد أولاً صادر أولاً',
      'LIFO': 'الوارد أخيراً صادر أولاً',
      'Weighted Average': 'المتوسط المرجح'
    };
    return names[method] || method;
  }
}

describe('FIFO Valuation', () => {
  const fifo = new FIFOValuation();

  it('should add incoming stock to end of queue', () => {
    const result = fifo.calculateIncomingRate(
      100, // prevQty
      45,  // prevRate
      4500, // prevValue
      [{ qty: 100, rate: 45 }], // prevQueue
      50,  // incomingQty
      55   // incomingRate
    );

    expect(result.newQty).toBe(150);
    expect(result.newQueue.length).toBe(2);
    expect(result.newQueue[0]).toEqual({ qty: 100, rate: 45 });
    expect(result.newQueue[1]).toEqual({ qty: 50, rate: 55 });
  });

  it('should issue stock from oldest batches first', () => {
    const queue: StockBatch[] = [
      { qty: 100, rate: 45 },
      { qty: 50, rate: 55 }
    ];

    const result = fifo.calculateOutgoingRate(150, queue, 120);

    // Should take 100 from first batch, 20 from second
    // COGS = (100 × 45) + (20 × 55) = 4,500 + 1,100 = 5,600
    expect(result.costOfGoodsSold).toBe(5600);
    expect(result.rate).toBeCloseTo(46.67, 2);
    expect(result.newQty).toBe(30);
    expect(result.newQueue.length).toBe(1);
    expect(result.newQueue[0]).toEqual({ qty: 30, rate: 55 });
  });

  it('should throw error for insufficient stock', () => {
    const queue: StockBatch[] = [{ qty: 50, rate: 45 }];

    expect(() => {
      fifo.calculateOutgoingRate(50, queue, 100);
    }).toThrow('Cannot issue 100 units. Only 50 units available');
  });

  it('should handle empty queue for incoming', () => {
    const result = fifo.calculateIncomingRate(
      0, 0, 0, [],
      100, 50
    );

    expect(result.newQty).toBe(100);
    expect(result.newQueue.length).toBe(1);
    expect(result.newQueue[0]).toEqual({ qty: 100, rate: 50 });
  });
});

describe('LIFO Valuation', () => {
  const lifo = new LIFOValuation();

  it('should add incoming stock to end of stack', () => {
    const result = lifo.calculateIncomingRate(
      100, 45, 4500,
      [{ qty: 100, rate: 45 }],
      50, 55
    );

    expect(result.newQty).toBe(150);
    expect(result.newQueue.length).toBe(2);
    expect(result.newQueue[1]).toEqual({ qty: 50, rate: 55 }); // Last = newest
  });

  it('should issue stock from newest batches first', () => {
    const queue: StockBatch[] = [
      { qty: 100, rate: 45 },
      { qty: 50, rate: 55 }
    ];

    const result = lifo.calculateOutgoingRate(150, queue, 70);

    // Should take 50 from last batch, 20 from previous
    // COGS = (50 × 55) + (20 × 45) = 2,750 + 900 = 3,650
    expect(result.costOfGoodsSold).toBe(3650);
    expect(result.rate).toBeCloseTo(52.14, 2);
    expect(result.newQty).toBe(80);
    expect(result.newQueue.length).toBe(1);
    expect(result.newQueue[0]).toEqual({ qty: 80, rate: 45 });
  });

  it('should handle multiple batch depletion', () => {
    const queue: StockBatch[] = [
      { qty: 100, rate: 40 },
      { qty: 50, rate: 45 },
      { qty: 30, rate: 50 }
    ];

    const result = lifo.calculateOutgoingRate(180, queue, 75);

    // Take 30 from newest (30 × 50 = 1,500)
    // Take 45 from middle (45 × 45 = 2,025)
    // COGS = 3,525
    expect(result.costOfGoodsSold).toBe(3525);
    expect(result.newQty).toBe(105);
    expect(result.newQueue.length).toBe(2);
  });

  it('should get current rate from newest batch', () => {
    const queue: StockBatch[] = [
      { qty: 100, rate: 40 },
      { qty: 50, rate: 50 }
    ];

    const rate = lifo.getCurrentRate(queue);
    expect(rate).toBe(50); // Last batch
  });
});

describe('Weighted Average Valuation', () => {
  const avco = new WeightedAverageValuation();

  it('should calculate weighted average on incoming', () => {
    const result = avco.calculateIncomingRate(
      100, // 100 units @ 45
      45,
      4500,
      [{ qty: 100, rate: 45 }],
      50,  // + 50 units @ 55
      55
    );

    // New avg = (4500 + 2750) / 150 = 48.33
    expect(result.newQty).toBe(150);
    expect(result.newRate).toBeCloseTo(48.33, 2);
    expect(result.newValue).toBe(7250);
    expect(result.newQueue.length).toBe(1);
    expect(result.newQueue[0].qty).toBe(150);
  });

  it('should use same rate for all outgoing', () => {
    const queue: StockBatch[] = [{ qty: 150, rate: 48.33 }];

    const result = avco.calculateOutgoingRate(150, queue, 120);

    // COGS = 120 × 48.33 = 5,799.60
    expect(result.costOfGoodsSold).toBeCloseTo(5799.6, 1);
    expect(result.rate).toBeCloseTo(48.33, 2);
    expect(result.newQty).toBe(30);
    expect(result.newQueue[0]).toEqual({ qty: 30, rate: 48.33 });
  });

  it('should maintain single batch in queue', () => {
    let queue: StockBatch[] = [];

    // First purchase
    let result = avco.calculateIncomingRate(0, 0, 0, queue, 100, 50);
    expect(result.newQueue.length).toBe(1);

    // Second purchase
    result = avco.calculateIncomingRate(
      result.newQty,
      result.newRate,
      result.newValue,
      result.newQueue,
      50,
      60
    );
    expect(result.newQueue.length).toBe(1); // Still single batch
    expect(result.newQty).toBe(150);
  });

  it('should handle zero quantity gracefully', () => {
    const queue: StockBatch[] = [{ qty: 100, rate: 45 }];
    const result = avco.calculateOutgoingRate(100, queue, 100);

    expect(result.newQty).toBe(0);
    expect(result.newQueue.length).toBe(0);
  });
});

describe('Valuation Factory', () => {
  it('should return FIFO strategy', () => {
    const strategy = ValuationFactory.getStrategy('FIFO');
    expect(strategy).toBeInstanceOf(FIFOValuation);
  });

  it('should return LIFO strategy', () => {
    const strategy = ValuationFactory.getStrategy('LIFO');
    expect(strategy).toBeInstanceOf(LIFOValuation);
  });

  it('should return Weighted Average strategy', () => {
    const strategy = ValuationFactory.getStrategy('Weighted Average');
    expect(strategy).toBeInstanceOf(WeightedAverageValuation);
  });

  it('should return Weighted Average as default', () => {
    const strategy = ValuationFactory.getStrategy(null);
    expect(strategy).toBeInstanceOf(WeightedAverageValuation);
  });

  it('should validate method names', () => {
    expect(ValuationFactory.isValidMethod('FIFO')).toBe(true);
    expect(ValuationFactory.isValidMethod('LIFO')).toBe(true);
    expect(ValuationFactory.isValidMethod('Weighted Average')).toBe(true);
    expect(ValuationFactory.isValidMethod('Invalid')).toBe(false);
  });

  it('should return supported methods list', () => {
    const methods = ValuationFactory.getSupportedMethods();
    expect(methods).toContain('FIFO');
    expect(methods).toContain('LIFO');
    expect(methods).toContain('Weighted Average');
  });

  it('should return Arabic method names', () => {
    expect(ValuationFactory.getMethodNameAr('FIFO')).toBe('الوارد أولاً صادر أولاً');
    expect(ValuationFactory.getMethodNameAr('LIFO')).toBe('الوارد أخيراً صادر أولاً');
    expect(ValuationFactory.getMethodNameAr('Weighted Average')).toBe('المتوسط المرجح');
  });
});

describe('Integration Scenarios', () => {
  it('should handle complete FIFO lifecycle', () => {
    const fifo = new FIFOValuation();
    let queue: StockBatch[] = [];
    let qty = 0;
    let value = 0;

    // Purchase 1
    let incoming = fifo.calculateIncomingRate(qty, 0, value, queue, 100, 45);
    queue = incoming.newQueue;
    qty = incoming.newQty;
    value = incoming.newValue;

    // Purchase 2
    incoming = fifo.calculateIncomingRate(qty, 0, value, queue, 50, 55);
    queue = incoming.newQueue;
    qty = incoming.newQty;
    // value is calculated but not used in assertions - kept for consistency with calculation pattern
    const finalValue = incoming.newValue;

    expect(qty).toBe(150);
    expect(queue.length).toBe(2);

    // Issue
    const outgoing = fifo.calculateOutgoingRate(qty, queue, 120);
    
    expect(outgoing.costOfGoodsSold).toBe(5600);
    expect(outgoing.newQty).toBe(30);
    expect(outgoing.newQueue.length).toBe(1);
    expect(outgoing.newQueue[0].rate).toBe(55);
  });

  it('should compare FIFO vs LIFO COGS', () => {
    const fifo = new FIFOValuation();
    const lifo = new LIFOValuation();
    
    const queue: StockBatch[] = [
      { qty: 100, rate: 40 },
      { qty: 50, rate: 50 }
    ];

    const fifoResult = fifo.calculateOutgoingRate(150, queue, 120);
    const lifoResult = lifo.calculateOutgoingRate(150, [...queue], 120);

    // FIFO: (100 × 40) + (20 × 50) = 4,000 + 1,000 = 5,000
    expect(fifoResult.costOfGoodsSold).toBe(5000);
    
    // LIFO: (50 × 50) + (70 × 40) = 2,500 + 2,800 = 5,300
    // LIFO takes from newest batch first (50 @ 50), then older (70 @ 40)
    expect(lifoResult.costOfGoodsSold).toBe(5300);

    // LIFO usually results in higher COGS when prices are rising
    expect(lifoResult.costOfGoodsSold).toBeGreaterThan(fifoResult.costOfGoodsSold);
  });

  it('should handle price fluctuations correctly', () => {
    const avco = new WeightedAverageValuation();
    let queue: StockBatch[] = [];

    // Purchase at different prices
    let result = avco.calculateIncomingRate(0, 0, 0, queue, 100, 50);
    result = avco.calculateIncomingRate(
      result.newQty, result.newRate, result.newValue, result.newQueue,
      50, 60
    );
    result = avco.calculateIncomingRate(
      result.newQty, result.newRate, result.newValue, result.newQueue,
      50, 40
    );

    // Average = (5000 + 3000 + 2000) / 200 = 50
    expect(result.newRate).toBe(50);
    expect(result.newQty).toBe(200);

    // All issues use same average
    const outgoing = avco.calculateOutgoingRate(200, result.newQueue, 100);
    expect(outgoing.rate).toBe(50);
    expect(outgoing.costOfGoodsSold).toBe(5000);
  });
});
