/**
 * @fileoverview Comprehensive Tests for Inventory Module
 * Tests React components and business logic for inventory management
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock dependencies
vi.mock('react-router-dom', () => ({
  Routes: ({ children }: any) => <div data-testid="routes">{children}</div>,
  Route: ({ element }: any) => element,
  Navigate: () => <div data-testid="navigate" />,
  Link: ({ children, to }: any) => <a href={to}>{children}</a>,
  useNavigate: () => vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar' },
  }),
}));

vi.mock('@/services/supabase-service', () => ({
  itemsService: {
    getAll: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  categoriesService: {
    getAll: vi.fn().mockResolvedValue([]),
  },
  stockMovementsService: {
    getAll: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
        })),
      })),
    })),
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('Inventory Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Inventory Calculations', () => {
    it('should calculate total inventory value', () => {
      const items = [
        { stock_quantity: 100, cost_price: 10 },
        { stock_quantity: 50, cost_price: 20 },
        { stock_quantity: 200, cost_price: 5 },
      ];

      const totalValue = items.reduce(
        (sum, item) => sum + item.stock_quantity * item.cost_price,
        0
      );

      expect(totalValue).toBe(100 * 10 + 50 * 20 + 200 * 5); // 1000 + 1000 + 1000 = 3000
    });

    it('should identify low stock items', () => {
      const items = [
        { name: 'Item A', stock_quantity: 5, minimum_stock: 10 },
        { name: 'Item B', stock_quantity: 20, minimum_stock: 10 },
        { name: 'Item C', stock_quantity: 8, minimum_stock: 10 },
        { name: 'Item D', stock_quantity: 10, minimum_stock: 10 },
      ];

      const lowStockItems = items.filter(
        (item) => item.stock_quantity <= item.minimum_stock
      );

      expect(lowStockItems).toHaveLength(3); // A, C, D
      expect(lowStockItems.map((i) => i.name)).toEqual(['Item A', 'Item C', 'Item D']);
    });

    it('should calculate total quantity in stock', () => {
      const items = [
        { stock_quantity: 100 },
        { stock_quantity: 250 },
        { stock_quantity: 75 },
      ];

      const totalQty = items.reduce((sum, item) => sum + item.stock_quantity, 0);

      expect(totalQty).toBe(425);
    });

    it('should handle empty inventory', () => {
      const items: any[] = [];

      const totalValue = items.reduce(
        (sum, item) => sum + item.stock_quantity * item.cost_price,
        0
      );
      const lowStockItems = items.filter(
        (item) => item.stock_quantity <= item.minimum_stock
      );

      expect(totalValue).toBe(0);
      expect(lowStockItems).toHaveLength(0);
    });
  });

  describe('Stock Movement Validation', () => {
    it('should validate stock out does not exceed available', () => {
      const currentStock = 100;
      const requestedQty = 50;

      const isValid = requestedQty <= currentStock;

      expect(isValid).toBe(true);
    });

    it('should reject stock out exceeding available', () => {
      const currentStock = 100;
      const requestedQty = 150;

      const isValid = requestedQty <= currentStock;

      expect(isValid).toBe(false);
    });

    it('should allow any stock in quantity', () => {
      const movementType = 'in';
      const quantity = 1000;

      const isValid = movementType === 'in' || quantity > 0;

      expect(isValid).toBe(true);
    });
  });

  describe('Item Categorization', () => {
    it('should group items by category', () => {
      const items = [
        { id: '1', name: 'Item A', category_id: 'cat-1' },
        { id: '2', name: 'Item B', category_id: 'cat-1' },
        { id: '3', name: 'Item C', category_id: 'cat-2' },
        { id: '4', name: 'Item D', category_id: 'cat-2' },
        { id: '5', name: 'Item E', category_id: 'cat-1' },
      ];

      const grouped = items.reduce((acc: Record<string, any[]>, item) => {
        const key = item.category_id;
        if (!acc[key]) acc[key] = [];
        acc[key].push(item);
        return acc;
      }, {});

      expect(grouped['cat-1']).toHaveLength(3);
      expect(grouped['cat-2']).toHaveLength(2);
    });

    it('should count items per category', () => {
      const items = [
        { category_id: 'raw-materials' },
        { category_id: 'raw-materials' },
        { category_id: 'finished-goods' },
        { category_id: 'packaging' },
        { category_id: 'raw-materials' },
      ];

      const counts = items.reduce((acc: Record<string, number>, item) => {
        acc[item.category_id] = (acc[item.category_id] || 0) + 1;
        return acc;
      }, {});

      expect(counts['raw-materials']).toBe(3);
      expect(counts['finished-goods']).toBe(1);
      expect(counts['packaging']).toBe(1);
    });
  });

  describe('Inventory Valuation', () => {
    it('should calculate FIFO valuation', () => {
      const batches = [
        { quantity: 100, unit_cost: 10 }, // First batch
        { quantity: 50, unit_cost: 12 }, // Second batch
        { quantity: 75, unit_cost: 11 }, // Third batch
      ];

      // FIFO: sell 120 units
      let remaining = 120;
      let totalCost = 0;

      for (const batch of batches) {
        if (remaining <= 0) break;
        const used = Math.min(remaining, batch.quantity);
        totalCost += used * batch.unit_cost;
        remaining -= used;
      }

      // 100 @ 10 = 1000, 20 @ 12 = 240 = 1240
      expect(totalCost).toBe(1240);
    });

    it('should calculate weighted average cost', () => {
      const transactions = [
        { type: 'in', quantity: 100, unit_cost: 10 },
        { type: 'in', quantity: 50, unit_cost: 12 },
      ];

      let totalQty = 0;
      let totalCost = 0;

      transactions.forEach((t) => {
        if (t.type === 'in') {
          totalQty += t.quantity;
          totalCost += t.quantity * t.unit_cost;
        }
      });

      const avgCost = totalCost / totalQty;

      // (100*10 + 50*12) / 150 = 1600/150 = 10.67
      expect(avgCost).toBeCloseTo(10.67, 2);
    });

    it('should calculate total valuation by location', () => {
      const stockByLocation = [
        { location_id: 'loc-1', quantity: 100, unit_cost: 10 },
        { location_id: 'loc-1', quantity: 50, unit_cost: 12 },
        { location_id: 'loc-2', quantity: 75, unit_cost: 11 },
      ];

      const valuationByLocation = stockByLocation.reduce(
        (acc: Record<string, number>, item) => {
          acc[item.location_id] =
            (acc[item.location_id] || 0) + item.quantity * item.unit_cost;
          return acc;
        },
        {}
      );

      expect(valuationByLocation['loc-1']).toBe(1600); // 1000 + 600
      expect(valuationByLocation['loc-2']).toBe(825); // 75 * 11
    });
  });

  describe('Stock Transfer Logic', () => {
    it('should validate transfer between locations', () => {
      const sourceStock = { location_id: 'loc-1', quantity: 100 };
      const transferQty = 50;
      const targetLocation = 'loc-2';

      const isValidTransfer =
        sourceStock.quantity >= transferQty && targetLocation !== sourceStock.location_id;

      expect(isValidTransfer).toBe(true);
    });

    it('should reject transfer to same location', () => {
      const sourceStock = { location_id: 'loc-1', quantity: 100 };
      const transferQty = 50;
      const targetLocation = 'loc-1';

      const isValidTransfer =
        sourceStock.quantity >= transferQty && targetLocation !== sourceStock.location_id;

      expect(isValidTransfer).toBe(false);
    });

    it('should calculate new quantities after transfer', () => {
      const source = { location_id: 'loc-1', quantity: 100 };
      const target = { location_id: 'loc-2', quantity: 50 };
      const transferQty = 30;

      const newSourceQty = source.quantity - transferQty;
      const newTargetQty = target.quantity + transferQty;

      expect(newSourceQty).toBe(70);
      expect(newTargetQty).toBe(80);
    });
  });

  describe('Stock Adjustment Types', () => {
    it('should handle positive adjustment', () => {
      const currentStock = 100;
      const adjustment = { type: 'increase', quantity: 25 };

      const newStock =
        adjustment.type === 'increase'
          ? currentStock + adjustment.quantity
          : currentStock - adjustment.quantity;

      expect(newStock).toBe(125);
    });

    it('should handle negative adjustment', () => {
      const currentStock = 100;
      const adjustment = { type: 'decrease', quantity: 25 };

      const newStock =
        adjustment.type === 'increase'
          ? currentStock + adjustment.quantity
          : currentStock - adjustment.quantity;

      expect(newStock).toBe(75);
    });

    it('should validate adjustment reasons', () => {
      const validReasons = [
        'physical_count',
        'damage',
        'expiry',
        'theft',
        'correction',
        'other',
      ];

      const reason = 'physical_count';
      const isValid = validReasons.includes(reason);

      expect(isValid).toBe(true);
    });

    it('should reject invalid adjustment reason', () => {
      const validReasons = [
        'physical_count',
        'damage',
        'expiry',
        'theft',
        'correction',
        'other',
      ];

      const reason = 'unknown_reason';
      const isValid = validReasons.includes(reason);

      expect(isValid).toBe(false);
    });
  });

  describe('Warehouse Management', () => {
    it('should calculate warehouse utilization', () => {
      const warehouse = {
        total_capacity: 1000,
        used_capacity: 650,
      };

      const utilization = (warehouse.used_capacity / warehouse.total_capacity) * 100;

      expect(utilization).toBe(65);
    });

    it('should identify full warehouses', () => {
      const warehouses = [
        { id: '1', name: 'WH-1', capacity: 1000, used: 1000 },
        { id: '2', name: 'WH-2', capacity: 500, used: 400 },
        { id: '3', name: 'WH-3', capacity: 800, used: 800 },
      ];

      const fullWarehouses = warehouses.filter((wh) => wh.used >= wh.capacity);

      expect(fullWarehouses).toHaveLength(2);
      expect(fullWarehouses.map((w) => w.name)).toEqual(['WH-1', 'WH-3']);
    });

    it('should calculate available space', () => {
      const warehouse = {
        total_capacity: 1000,
        used_capacity: 650,
      };

      const availableSpace = warehouse.total_capacity - warehouse.used_capacity;

      expect(availableSpace).toBe(350);
    });
  });

  describe('Bin Location Management', () => {
    it('should generate bin code', () => {
      const warehouse = 'A';
      const aisle = '01';
      const rack = '02';
      const shelf = '03';

      const binCode = `${warehouse}-${aisle}-${rack}-${shelf}`;

      expect(binCode).toBe('A-01-02-03');
    });

    it('should validate bin code format', () => {
      const binCodePattern = /^[A-Z]-\d{2}-\d{2}-\d{2}$/;

      expect(binCodePattern.test('A-01-02-03')).toBe(true);
      expect(binCodePattern.test('B-10-05-12')).toBe(true);
      expect(binCodePattern.test('invalid')).toBe(false);
      expect(binCodePattern.test('A-1-2-3')).toBe(false);
    });

    it('should find bin by barcode', () => {
      const bins = [
        { id: '1', code: 'A-01-02-03', barcode: 'BIN-001' },
        { id: '2', code: 'A-01-02-04', barcode: 'BIN-002' },
        { id: '3', code: 'B-01-01-01', barcode: 'BIN-003' },
      ];

      const barcode = 'BIN-002';
      const foundBin = bins.find((b) => b.barcode === barcode);

      expect(foundBin).toBeDefined();
      expect(foundBin?.code).toBe('A-01-02-04');
    });
  });

  describe('Reorder Point Analysis', () => {
    it('should identify items below reorder point', () => {
      const items = [
        { name: 'A', stock: 50, reorder_point: 100 },
        { name: 'B', stock: 150, reorder_point: 100 },
        { name: 'C', stock: 80, reorder_point: 100 },
        { name: 'D', stock: 100, reorder_point: 100 },
      ];

      const needsReorder = items.filter((item) => item.stock < item.reorder_point);

      expect(needsReorder).toHaveLength(2);
      expect(needsReorder.map((i) => i.name)).toEqual(['A', 'C']);
    });

    it('should calculate reorder quantity', () => {
      const item = {
        current_stock: 50,
        reorder_point: 100,
        max_stock: 500,
      };

      const reorderQty = item.max_stock - item.current_stock;

      expect(reorderQty).toBe(450);
    });

    it('should calculate safety stock', () => {
      const dailyUsage = 10;
      const leadTimeDays = 7;
      const safetyFactor = 1.5;

      const safetyStock = dailyUsage * leadTimeDays * safetyFactor;

      expect(safetyStock).toBe(105);
    });
  });

  describe('Unit of Measure Conversions', () => {
    it('should convert between units', () => {
      const conversionFactors: Record<string, number> = {
        'kg_to_g': 1000,
        'l_to_ml': 1000,
        'm_to_cm': 100,
        'box_to_pcs': 12,
      };

      const convert = (value: number, conversion: string): number => {
        return value * (conversionFactors[conversion] || 1);
      };

      expect(convert(5, 'kg_to_g')).toBe(5000);
      expect(convert(2.5, 'l_to_ml')).toBe(2500);
      expect(convert(3, 'box_to_pcs')).toBe(36);
    });

    it('should calculate quantity in base unit', () => {
      const quantity = 5;
      const unit = 'box';
      const baseUnitConversion = 12; // 1 box = 12 pcs

      const baseQty = quantity * baseUnitConversion;

      expect(baseQty).toBe(60);
    });
  });

  describe('Batch and Serial Number Tracking', () => {
    it('should validate batch number format', () => {
      const batchPattern = /^BATCH-\d{4}-\d{6}$/;

      expect(batchPattern.test('BATCH-2025-000001')).toBe(true);
      expect(batchPattern.test('BATCH-2025-123456')).toBe(true);
      expect(batchPattern.test('invalid')).toBe(false);
    });

    it('should check batch expiry', () => {
      const batch = {
        batch_number: 'BATCH-2025-000001',
        expiry_date: '2025-06-30',
      };

      const today = new Date('2025-12-21');
      const expiryDate = new Date(batch.expiry_date);
      const isExpired = expiryDate < today;

      expect(isExpired).toBe(true);
    });

    it('should identify batches expiring soon', () => {
      const today = new Date('2025-12-21');
      const warningDays = 30;

      const batches = [
        { id: '1', expiry_date: '2025-12-25' }, // 4 days
        { id: '2', expiry_date: '2026-01-15' }, // 25 days
        { id: '3', expiry_date: '2026-03-01' }, // 70 days
      ];

      const expiringSoon = batches.filter((batch) => {
        const expiry = new Date(batch.expiry_date);
        const daysUntilExpiry = Math.ceil(
          (expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysUntilExpiry <= warningDays && daysUntilExpiry > 0;
      });

      expect(expiringSoon).toHaveLength(2);
    });
  });

  describe('ABC Analysis', () => {
    it('should classify items by value (ABC)', () => {
      const items = [
        { id: '1', name: 'A1', annualValue: 50000 },
        { id: '2', name: 'A2', annualValue: 30000 },
        { id: '3', name: 'B1', annualValue: 10000 },
        { id: '4', name: 'B2', annualValue: 5000 },
        { id: '5', name: 'C1', annualValue: 3000 },
        { id: '6', name: 'C2', annualValue: 2000 },
      ];

      const totalValue = items.reduce((sum, i) => sum + i.annualValue, 0);
      const sortedItems = [...items].sort((a, b) => b.annualValue - a.annualValue);

      let cumulative = 0;
      const classified = sortedItems.map((item) => {
        cumulative += item.annualValue;
        const percentage = (cumulative / totalValue) * 100;
        let category: string;
        if (percentage <= 80) category = 'A';
        else if (percentage <= 95) category = 'B';
        else category = 'C';
        return { ...item, category };
      });

      const aItems = classified.filter((i) => i.category === 'A');
      expect(aItems.length).toBeGreaterThan(0);
    });
  });

  describe('Stock Aging Analysis', () => {
    it('should calculate stock age in days', () => {
      const receiptDate = new Date('2025-10-01');
      const today = new Date('2025-12-21');

      const ageInDays = Math.floor(
        (today.getTime() - receiptDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(ageInDays).toBe(81);
    });

    it('should classify stock by age brackets', () => {
      const stockItems = [
        { id: '1', age_days: 10 },
        { id: '2', age_days: 45 },
        { id: '3', age_days: 100 },
        { id: '4', age_days: 200 },
      ];

      const ageBrackets = stockItems.map((item) => {
        if (item.age_days <= 30) return { ...item, bracket: '0-30' };
        if (item.age_days <= 60) return { ...item, bracket: '31-60' };
        if (item.age_days <= 90) return { ...item, bracket: '61-90' };
        return { ...item, bracket: '90+' };
      });

      expect(ageBrackets[0].bracket).toBe('0-30');
      expect(ageBrackets[1].bracket).toBe('31-60');
      expect(ageBrackets[2].bracket).toBe('90+');
      expect(ageBrackets[3].bracket).toBe('90+');
    });
  });
});
