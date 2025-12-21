/**
 * @fileoverview Comprehensive Tests for Stock Ledger Service
 * Tests stock balance, warehouse operations, and stock ledger entries
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Types from stock-ledger-service
interface StockLedgerEntry {
  id?: string;
  voucher_type: string;
  voucher_id: string;
  voucher_number?: string;
  product_id: string;
  warehouse_id: string;
  posting_date: string;
  posting_time?: string;
  actual_qty: number;
  qty_after_transaction?: number;
  incoming_rate?: number;
  outgoing_rate?: number;
  valuation_rate?: number;
  stock_value?: number;
  stock_value_difference?: number;
  batch_no?: string;
  serial_nos?: string[];
  is_cancelled?: boolean;
  docstatus?: number;
}

interface Bin {
  product_id: string;
  warehouse_id: string;
  actual_qty: number;
  reserved_qty: number;
  ordered_qty: number;
  planned_qty: number;
  projected_qty: number;
  valuation_rate: number;
  stock_value: number;
}

interface StockBalance {
  quantity: number;
  valuation_rate: number;
  stock_value: number;
}

interface Warehouse {
  id: string;
  code: string;
  name: string;
  warehouse_type: string;
  is_group: boolean;
  is_active: boolean;
}

describe('Stock Ledger Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Stock Ledger Entry', () => {
    it('should create entry with positive qty for incoming', () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Goods Receipt',
        voucher_id: 'gr-1',
        voucher_number: 'GR-001',
        product_id: 'prod-1',
        warehouse_id: 'wh-1',
        posting_date: '2025-12-20',
        actual_qty: 100, // Positive for incoming
        incoming_rate: 50,
        valuation_rate: 50,
        docstatus: 1,
      };

      expect(entry.actual_qty).toBeGreaterThan(0);
      expect(entry.incoming_rate).toBeDefined();
    });

    it('should create entry with negative qty for outgoing', () => {
      const entry: StockLedgerEntry = {
        voucher_type: 'Delivery Note',
        voucher_id: 'dn-1',
        voucher_number: 'DN-001',
        product_id: 'prod-1',
        warehouse_id: 'wh-1',
        posting_date: '2025-12-20',
        actual_qty: -50, // Negative for outgoing
        outgoing_rate: 50,
        valuation_rate: 50,
        docstatus: 1,
      };

      expect(entry.actual_qty).toBeLessThan(0);
      expect(entry.outgoing_rate).toBeDefined();
    });

    it('should calculate qty after transaction', () => {
      const openingQty = 100;
      const entries = [
        { actual_qty: 50 },  // +50 = 150
        { actual_qty: -30 }, // -30 = 120
        { actual_qty: 100 }, // +100 = 220
      ];

      let runningQty = openingQty;
      const withBalance = entries.map(e => {
        runningQty += e.actual_qty;
        return { ...e, qty_after_transaction: runningQty };
      });

      expect(withBalance[0].qty_after_transaction).toBe(150);
      expect(withBalance[1].qty_after_transaction).toBe(120);
      expect(withBalance[2].qty_after_transaction).toBe(220);
    });
  });

  describe('Stock Balance Calculations', () => {
    it('should calculate stock balance from entries', () => {
      const entries: Partial<StockLedgerEntry>[] = [
        { actual_qty: 100, valuation_rate: 50 },
        { actual_qty: 50, valuation_rate: 60 },
        { actual_qty: -30, valuation_rate: 55 },
      ];

      const quantity = entries.reduce((sum, e) => sum + (e.actual_qty || 0), 0);
      expect(quantity).toBe(120);
    });

    it('should calculate AVCO valuation rate', () => {
      // Opening: 100 units @ 50 = 5000
      // Receipt: 50 units @ 60 = 3000
      // Total: 150 units, value = 8000
      // AVCO = 8000 / 150 = 53.33

      const openingQty = 100;
      const openingRate = 50;
      const openingValue = openingQty * openingRate;

      const receiptQty = 50;
      const receiptRate = 60;
      const receiptValue = receiptQty * receiptRate;

      const totalQty = openingQty + receiptQty;
      const totalValue = openingValue + receiptValue;
      const avcoRate = totalValue / totalQty;

      expect(avcoRate).toBeCloseTo(53.33, 2);
    });

    it('should calculate stock value', () => {
      const balance: StockBalance = {
        quantity: 150,
        valuation_rate: 53.33,
        stock_value: 8000,
      };

      const calculatedValue = balance.quantity * balance.valuation_rate;
      expect(calculatedValue).toBeCloseTo(balance.stock_value, -1);
    });
  });

  describe('Warehouse Operations', () => {
    it('should identify active warehouse', () => {
      const warehouse: Warehouse = {
        id: 'wh-1',
        code: 'MAIN',
        name: 'Main Warehouse',
        warehouse_type: 'Storage',
        is_group: false,
        is_active: true,
      };

      expect(warehouse.is_active).toBe(true);
    });

    it('should identify warehouse group', () => {
      const warehouse: Warehouse = {
        id: 'wh-all',
        code: 'ALL',
        name: 'All Warehouses',
        warehouse_type: 'Virtual',
        is_group: true,
        is_active: true,
      };

      expect(warehouse.is_group).toBe(true);
    });

    it('should filter inactive warehouses', () => {
      const warehouses: Warehouse[] = [
        { id: '1', code: 'WH1', name: 'Active', warehouse_type: 'Storage', is_group: false, is_active: true },
        { id: '2', code: 'WH2', name: 'Inactive', warehouse_type: 'Storage', is_group: false, is_active: false },
        { id: '3', code: 'WH3', name: 'Active 2', warehouse_type: 'Storage', is_group: false, is_active: true },
      ];

      const active = warehouses.filter(w => w.is_active);
      expect(active.length).toBe(2);
    });
  });

  describe('Bin (Stock by Location)', () => {
    it('should calculate projected quantity', () => {
      const bin: Bin = {
        product_id: 'prod-1',
        warehouse_id: 'wh-1',
        actual_qty: 100,
        reserved_qty: 20,
        ordered_qty: 50,
        planned_qty: 30,
        projected_qty: 160, // actual + ordered + planned - reserved
        valuation_rate: 50,
        stock_value: 5000,
      };

      const calculated = bin.actual_qty + bin.ordered_qty + bin.planned_qty - bin.reserved_qty;
      expect(calculated).toBe(160);
    });

    it('should calculate available quantity', () => {
      const actual_qty = 100;
      const reserved_qty = 20;
      const available = actual_qty - reserved_qty;
      expect(available).toBe(80);
    });

    it('should calculate stock value correctly', () => {
      const bin: Bin = {
        product_id: 'prod-1',
        warehouse_id: 'wh-1',
        actual_qty: 100,
        reserved_qty: 0,
        ordered_qty: 0,
        planned_qty: 0,
        projected_qty: 100,
        valuation_rate: 50,
        stock_value: 5000,
      };

      const calculatedValue = bin.actual_qty * bin.valuation_rate;
      expect(calculatedValue).toBe(bin.stock_value);
    });
  });

  describe('Document Status', () => {
    it('should identify draft entry', () => {
      const entry: Partial<StockLedgerEntry> = {
        docstatus: 0,
      };
      const isDraft = entry.docstatus === 0;
      expect(isDraft).toBe(true);
    });

    it('should identify submitted entry', () => {
      const entry: Partial<StockLedgerEntry> = {
        docstatus: 1,
      };
      const isSubmitted = entry.docstatus === 1;
      expect(isSubmitted).toBe(true);
    });

    it('should identify cancelled entry', () => {
      const entry: Partial<StockLedgerEntry> = {
        docstatus: 2,
        is_cancelled: true,
      };
      const isCancelled = entry.docstatus === 2 || entry.is_cancelled;
      expect(isCancelled).toBe(true);
    });
  });

  describe('Voucher Types', () => {
    const voucherTypes = [
      'Goods Receipt',
      'Delivery Note',
      'Stock Entry',
      'Stock Adjustment',
      'Manufacturing Entry',
      'Purchase Invoice',
      'Sales Invoice',
    ];

    it('should support goods receipt', () => {
      expect(voucherTypes).toContain('Goods Receipt');
    });

    it('should support delivery note', () => {
      expect(voucherTypes).toContain('Delivery Note');
    });

    it('should support stock entry', () => {
      expect(voucherTypes).toContain('Stock Entry');
    });

    it('should support stock adjustment', () => {
      expect(voucherTypes).toContain('Stock Adjustment');
    });
  });

  describe('Batch and Serial Tracking', () => {
    it('should track batch number', () => {
      const entry: Partial<StockLedgerEntry> = {
        product_id: 'prod-1',
        actual_qty: 100,
        batch_no: 'BATCH-2025-001',
      };

      expect(entry.batch_no).toBeDefined();
    });

    it('should track serial numbers', () => {
      const entry: Partial<StockLedgerEntry> = {
        product_id: 'prod-1',
        actual_qty: 3,
        serial_nos: ['SN001', 'SN002', 'SN003'],
      };

      expect(entry.serial_nos).toHaveLength(3);
      expect(entry.serial_nos?.length).toBe(entry.actual_qty);
    });
  });

  describe('Stock Value Difference', () => {
    it('should calculate value difference for incoming', () => {
      const entry: Partial<StockLedgerEntry> = {
        actual_qty: 100,
        valuation_rate: 50,
        stock_value_difference: 5000,
      };

      const calculated = entry.actual_qty! * entry.valuation_rate!;
      expect(calculated).toBe(entry.stock_value_difference);
    });

    it('should calculate negative value difference for outgoing', () => {
      const entry: Partial<StockLedgerEntry> = {
        actual_qty: -50,
        valuation_rate: 50,
        stock_value_difference: -2500,
      };

      const calculated = entry.actual_qty! * entry.valuation_rate!;
      expect(calculated).toBe(entry.stock_value_difference);
    });
  });

  describe('Stock at Date', () => {
    it('should filter entries up to date', () => {
      const entries = [
        { posting_date: '2025-12-15', actual_qty: 100 },
        { posting_date: '2025-12-18', actual_qty: -30 },
        { posting_date: '2025-12-20', actual_qty: 50 },
        { posting_date: '2025-12-25', actual_qty: -20 },
      ];

      const asOfDate = '2025-12-20';
      const filtered = entries.filter(e => e.posting_date <= asOfDate);
      const balance = filtered.reduce((sum, e) => sum + e.actual_qty, 0);

      expect(filtered.length).toBe(3);
      expect(balance).toBe(120);
    });
  });

  describe('Running Balance', () => {
    it('should maintain running balance chronologically', () => {
      const entries = [
        { posting_date: '2025-12-01', actual_qty: 100 },
        { posting_date: '2025-12-10', actual_qty: 50 },
        { posting_date: '2025-12-15', actual_qty: -30 },
        { posting_date: '2025-12-20', actual_qty: -20 },
      ];

      let runningBalance = 0;
      const withBalance = entries.map(e => {
        runningBalance += e.actual_qty;
        return { ...e, balance: runningBalance };
      });

      expect(withBalance[0].balance).toBe(100);
      expect(withBalance[1].balance).toBe(150);
      expect(withBalance[2].balance).toBe(120);
      expect(withBalance[3].balance).toBe(100);
    });
  });
});
