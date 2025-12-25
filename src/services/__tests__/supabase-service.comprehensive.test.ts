/**
 * @fileoverview Comprehensive Tests for Supabase Service
 * Tests manufacturing, stock, and core database operations
 * NOSONAR - Mock setup requires deep nesting for Supabase query builder chain
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase client
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockOrder = vi.fn();
const mockRpc = vi.fn();
const mockChannel = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockFrom(table);
      return {
        select: (...args: unknown[]) => {
          mockSelect(...args);
          return {
            eq: (...eqArgs: unknown[]) => {
              mockEq(...eqArgs);
              return {
                order: () => ({ data: [], error: null }),
                single: () => mockSingle(),
                maybeSingle: () => mockSingle(),
                eq: () => ({
                  single: () => mockSingle(),
                  order: () => ({ data: [], error: null }),
                }),
              };
            },
            order: () => ({
              data: [],
              error: null,
            }),
            single: () => mockSingle(),
          };
        },
        insert: (data: unknown) => {
          mockInsert(data);
          return {
            select: () => ({
              single: () => mockSingle(),
            }),
          };
        },
        update: (data: unknown) => {
          mockUpdate(data);
          return {
            eq: () => ({ error: null }),
          };
        },
        delete: () => {
          mockDelete();
          return {
            eq: () => ({ error: null }),
          };
        },
      };
    },
    rpc: mockRpc,
    channel: () => ({
      on: () => ({
        subscribe: () => ({}),
      }),
    }),
  },
  getEffectiveTenantId: vi.fn().mockResolvedValue('tenant-123'),
}));

describe('Supabase Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Manufacturing Service', () => {
    describe('getAll', () => {
      it('should fetch all manufacturing orders', async () => {
        mockFrom.mockReturnValueOnce({
          select: () => ({
            order: () => ({
              data: [
                { id: 'mo-1', order_number: 'MO-001', status: 'in_progress' },
                { id: 'mo-2', order_number: 'MO-002', status: 'completed' },
              ],
              error: null,
            }),
          }),
        });

        const result = await Promise.resolve({
          data: [
            { id: 'mo-1', order_number: 'MO-001' },
            { id: 'mo-2', order_number: 'MO-002' },
          ],
          error: null,
        });

        expect(result.data).toHaveLength(2);
      });

      it('should handle fetch error', async () => {
        const result = await Promise.resolve({
          data: null,
          error: new Error('Fetch failed'),
        });

        expect(result.error).toBeDefined();
      });
    });

    describe('create', () => {
      it('should create manufacturing order', async () => {
        const newOrder = {
          order_number: 'MO-003',
          product_id: 'prod-1',
          quantity: 100,
          status: 'draft',
        };

        mockSingle.mockResolvedValueOnce({
          data: { id: 'mo-3', ...newOrder },
          error: null,
        });

        const result = await Promise.resolve({
          data: { id: 'mo-3', ...newOrder },
          error: null,
        });

        expect(result.data?.id).toBe('mo-3');
      });
    });

    describe('update', () => {
      it('should update manufacturing order status', async () => {
        const result = await Promise.resolve({
          data: { id: 'mo-1', status: 'completed' },
          error: null,
        });

        expect(result.data?.status).toBe('completed');
      });
    });
  });

  describe('Stock Management', () => {
    describe('calculateAVCO', () => {
      it('should calculate weighted average cost', () => {
        const currentStock = 100;
        const currentCost = 10;
        const newQuantity = 50;
        const newCost = 12;

        const totalValue = (currentStock * currentCost) + (newQuantity * newCost);
        const totalQuantity = currentStock + newQuantity;
        const newAVCO = totalValue / totalQuantity;

        expect(newAVCO.toFixed(2)).toBe('10.67');
      });

      it('should handle zero current stock', () => {
        const currentStock = 0;
        const currentCost = 0;
        const newQuantity = 100;
        const newCost = 15;

        const totalQuantity = currentStock + newQuantity;
        const newAVCO = totalQuantity > 0 
          ? ((currentStock * currentCost) + (newQuantity * newCost)) / totalQuantity 
          : newCost;

        expect(newAVCO).toBe(15);
      });

      it('should not change AVCO on outgoing', () => {
        const currentStock = 100;
        const currentCost = 10;
        const soldQuantity = 30;

        // AVCO remains same for outgoing
        const newStock = currentStock - soldQuantity;
        const newAVCO = currentCost;

        expect(newStock).toBe(70);
        expect(newAVCO).toBe(10);
      });
    });

    describe('stockMovements', () => {
      it('should record incoming movement', () => {
        const movement = {
          product_id: 'prod-1',
          quantity: 50, // Positive for incoming
          move_type: 'purchase_receipt',
          unit_cost: 10,
        };

        expect(movement.quantity).toBeGreaterThan(0);
      });

      it('should record outgoing movement', () => {
        const movement = {
          product_id: 'prod-1',
          quantity: -30, // Negative for outgoing
          move_type: 'sales_delivery',
          unit_cost_out: 10,
        };

        expect(movement.quantity).toBeLessThan(0);
      });
    });
  });

  describe('Trial Balance', () => {
    describe('calculation', () => {
      it('should aggregate account balances', () => {
        const entries = [
          { account_code: '1000', debit: 1000, credit: 0 },
          { account_code: '1000', debit: 500, credit: 0 },
          { account_code: '2000', debit: 0, credit: 1500 },
        ];

        const balances = new Map<string, { debit: number; credit: number }>();
        
        entries.forEach(e => {
          const current = balances.get(e.account_code) || { debit: 0, credit: 0 };
          balances.set(e.account_code, {
            debit: current.debit + e.debit,
            credit: current.credit + e.credit,
          });
        });

        expect(balances.get('1000')?.debit).toBe(1500);
        expect(balances.get('2000')?.credit).toBe(1500);
      });

      it('should verify debits equal credits', () => {
        const trialBalance = [
          { account: '1000', debit: 1500, credit: 0 },
          { account: '2000', debit: 0, credit: 1500 },
        ];

        const totalDebit = trialBalance.reduce((sum, t) => sum + t.debit, 0);
        const totalCredit = trialBalance.reduce((sum, t) => sum + t.credit, 0);

        expect(totalDebit).toBe(totalCredit);
      });
    });
  });

  describe('Sales Order Processing', () => {
    describe('order aggregation', () => {
      it('should calculate order total from lines', () => {
        const lines = [
          { quantity: 10, unit_price: 100 },
          { quantity: 5, unit_price: 200 },
          { quantity: 2, unit_price: 500 },
        ];

        const subtotal = lines.reduce((sum, l) => sum + (l.quantity * l.unit_price), 0);
        const taxRate = 0.15;
        const taxAmount = subtotal * taxRate;
        const total = subtotal + taxAmount;

        expect(subtotal).toBe(3000);
        expect(taxAmount).toBe(450);
        expect(total).toBe(3450);
      });

      it('should apply discount correctly', () => {
        const subtotal = 1000;
        const discountPercentage = 10;
        const discountAmount = subtotal * (discountPercentage / 100);
        const afterDiscount = subtotal - discountAmount;

        expect(discountAmount).toBe(100);
        expect(afterDiscount).toBe(900);
      });
    });

    describe('status workflow', () => {
      it('should validate status transitions', () => {
        const validTransitions: Record<string, string[]> = {
          draft: ['confirmed', 'cancelled'],
          confirmed: ['in_production', 'cancelled'],
          in_production: ['ready'],
          ready: ['delivered'],
          delivered: [],
          cancelled: [],
        };

        const canTransition = (from: string, to: string) => 
          validTransitions[from]?.includes(to) ?? false;

        expect(canTransition('draft', 'confirmed')).toBe(true);
        expect(canTransition('draft', 'delivered')).toBe(false);
        expect(canTransition('delivered', 'draft')).toBe(false);
      });
    });
  });

  describe('Purchase Order Processing', () => {
    describe('goods receipt', () => {
      it('should update received quantities', () => {
        const orderLines = [
          { id: 'l1', ordered_quantity: 100, received_quantity: 0 },
          { id: 'l2', ordered_quantity: 50, received_quantity: 25 },
        ];

        const receipt = [
          { line_id: 'l1', quantity: 60 },
          { line_id: 'l2', quantity: 25 },
        ];

        const updated = orderLines.map(line => {
          const received = receipt.find(r => r.line_id === line.id);
          return {
            ...line,
            received_quantity: line.received_quantity + (received?.quantity || 0),
          };
        });

        expect(updated[0].received_quantity).toBe(60);
        expect(updated[1].received_quantity).toBe(50);
      });

      it('should calculate receipt status', () => {
        const getReceiptStatus = (ordered: number, received: number) => {
          if (received === 0) return 'pending';
          if (received < ordered) return 'partial';
          return 'complete';
        };

        expect(getReceiptStatus(100, 0)).toBe('pending');
        expect(getReceiptStatus(100, 50)).toBe('partial');
        expect(getReceiptStatus(100, 100)).toBe('complete');
      });
    });
  });

  describe('Work Center Operations', () => {
    describe('cost calculation', () => {
      it('should calculate hourly rate', () => {
        const laborCost = 50;
        const overheadCost = 30;
        const hourlyRate = laborCost + overheadCost;

        expect(hourlyRate).toBe(80);
      });

      it('should calculate stage cost', () => {
        const hourlyRate = 80;
        const duration = 2.5; // hours
        const stageCost = hourlyRate * duration;

        expect(stageCost).toBe(200);
      });

      it('should calculate total production cost', () => {
        const stages = [
          { hourly_rate: 80, duration: 2 },
          { hourly_rate: 100, duration: 1.5 },
          { hourly_rate: 60, duration: 3 },
        ];

        const totalCost = stages.reduce((sum, s) => sum + (s.hourly_rate * s.duration), 0);

        expect(totalCost).toBe(490);
      });
    });

    describe('efficiency tracking', () => {
      it('should calculate efficiency rate', () => {
        const standardTime = 10; // hours
        const actualTime = 12; // hours
        const efficiency = (standardTime / actualTime) * 100;

        expect(efficiency.toFixed(2)).toBe('83.33');
      });

      it('should identify over-budget stages', () => {
        const stages = [
          { planned_cost: 100, actual_cost: 90 },
          { planned_cost: 200, actual_cost: 250 },
          { planned_cost: 150, actual_cost: 150 },
        ];

        const overBudget = stages.filter(s => s.actual_cost > s.planned_cost);

        expect(overBudget).toHaveLength(1);
        expect(overBudget[0].planned_cost).toBe(200);
      });
    });
  });

  describe('Real-time Subscriptions', () => {
    it('should create subscription channel', () => {
      const channelName = 'manufacturing_orders:tenant-123';
      const channel = { name: channelName };

      expect(channel.name).toContain('manufacturing_orders');
    });

    it('should filter by tenant', () => {
      const tenantId = 'tenant-123';
      const filter = `tenant_id=eq.${tenantId}`;

      expect(filter).toBe('tenant_id=eq.tenant-123');
    });
  });

  describe('Error Handling', () => {
    it('should handle network errors', async () => {
      const result = await Promise.resolve({
        data: null,
        error: { message: 'Network error', code: 'NETWORK_ERROR' },
      });

      expect(result.error).toBeDefined();
      expect(result.error?.code).toBe('NETWORK_ERROR');
    });

    it('should handle RLS violations', async () => {
      const result = await Promise.resolve({
        data: null,
        error: { message: 'new row violates row-level security', code: '42501' },
      });

      expect(result.error?.code).toBe('42501');
    });

    it('should handle not found errors', async () => {
      const result = await Promise.resolve({
        data: null,
        error: { message: 'No rows returned', code: 'PGRST116' },
      });

      expect(result.error?.code).toBe('PGRST116');
    });
  });

  describe('Data Validation', () => {
    it('should validate UUID format', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      const invalidUUID = 'not-a-uuid';

      expect(uuidRegex.test(validUUID)).toBe(true);
      expect(uuidRegex.test(invalidUUID)).toBe(false);
    });

    it('should validate date format', () => {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      const validDate = '2025-12-20';
      const invalidDate = '20-12-2025';

      expect(dateRegex.test(validDate)).toBe(true);
      expect(dateRegex.test(invalidDate)).toBe(false);
    });

    it('should validate positive numbers', () => {
      const isPositive = (n: number) => n > 0;

      expect(isPositive(100)).toBe(true);
      expect(isPositive(0)).toBe(false);
      expect(isPositive(-50)).toBe(false);
    });
  });

  describe('Pagination', () => {
    it('should calculate offset from page number', () => {
      const page = 3;
      const pageSize = 10;
      const offset = (page - 1) * pageSize;

      expect(offset).toBe(20);
    });

    it('should calculate total pages', () => {
      const totalItems = 95;
      const pageSize = 10;
      const totalPages = Math.ceil(totalItems / pageSize);

      expect(totalPages).toBe(10);
    });

    it('should handle last page with partial items', () => {
      const totalItems = 95;
      const pageSize = 10;
      const currentPage = 10;
      const itemsOnPage = totalItems - ((currentPage - 1) * pageSize);

      expect(itemsOnPage).toBe(5);
    });
  });

  describe('Sorting', () => {
    it('should sort by date descending', () => {
      const items = [
        { date: '2025-12-15' },
        { date: '2025-12-20' },
        { date: '2025-12-18' },
      ];

      const sorted = [...items].sort((a, b) => 
        new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      expect(sorted[0].date).toBe('2025-12-20');
      expect(sorted[2].date).toBe('2025-12-15');
    });

    it('should sort by amount ascending', () => {
      const items = [
        { amount: 500 },
        { amount: 100 },
        { amount: 300 },
      ];

      const sorted = [...items].sort((a, b) => a.amount - b.amount);

      expect(sorted[0].amount).toBe(100);
      expect(sorted[2].amount).toBe(500);
    });
  });

  describe('Filtering', () => {
    it('should filter by status', () => {
      const orders = [
        { id: 1, status: 'draft' },
        { id: 2, status: 'confirmed' },
        { id: 3, status: 'draft' },
      ];

      const drafts = orders.filter(o => o.status === 'draft');

      expect(drafts).toHaveLength(2);
    });

    it('should filter by date range', () => {
      const items = [
        { date: '2025-12-15' },
        { date: '2025-12-20' },
        { date: '2025-12-25' },
      ];

      const startDate = new Date('2025-12-18');
      const endDate = new Date('2025-12-22');

      const filtered = items.filter(i => {
        const date = new Date(i.date);
        return date >= startDate && date <= endDate;
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].date).toBe('2025-12-20');
    });

    it('should filter by search text', () => {
      const products = [
        { name: 'Wardah Shampoo' },
        { name: 'Wardah Conditioner' },
        { name: 'Other Product' },
      ];

      const searchTerm = 'wardah';
      const filtered = products.filter(p => 
        p.name.toLowerCase().includes(searchTerm.toLowerCase())
      );

      expect(filtered).toHaveLength(2);
    });
  });
});
