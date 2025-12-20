/**
 * @fileoverview Tests for Valuation Strategies
 * Tests FIFO, LIFO, Weighted Average, Moving Average implementations
 */

import { describe, it, expect } from 'vitest';
import {
  FIFOValuationStrategy,
  LIFOValuationStrategy,
  WeightedAverageValuationStrategy,
  MovingAverageValuationStrategy,
  ValuationStrategyFactory
} from '../ValuationStrategies';
import type { StockBatch } from '../../interfaces/IValuationMethodStrategy';

describe('FIFOValuationStrategy', () => {
  const fifo = new FIFOValuationStrategy();

  describe('calculateIncomingRate', () => {
    it('should add new batch to queue', () => {
      const result = fifo.calculateIncomingRate(0, 0, 0, [], 100, 10);
      
      expect(result.newQty).toBe(100);
      expect(result.newValue).toBe(1000);
      expect(result.newQueue).toHaveLength(1);
      expect(result.newQueue[0]).toEqual({ qty: 100, rate: 10 });
    });

    it('should append to existing queue', () => {
      const prevQueue: StockBatch[] = [{ qty: 50, rate: 8 }];
      const result = fifo.calculateIncomingRate(50, 8, 400, prevQueue, 100, 12);
      
      expect(result.newQty).toBe(150);
      expect(result.newValue).toBe(1600); // 400 + 1200
      expect(result.newQueue).toHaveLength(2);
    });

    it('should not change rate on incoming (FIFO behavior)', () => {
      const result = fifo.calculateIncomingRate(50, 10, 500, [], 100, 15);
      expect(result.newRate).toBe(10); // Rate unchanged
    });
  });

  describe('calculateOutgoingRate', () => {
    it('should take from oldest batch first', () => {
      const queue: StockBatch[] = [
        { qty: 50, rate: 10 },
        { qty: 100, rate: 15 }
      ];
      
      const result = fifo.calculateOutgoingRate(150, queue, 30);
      
      expect(result.costOfGoodsSold).toBe(300); // 30 * 10
      expect(result.rate).toBe(10);
      expect(result.newQty).toBe(120);
      expect(result.newQueue[0].qty).toBe(20); // 50 - 30
    });

    it('should span multiple batches when needed', () => {
      const queue: StockBatch[] = [
        { qty: 30, rate: 10 },
        { qty: 70, rate: 15 }
      ];
      
      const result = fifo.calculateOutgoingRate(100, queue, 50);
      
      expect(result.costOfGoodsSold).toBe(600); // 30*10 + 20*15
      expect(result.newQty).toBe(50);
      expect(result.newQueue).toHaveLength(1);
      expect(result.newQueue[0].qty).toBe(50);
    });

    it('should handle zero outgoing quantity', () => {
      const queue: StockBatch[] = [{ qty: 100, rate: 10 }];
      const result = fifo.calculateOutgoingRate(100, queue, 0);
      
      expect(result.costOfGoodsSold).toBe(0);
      expect(result.rate).toBe(0);
      expect(result.newQty).toBe(100);
    });

    it('should empty entire queue', () => {
      const queue: StockBatch[] = [{ qty: 50, rate: 10 }];
      const result = fifo.calculateOutgoingRate(50, queue, 50);
      
      expect(result.newQty).toBe(0);
      expect(result.newQueue).toHaveLength(0);
    });
  });

  describe('getCurrentRate', () => {
    it('should return first batch rate', () => {
      const queue: StockBatch[] = [
        { qty: 50, rate: 10 },
        { qty: 100, rate: 15 }
      ];
      expect(fifo.getCurrentRate(queue)).toBe(10);
    });

    it('should return 0 for empty queue', () => {
      expect(fifo.getCurrentRate([])).toBe(0);
    });
  });

  describe('getMethodName', () => {
    it('should return FIFO', () => {
      expect(fifo.getMethodName()).toBe('FIFO');
    });
  });
});

describe('LIFOValuationStrategy', () => {
  const lifo = new LIFOValuationStrategy();

  describe('calculateIncomingRate', () => {
    it('should add new batch to queue', () => {
      const result = lifo.calculateIncomingRate(0, 0, 0, [], 100, 10);
      
      expect(result.newQty).toBe(100);
      expect(result.newValue).toBe(1000);
    });
  });

  describe('calculateOutgoingRate', () => {
    it('should take from newest batch first', () => {
      const queue: StockBatch[] = [
        { qty: 50, rate: 10 },
        { qty: 100, rate: 15 }
      ];
      
      const result = lifo.calculateOutgoingRate(150, queue, 30);
      
      expect(result.costOfGoodsSold).toBe(450); // 30 * 15
      expect(result.rate).toBe(15);
    });

    it('should span multiple batches from end', () => {
      const queue: StockBatch[] = [
        { qty: 50, rate: 10 },
        { qty: 30, rate: 15 }
      ];
      
      const result = lifo.calculateOutgoingRate(80, queue, 40);
      
      // Takes 30 from last batch (15) + 10 from first (10)
      expect(result.costOfGoodsSold).toBe(550); // 30*15 + 10*10
      expect(result.newQty).toBe(40);
    });
  });

  describe('getCurrentRate', () => {
    it('should return last batch rate', () => {
      const queue: StockBatch[] = [
        { qty: 50, rate: 10 },
        { qty: 100, rate: 15 }
      ];
      expect(lifo.getCurrentRate(queue)).toBe(15);
    });
  });

  describe('getMethodName', () => {
    it('should return LIFO', () => {
      expect(lifo.getMethodName()).toBe('LIFO');
    });
  });
});

describe('WeightedAverageValuationStrategy', () => {
  const wa = new WeightedAverageValuationStrategy();

  describe('calculateIncomingRate', () => {
    it('should calculate weighted average on incoming', () => {
      // Existing: 100 units @ 10 = 1000
      // Incoming: 100 units @ 20 = 2000
      // Total: 200 units, value = 3000, rate = 15
      const result = wa.calculateIncomingRate(100, 10, 1000, [], 100, 20);
      
      expect(result.newQty).toBe(200);
      expect(result.newValue).toBe(3000);
      expect(result.newRate).toBe(15);
    });

    it('should handle first incoming', () => {
      const result = wa.calculateIncomingRate(0, 0, 0, [], 50, 10);
      
      expect(result.newQty).toBe(50);
      expect(result.newRate).toBe(10);
    });

    it('should handle small quantities', () => {
      const result = wa.calculateIncomingRate(10, 5, 50, [], 10, 15);
      
      expect(result.newQty).toBe(20);
      expect(result.newRate).toBe(10); // (50 + 150) / 20
    });
  });

  describe('calculateOutgoingRate', () => {
    it('should use average rate for all outgoing', () => {
      const queue: StockBatch[] = [{ qty: 100, rate: 15 }]; // WA rate stored
      
      const result = wa.calculateOutgoingRate(100, queue, 40);
      
      expect(result.rate).toBe(15);
      expect(result.costOfGoodsSold).toBe(600); // 40 * 15
      expect(result.newQty).toBe(60);
    });
  });

  describe('getCurrentRate', () => {
    it('should return single batch rate (weighted average)', () => {
      const queue: StockBatch[] = [{ qty: 100, rate: 12.5 }];
      expect(wa.getCurrentRate(queue)).toBe(12.5);
    });
  });

  describe('getMethodName', () => {
    it('should return Weighted Average', () => {
      expect(wa.getMethodName()).toBe('Weighted Average');
    });
  });
});

describe('MovingAverageValuationStrategy', () => {
  const ma = new MovingAverageValuationStrategy();

  describe('calculateIncomingRate', () => {
    it('should recalculate moving average on each incoming', () => {
      const result = ma.calculateIncomingRate(100, 10, 1000, [], 50, 16);
      
      // New value: 1000 + 800 = 1800
      // New qty: 150
      // New rate: 12
      expect(result.newQty).toBe(150);
      expect(result.newValue).toBe(1800);
      expect(result.newRate).toBe(12);
    });
  });

  describe('calculateOutgoingRate', () => {
    it('should use current moving average for outgoing', () => {
      const queue: StockBatch[] = [{ qty: 100, rate: 12 }];
      
      const result = ma.calculateOutgoingRate(100, queue, 30);
      
      expect(result.rate).toBe(12);
      expect(result.costOfGoodsSold).toBe(360);
    });
  });

  describe('getMethodName', () => {
    it('should return Moving Average', () => {
      expect(ma.getMethodName()).toBe('Moving Average');
    });
  });
});

describe('ValuationStrategyFactory', () => {
  const factory = new ValuationStrategyFactory();

  it('should create FIFO strategy', () => {
    const strategy = factory.getStrategy('FIFO');
    expect(strategy.getMethodName()).toBe('FIFO');
  });

  it('should create LIFO strategy', () => {
    const strategy = factory.getStrategy('LIFO');
    expect(strategy.getMethodName()).toBe('LIFO');
  });

  it('should create WEIGHTED_AVERAGE strategy', () => {
    const strategy = factory.getStrategy('Weighted Average');
    expect(strategy.getMethodName()).toBe('Weighted Average');
  });

  it('should create MOVING_AVERAGE strategy', () => {
    const strategy = factory.getStrategy('Moving Average');
    expect(strategy.getMethodName()).toBe('Moving Average');
  });

  it('should return Weighted Average for unknown method', () => {
    const strategy = factory.getStrategy('UNKNOWN' as any);
    expect(strategy.getMethodName()).toBe('Weighted Average');
  });

  it('should list all available methods', () => {
    const methods = factory.getSupportedMethods();
    expect(methods).toContain('FIFO');
    expect(methods).toContain('LIFO');
    expect(methods).toContain('Weighted Average');
    expect(methods).toContain('Moving Average');
  });
});

describe('Real-world Scenarios', () => {
  describe('Manufacturing Inventory Flow', () => {
    it('should handle raw material purchases and consumption (FIFO)', () => {
      const fifo = new FIFOValuationStrategy();
      
      // Purchase 1: 100 kg @ 50 SAR
      let result = fifo.calculateIncomingRate(0, 0, 0, [], 100, 50);
      expect(result.newQty).toBe(100);
      expect(result.newValue).toBe(5000);
      
      // Purchase 2: 150 kg @ 55 SAR
      result = fifo.calculateIncomingRate(100, 50, 5000, result.newQueue, 150, 55);
      expect(result.newQty).toBe(250);
      expect(result.newValue).toBe(13250);
      
      // Consume 80 kg for production
      const outResult = fifo.calculateOutgoingRate(250, result.newQueue, 80);
      expect(outResult.costOfGoodsSold).toBe(4000); // 80 * 50 (oldest first)
      expect(outResult.newQty).toBe(170);
    });

    it('should handle price fluctuations (LIFO)', () => {
      const lifo = new LIFOValuationStrategy();
      
      // Buy at 100, then 120, then 110
      let queue: StockBatch[] = [];
      let result = lifo.calculateIncomingRate(0, 0, 0, queue, 50, 100);
      queue = result.newQueue;
      
      result = lifo.calculateIncomingRate(50, 100, 5000, queue, 50, 120);
      queue = result.newQueue;
      
      result = lifo.calculateIncomingRate(100, 110, 11000, queue, 50, 110);
      queue = result.newQueue;
      
      // Sell 60 units - should use 110 then 120
      const outResult = lifo.calculateOutgoingRate(150, queue, 60);
      expect(outResult.costOfGoodsSold).toBe(6700); // 50*110 + 10*120
    });
  });

  describe('IAS 2 Compliance', () => {
    it('FIFO: Ending inventory at recent prices', () => {
      const fifo = new FIFOValuationStrategy();
      
      const queue: StockBatch[] = [
        { qty: 20, rate: 100 },  // Old
        { qty: 30, rate: 120 },  // Recent
        { qty: 50, rate: 130 }   // Most recent
      ];
      
      // Sell 40 units (uses all 20@100 and 20@120)
      const result = fifo.calculateOutgoingRate(100, queue, 40);
      
      // Remaining: 10@120 + 50@130, first batch should be 120
      expect(result.newQueue[0].rate).toBe(120);
      expect(result.newQueue.length).toBe(2);
    });

    it('Weighted Average: Smooths price fluctuations', () => {
      const wa = new WeightedAverageValuationStrategy();
      
      // Volatile prices: 100, 150, 80
      let result = wa.calculateIncomingRate(0, 0, 0, [], 100, 100);
      result = wa.calculateIncomingRate(100, 100, 10000, result.newQueue, 100, 150);
      result = wa.calculateIncomingRate(200, 125, 25000, result.newQueue, 100, 80);
      
      // Rate should be smoothed
      expect(result.newRate).toBeCloseTo(110, 0); // (10000+15000+8000)/300
    });
  });
});
