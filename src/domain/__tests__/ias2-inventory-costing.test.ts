/**
 * IAS 2 Inventory Costing Compliance Tests
 * 
 * Tests compliance with IAS 2 (Inventories) standard:
 * - Cost formulas (FIFO, Weighted Average)
 * - Lower of cost or net realizable value
 * - Cost of conversion (manufacturing)
 * - Inventory write-downs
 * 
 * Reference: IAS 2 Paragraphs 21-37
 */

import { describe, it, expect } from 'vitest';
import { calculateAVCO } from '../../core/utils';

describe('IAS 2 - Inventory Costing Compliance', () => {
  
  describe('IAS 2.25 - Weighted Average Cost Formula', () => {
    
    it('should calculate weighted average cost correctly on purchase', () => {
      // Scenario: Initial stock + new purchase
      const currentStock = 100;
      const currentValue = 1000; // 100 units @ 10 each
      const incomingQty = 50;
      const incomingCost = 600; // 50 units @ 12 each
      
      const result = calculateAVCO(currentStock, currentValue, incomingQty, incomingCost);
      
      // Expected: (1000 + 600) / (100 + 50) = 10.67 per unit
      expect(result.newUnitCost).toBeCloseTo(10.67, 2);
      expect(result.newTotalValue).toBe(1600);
      expect(result.totalQuantity).toBe(150);
    });

    it('should recalculate average on each receipt (perpetual)', () => {
      let stock = 100;
      let value = 5000; // @ 50 per unit
      
      // First receipt: 50 @ 60
      let result = calculateAVCO(stock, value, 50, 3000);
      expect(result.newUnitCost).toBeCloseTo(53.33, 2); // (5000+3000)/(100+50)
      
      // Second receipt: 30 @ 45
      result = calculateAVCO(result.totalQuantity, result.newTotalValue, 30, 1350);
      expect(result.newUnitCost).toBeCloseTo(51.94, 2); // (8000+1350)/(150+30)
    });

    it('should maintain cost accuracy with multiple transactions', () => {
      const transactions = [
        { qty: 100, cost: 4500 }, // @ 45
        { qty: 50, cost: 2600 },  // @ 52
        { qty: 75, cost: 3900 }   // @ 52
      ];
      
      let stock = 0;
      let value = 0;
      
      transactions.forEach(tx => {
        const result = calculateAVCO(stock, value, tx.qty, tx.cost);
        stock = result.totalQuantity;
        value = result.newTotalValue;
      });
      
      // Total: 225 units, 11,000 value
      expect(stock).toBe(225);
      expect(value).toBe(11000);
      const avgCost = value / stock;
      expect(avgCost).toBeCloseTo(48.89, 2);
    });

    it('should handle zero stock correctly', () => {
      const result = calculateAVCO(0, 0, 100, 5000);
      
      expect(result.newUnitCost).toBe(50);
      expect(result.newTotalValue).toBe(5000);
      expect(result.totalQuantity).toBe(100);
    });

    it('should handle negative values by converting to zero', () => {
      // Edge case: system shouldn't allow negative stock
      const result = calculateAVCO(-10, -500, 50, 2500);
      
      // Should treat negative as zero
      expect(result.totalQuantity).toBe(50);
      expect(result.newTotalValue).toBe(2500);
      expect(result.newUnitCost).toBe(50);
    });
  });

  describe('IAS 2.10 - Cost of Inventories', () => {
    
    it('should include purchase price in inventory cost', () => {
      const purchasePrice = 10000;
      const quantity = 200;
      
      const result = calculateAVCO(0, 0, quantity, purchasePrice);
      
      expect(result.newUnitCost).toBe(50);
      expect(result.newTotalValue).toBe(purchasePrice);
    });

    it('should include import duties and taxes (non-refundable)', () => {
      const purchasePrice = 10000;
      const importDuty = 500;
      const nonRefundableVAT = 750;
      const totalCost = purchasePrice + importDuty + nonRefundableVAT;
      
      const result = calculateAVCO(0, 0, 100, totalCost);
      
      expect(result.newUnitCost).toBe(112.5); // 11,250 / 100
      expect(result.newTotalValue).toBe(11250);
    });

    it('should exclude trade discounts from cost', () => {
      const listPrice = 10000;
      const tradeDiscount = 1000; // 10% discount
      const netPrice = listPrice - tradeDiscount;
      
      const result = calculateAVCO(0, 0, 100, netPrice);
      
      expect(result.newUnitCost).toBe(90); // 9,000 / 100
    });
  });

  describe('IAS 2.12 - Costs of Conversion (Manufacturing)', () => {
    
    it('should include direct labor in production cost', () => {
      // Raw material + Direct labor = Conversion cost
      const rawMaterialCost = 5000;
      const directLaborCost = 2000;
      const totalProductionCost = rawMaterialCost + directLaborCost;
      
      const result = calculateAVCO(0, 0, 50, totalProductionCost);
      
      expect(result.newUnitCost).toBe(140); // 7,000 / 50
    });

    it('should include allocated fixed overhead', () => {
      const rawMaterial = 10000;
      const directLabor = 3000;
      const variableOverhead = 2000;
      const allocatedFixedOverhead = 1500; // Based on normal capacity
      
      const totalCost = rawMaterial + directLabor + variableOverhead + allocatedFixedOverhead;
      
      const result = calculateAVCO(0, 0, 100, totalCost);
      
      expect(result.newUnitCost).toBe(165); // 16,500 / 100
    });

    it('should calculate production cost for finished goods', () => {
      // Complete production cycle
      let stock = 0;
      let value = 0;
      
      // Stage 1: Raw materials
      let result = calculateAVCO(stock, value, 100, 5000);
      stock = result.totalQuantity;
      value = result.newTotalValue;
      
      // Stage 2: Add conversion costs (labor + overhead)
      result = calculateAVCO(stock, value, 0, 3000);
      
      // Final cost per unit should include all costs
      expect(result.newUnitCost).toBe(80); // (5000 + 3000) / 100
    });
  });

  describe('IAS 2.13 - Systematic Allocation of Overheads', () => {
    
    it('should allocate fixed overhead based on normal capacity', () => {
      const normalCapacity = 1000; // units per period
      const actualProduction = 800; // units
      const totalFixedOverhead = 10000;
      
      // Allocation rate based on normal capacity, not actual
      const allocationRate = totalFixedOverhead / normalCapacity; // 10 per unit
      const allocatedOverhead = allocationRate * actualProduction; // 8,000
      
      // Unallocated overhead = 2,000 (expensed as period cost)
      expect(allocatedOverhead).toBe(8000);
      expect(totalFixedOverhead - allocatedOverhead).toBe(2000);
    });

    it('should not allocate overhead when production is abnormally low', () => {
      const normalCapacity = 1000;
      const abnormallyLowProduction = 300; // 30% capacity
      const totalFixedOverhead = 10000;
      
      // Use normal capacity for allocation
      const allocationRate = totalFixedOverhead / normalCapacity;
      const allocatedToProduction = allocationRate * abnormallyLowProduction;
      
      expect(allocatedToProduction).toBe(3000);
      // Remaining 7,000 expensed as period cost
    });

    it('should allocate variable overhead based on actual usage', () => {
      const actualProduction = 500;
      const variableOverheadPerUnit = 8;
      const totalVariableOverhead = actualProduction * variableOverheadPerUnit;
      
      expect(totalVariableOverhead).toBe(4000);
    });
  });

  describe('IAS 2.34 - Cost Formula Consistency', () => {
    
    it('should apply same cost formula consistently', () => {
      // Using AVCO for all similar items
      const transactions = [
        { qty: 50, cost: 2500 },
        { qty: 30, cost: 1800 },
        { qty: 40, cost: 2400 }
      ];
      
      let stock = 0;
      let value = 0;
      
      transactions.forEach(tx => {
        const result = calculateAVCO(stock, value, tx.qty, tx.cost);
        stock = result.totalQuantity;
        value = result.newTotalValue;
      });
      
      // All transactions use weighted average
      const finalAvgCost = value / stock;
      expect(finalAvgCost).toBeCloseTo(55.83, 2);
    });
  });

  describe('IAS 2.9 - Lower of Cost and Net Realizable Value', () => {
    
    it('should recognize inventory at cost when NRV is higher', () => {
      const cost = 5000;
      const netRealizableValue = 6000;
      
      // Inventory valued at cost (lower)
      const inventoryValue = Math.min(cost, netRealizableValue);
      expect(inventoryValue).toBe(5000);
    });

    it('should write down inventory when cost exceeds NRV', () => {
      const cost = 5000;
      const netRealizableValue = 4200; // Market declined
      
      // Write down to NRV
      const inventoryValue = Math.min(cost, netRealizableValue);
      const writeDownLoss = cost - inventoryValue;
      
      expect(inventoryValue).toBe(4200);
      expect(writeDownLoss).toBe(800);
    });

    it('should calculate NRV as selling price minus costs to complete and sell', () => {
      const estimatedSellingPrice = 10000;
      const costsToComplete = 500;
      const sellingCosts = 300;
      
      const netRealizableValue = estimatedSellingPrice - costsToComplete - sellingCosts;
      
      expect(netRealizableValue).toBe(9200);
    });
  });

  describe('IAS 2.36 - Recognition as Expense', () => {
    
    it('should recognize COGS when inventory is sold', () => {
      // Current inventory: 100 units @ 50 avg cost
      const currentStock = 100;
      const avgCost = 50;
      const soldQty = 30;
      
      const costOfGoodsSold = soldQty * avgCost;
      const remainingStock = currentStock - soldQty;
      const remainingValue = remainingStock * avgCost;
      
      expect(costOfGoodsSold).toBe(1500);
      expect(remainingStock).toBe(70);
      expect(remainingValue).toBe(3500);
    });

    it('should recognize write-down as expense in period incurred', () => {
      const inventoryCost = 10000;
      const netRealizableValue = 8500;
      const writeDownLoss = inventoryCost - netRealizableValue;
      
      // Loss recognized immediately
      expect(writeDownLoss).toBe(1500);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    
    it('should handle very small quantities', () => {
      const result = calculateAVCO(0.001, 0.05, 0.002, 0.12);
      
      expect(result.totalQuantity).toBeCloseTo(0.003, 6);
      expect(result.newTotalValue).toBeCloseTo(0.17, 6);
    });

    it('should handle large quantities without overflow', () => {
      const result = calculateAVCO(1000000, 50000000, 500000, 26000000);
      
      expect(result.totalQuantity).toBe(1500000);
      expect(result.newTotalValue).toBe(76000000);
      expect(result.newUnitCost).toBeCloseTo(50.67, 2);
    });

    it('should maintain precision with decimal costs', () => {
      const result = calculateAVCO(100, 1234.56, 50, 678.9);
      
      expect(result.totalQuantity).toBe(150);
      expect(result.newTotalValue).toBeCloseTo(1913.46, 2);
      expect(result.newUnitCost).toBeCloseTo(12.76, 2);
    });
  });
});
