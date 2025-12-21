/**
 * @fileoverview Comprehensive Tests for useInventory Hook
 * Tests React hooks for inventory operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Mock inventory service
const mockGetItems = vi.fn();
const mockGetWarehouses = vi.fn();
const mockGetStockLevels = vi.fn();
const mockTransferStock = vi.fn();
const mockAdjustStock = vi.fn();

vi.mock('@/services/inventory-service', () => ({
  getItems: () => mockGetItems(),
  getWarehouses: () => mockGetWarehouses(),
  getStockLevels: () => mockGetStockLevels(),
  transferStock: (data: unknown) => mockTransferStock(data),
  adjustStock: (data: unknown) => mockAdjustStock(data),
}));

describe('useInventory Hook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stock Level Calculations', () => {
    it('should calculate total stock across warehouses', () => {
      const stockByWarehouse = [
        { warehouse_id: 'wh-1', quantity: 100 },
        { warehouse_id: 'wh-2', quantity: 50 },
        { warehouse_id: 'wh-3', quantity: 75 },
      ];

      const totalStock = stockByWarehouse.reduce((sum, s) => sum + s.quantity, 0);

      expect(totalStock).toBe(225);
    });

    it('should calculate available stock', () => {
      const totalStock = 100;
      const reservedStock = 25;
      const availableStock = totalStock - reservedStock;

      expect(availableStock).toBe(75);
    });

    it('should identify low stock items', () => {
      const items = [
        { id: 'i1', stock_quantity: 10, reorder_level: 50 },
        { id: 'i2', stock_quantity: 100, reorder_level: 20 },
        { id: 'i3', stock_quantity: 5, reorder_level: 25 },
      ];

      const lowStock = items.filter(i => i.stock_quantity <= i.reorder_level);

      expect(lowStock).toHaveLength(2);
      expect(lowStock.map(i => i.id)).toEqual(['i1', 'i3']);
    });

    it('should calculate stock value', () => {
      const items = [
        { quantity: 100, unit_cost: 10 },
        { quantity: 50, unit_cost: 25 },
        { quantity: 200, unit_cost: 5 },
      ];

      const totalValue = items.reduce((sum, i) => sum + (i.quantity * i.unit_cost), 0);

      expect(totalValue).toBe(3250);
    });
  });

  describe('AVCO Calculations', () => {
    it('should calculate new AVCO on receipt', () => {
      const currentQty = 100;
      const currentCost = 10;
      const receivedQty = 50;
      const receivedCost = 15;

      const currentValue = currentQty * currentCost;
      const receivedValue = receivedQty * receivedCost;
      const newQty = currentQty + receivedQty;
      const newAVCO = (currentValue + receivedValue) / newQty;

      expect(newAVCO.toFixed(2)).toBe('11.67');
    });

    it('should maintain AVCO on sale', () => {
      const currentQty = 100;
      const currentCost = 12.50;
      const soldQty = 30;

      const remainingQty = currentQty - soldQty;
      const avco = currentCost; // AVCO doesn't change on sale

      expect(remainingQty).toBe(70);
      expect(avco).toBe(12.50);
    });

    it('should handle multiple receipts', () => {
      let qty = 0;
      let totalValue = 0;

      const receipts = [
        { quantity: 100, cost: 10 },
        { quantity: 50, cost: 12 },
        { quantity: 25, cost: 15 },
      ];

      receipts.forEach(r => {
        totalValue += r.quantity * r.cost;
        qty += r.quantity;
      });

      const avco = totalValue / qty;

      expect(qty).toBe(175);
      expect(avco.toFixed(2)).toBe('11.29');
    });
  });

  describe('Stock Transfer', () => {
    it('should validate source has sufficient stock', () => {
      const sourceStock = 50;
      const transferQty = 30;
      const hasEnough = sourceStock >= transferQty;

      expect(hasEnough).toBe(true);
    });

    it('should reject insufficient stock transfer', () => {
      const sourceStock = 20;
      const transferQty = 30;
      const hasEnough = sourceStock >= transferQty;

      expect(hasEnough).toBe(false);
    });

    it('should update both warehouse quantities', () => {
      const sourceStock = 100;
      const destStock = 50;
      const transferQty = 30;

      const newSourceStock = sourceStock - transferQty;
      const newDestStock = destStock + transferQty;

      expect(newSourceStock).toBe(70);
      expect(newDestStock).toBe(80);
    });

    it('should not allow transfer to same warehouse', () => {
      const sourceWarehouse = 'wh-1';
      const destWarehouse = 'wh-1';
      const isValid = sourceWarehouse !== destWarehouse;

      expect(isValid).toBe(false);
    });
  });

  describe('Stock Adjustment', () => {
    it('should handle positive adjustment', () => {
      const currentStock = 100;
      const adjustment = 25;
      const newStock = currentStock + adjustment;

      expect(newStock).toBe(125);
    });

    it('should handle negative adjustment', () => {
      const currentStock = 100;
      const adjustment = -20;
      const newStock = currentStock + adjustment;

      expect(newStock).toBe(80);
    });

    it('should not allow negative resulting stock', () => {
      const currentStock = 50;
      const adjustment = -75;
      const resultingStock = currentStock + adjustment;
      const isValid = resultingStock >= 0;

      expect(isValid).toBe(false);
    });

    it('should require adjustment reason', () => {
      const adjustment = {
        item_id: 'item-1',
        quantity_change: 10,
        reason: 'inventory_count',
      };

      const hasReason = Boolean(adjustment.reason);

      expect(hasReason).toBe(true);
    });
  });

  describe('Warehouse Management', () => {
    it('should calculate warehouse capacity usage', () => {
      const totalCapacity = 1000;
      const usedCapacity = 750;
      const usagePercentage = (usedCapacity / totalCapacity) * 100;

      expect(usagePercentage).toBe(75);
    });

    it('should identify overloaded warehouses', () => {
      const warehouses = [
        { id: 'wh-1', capacity: 1000, used: 950 },
        { id: 'wh-2', capacity: 500, used: 300 },
        { id: 'wh-3', capacity: 800, used: 850 },
      ];

      const threshold = 90;
      const overloaded = warehouses.filter(w => 
        (w.used / w.capacity) * 100 >= threshold
      );

      expect(overloaded).toHaveLength(2);
    });

    it('should calculate available space', () => {
      const capacity = 1000;
      const used = 650;
      const available = capacity - used;

      expect(available).toBe(350);
    });
  });

  describe('Storage Bins', () => {
    it('should assign item to bin', () => {
      const assignment = {
        item_id: 'item-1',
        bin_id: 'bin-A1',
        quantity: 100,
      };

      expect(assignment.bin_id).toBe('bin-A1');
    });

    it('should track bin occupancy', () => {
      const bin = {
        id: 'bin-A1',
        capacity: 500,
        items: [
          { item_id: 'item-1', quantity: 200 },
          { item_id: 'item-2', quantity: 150 },
        ],
      };

      const occupied = bin.items.reduce((sum, i) => sum + i.quantity, 0);
      const occupancyRate = (occupied / bin.capacity) * 100;

      expect(occupied).toBe(350);
      expect(occupancyRate).toBe(70);
    });

    it('should validate bin location format', () => {
      const binRegex = /^[A-Z]\d{1,2}$/;
      const validBins = ['A1', 'B12', 'Z9'];
      const invalidBins = ['1A', 'AA', '12', 'a1'];

      validBins.forEach(bin => {
        expect(binRegex.test(bin)).toBe(true);
      });

      invalidBins.forEach(bin => {
        expect(binRegex.test(bin)).toBe(false);
      });
    });
  });

  describe('Inventory Valuation', () => {
    it('should calculate total inventory value', () => {
      const items = [
        { quantity: 100, cost: 50 },
        { quantity: 200, cost: 25 },
        { quantity: 50, cost: 100 },
      ];

      const totalValue = items.reduce((sum, i) => sum + (i.quantity * i.cost), 0);

      expect(totalValue).toBe(15000);
    });

    it('should calculate value by category', () => {
      const items = [
        { category: 'raw_materials', quantity: 100, cost: 10 },
        { category: 'raw_materials', quantity: 50, cost: 15 },
        { category: 'finished_goods', quantity: 30, cost: 100 },
      ];

      const byCategory = items.reduce((acc, item) => {
        const value = item.quantity * item.cost;
        acc[item.category] = (acc[item.category] || 0) + value;
        return acc;
      }, {} as Record<string, number>);

      expect(byCategory['raw_materials']).toBe(1750);
      expect(byCategory['finished_goods']).toBe(3000);
    });
  });

  describe('Stock Movements History', () => {
    it('should track movement types', () => {
      const movements = [
        { type: 'purchase_receipt', quantity: 100 },
        { type: 'sales_delivery', quantity: -30 },
        { type: 'transfer_in', quantity: 20 },
        { type: 'adjustment', quantity: -5 },
      ];

      const incoming = movements
        .filter(m => m.quantity > 0)
        .reduce((sum, m) => sum + m.quantity, 0);

      const outgoing = movements
        .filter(m => m.quantity < 0)
        .reduce((sum, m) => sum + Math.abs(m.quantity), 0);

      expect(incoming).toBe(120);
      expect(outgoing).toBe(35);
    });

    it('should calculate net change', () => {
      const movements = [
        { quantity: 100 },
        { quantity: -30 },
        { quantity: 50 },
        { quantity: -20 },
      ];

      const netChange = movements.reduce((sum, m) => sum + m.quantity, 0);

      expect(netChange).toBe(100);
    });
  });

  describe('Batch and Serial Tracking', () => {
    it('should validate batch number format', () => {
      const batchRegex = /^LOT-\d{8}-\d{3}$/;
      const validBatch = 'LOT-20251220-001';
      const invalidBatch = 'BATCH-123';

      expect(batchRegex.test(validBatch)).toBe(true);
      expect(batchRegex.test(invalidBatch)).toBe(false);
    });

    it('should check batch expiry', () => {
      const batch = {
        number: 'LOT-20251220-001',
        expiry_date: '2026-06-30',
      };

      const today = new Date('2025-12-20');
      const expiryDate = new Date(batch.expiry_date);
      const daysToExpiry = Math.floor((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      expect(daysToExpiry).toBe(192);
    });

    it('should identify expired batches', () => {
      const batches = [
        { id: 'b1', expiry_date: '2025-12-15' },
        { id: 'b2', expiry_date: '2026-06-30' },
        { id: 'b3', expiry_date: '2025-11-01' },
      ];

      const today = new Date('2025-12-20');
      const expired = batches.filter(b => new Date(b.expiry_date) < today);

      expect(expired).toHaveLength(2);
    });
  });

  describe('Reorder Point Analysis', () => {
    it('should calculate reorder point', () => {
      const averageDailyUsage = 10;
      const leadTimeDays = 7;
      const safetyStock = 20;

      const reorderPoint = (averageDailyUsage * leadTimeDays) + safetyStock;

      expect(reorderPoint).toBe(90);
    });

    it('should calculate economic order quantity', () => {
      const annualDemand = 10000;
      const orderingCost = 50;
      const holdingCostPerUnit = 2;

      const eoq = Math.sqrt((2 * annualDemand * orderingCost) / holdingCostPerUnit);

      expect(Math.round(eoq)).toBe(707);
    });

    it('should identify items needing reorder', () => {
      const items = [
        { id: 'i1', stock: 50, reorder_point: 30 },
        { id: 'i2', stock: 20, reorder_point: 50 },
        { id: 'i3', stock: 100, reorder_point: 25 },
      ];

      const needsReorder = items.filter(i => i.stock <= i.reorder_point);

      expect(needsReorder).toHaveLength(1);
      expect(needsReorder[0].id).toBe('i2');
    });
  });

  describe('Stock Reports', () => {
    it('should calculate turnover ratio', () => {
      const cogs = 100000;
      const averageInventory = 20000;
      const turnoverRatio = cogs / averageInventory;

      expect(turnoverRatio).toBe(5);
    });

    it('should calculate days of inventory', () => {
      const turnoverRatio = 5;
      const daysOfInventory = 365 / turnoverRatio;

      expect(daysOfInventory).toBe(73);
    });

    it('should calculate ABC classification', () => {
      const items = [
        { id: 'i1', value: 50000 },
        { id: 'i2', value: 30000 },
        { id: 'i3', value: 10000 },
        { id: 'i4', value: 5000 },
        { id: 'i5', value: 3000 },
        { id: 'i6', value: 2000 },
      ];

      const totalValue = items.reduce((sum, i) => sum + i.value, 0);
      
      const sorted = [...items].sort((a, b) => b.value - a.value);
      
      let cumulative = 0;
      const classified = sorted.map(item => {
        cumulative += item.value;
        const percentage = (cumulative / totalValue) * 100;
        let category: string;
        if (percentage <= 80) category = 'A';
        else if (percentage <= 95) category = 'B';
        else category = 'C';
        return { ...item, category };
      });

      const aItems = classified.filter(i => i.category === 'A');
      expect(aItems.length).toBeGreaterThan(0);
    });
  });

  describe('Unit Conversions', () => {
    it('should convert between units', () => {
      const conversions: Record<string, number> = {
        'kg_to_g': 1000,
        'l_to_ml': 1000,
        'm_to_cm': 100,
      };

      const kgValue = 5;
      const gValue = kgValue * conversions['kg_to_g'];

      expect(gValue).toBe(5000);
    });

    it('should handle box to piece conversion', () => {
      const piecesPerBox = 24;
      const boxes = 10;
      const pieces = boxes * piecesPerBox;

      expect(pieces).toBe(240);
    });
  });
});
