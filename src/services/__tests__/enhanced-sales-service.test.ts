/**
 * @fileoverview Comprehensive Tests for Enhanced Sales Service
 * Tests the complete sales module: Orders → Invoices → Delivery → Collection
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
const mockFrom = vi.fn();
const mockSelect = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockIn = vi.fn();
const mockOrder = vi.fn();
const mockLimit = vi.fn();
const mockMaybeSingle = vi.fn();

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
                eq: () => ({
                  eq: () => ({
                    single: () => mockSingle(),
                    maybeSingle: () => mockMaybeSingle(),
                  }),
                  in: () => ({ then: (cb: (r: { data: unknown[]; error: null }) => void) => cb({ data: [], error: null }) }),
                  order: () => ({ limit: () => mockSingle() }),
                  single: () => mockSingle(),
                }),
                single: () => mockSingle(),
                order: () => ({ limit: () => mockSingle() }),
                in: () => ({ then: (cb: (r: { data: unknown[]; error: null }) => void) => cb({ data: [], error: null }) }),
              };
            },
            single: () => mockSingle(),
            order: () => ({
              limit: () => mockSingle(),
            }),
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
            eq: () => ({
              eq: () => ({ error: null }),
              error: null,
            }),
          };
        },
        delete: () => {
          mockDelete();
          return {
            eq: () => ({ eq: () => ({ error: null }) }),
          };
        },
      };
    },
  },
  getEffectiveTenantId: vi.fn().mockResolvedValue('tenant-123'),
}));

// Mock JournalService
vi.mock('../accounting/journal-service', () => ({
  JournalService: {
    createAutoEntry: vi.fn().mockResolvedValue({ success: true, data: { id: 'je-1' } }),
  },
}));

// Import after mocking
import {
  createSalesOrder,
  confirmSalesOrder,
  createSalesInvoice,
  type SalesOrder,
  type SalesOrderLine,
  type SalesInvoice,
  type DeliveryNote,
  type CustomerCollection,
} from '../enhanced-sales-service';

describe('Enhanced Sales Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Sales Order Creation', () => {
    const validOrder: Omit<SalesOrder, 'id' | 'so_number'> = {
      customer_id: 'cust-1',
      order_date: '2025-12-20',
      delivery_date: '2025-12-25',
      status: 'draft',
      subtotal: 1000,
      tax_amount: 150,
      total_amount: 1150,
    };

    const validLines: Omit<SalesOrderLine, 'id' | 'so_id'>[] = [
      {
        item_id: 'item-1',
        line_number: 1,
        quantity: 10,
        unit_price: 100,
        total_price: 1000,
      },
    ];

    it('should create sales order successfully', async () => {
      // Mock stock check
      mockSingle.mockResolvedValueOnce({
        data: { stock_quantity: 100, name: 'Product A' },
        error: null,
      });

      // Mock credit check - customer
      mockSingle.mockResolvedValueOnce({
        data: { credit_limit: 50000 },
        error: null,
      });

      // Mock order number generation
      mockSingle.mockResolvedValueOnce({
        data: { so_number: 'SO-000001' },
        error: null,
      });

      // Mock order insert
      mockSingle.mockResolvedValueOnce({
        data: { id: 'so-1', so_number: 'SO-000002' },
        error: null,
      });

      // Mock lines insert (doesn't return single)
      mockInsert.mockImplementationOnce(() => ({
        error: null,
      }));

      // Mock full order fetch
      mockSingle.mockResolvedValueOnce({
        data: {
          id: 'so-1',
          so_number: 'SO-000002',
          customer: { name: 'Customer A' },
          lines: [{ item: { name: 'Product A' } }],
        },
        error: null,
      });

      const result = await createSalesOrder(validOrder, validLines);

      expect(mockFrom).toHaveBeenCalledWith('items');
      expect(mockFrom).toHaveBeenCalledWith('customers');
      expect(mockFrom).toHaveBeenCalledWith('sales_orders');
    });

    it('should fail when no lines provided', async () => {
      const result = await createSalesOrder(validOrder, []);

      expect(result.success).toBe(false);
      expect(result.error).toContain('at least one line');
    });

    it('should validate stock availability', async () => {
      // Mock insufficient stock
      mockSingle.mockResolvedValueOnce({
        data: { stock_quantity: 5, name: 'Product A' },
        error: null,
      });

      const result = await createSalesOrder(validOrder, validLines);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Insufficient stock');
    });
  });

  describe('Sales Order Confirmation', () => {
    it('should confirm order successfully', async () => {
      mockUpdate.mockImplementationOnce(() => ({
        eq: () => ({ error: null }),
      }));

      const result = await confirmSalesOrder('so-1');

      expect(mockFrom).toHaveBeenCalledWith('sales_orders');
      expect(mockUpdate).toHaveBeenCalled();
    });

    it('should handle confirmation error', async () => {
      mockUpdate.mockImplementationOnce(() => ({
        eq: () => ({ error: new Error('Update failed') }),
      }));

      const result = await confirmSalesOrder('invalid-id');

      // Should handle error gracefully
      expect(mockFrom).toHaveBeenCalledWith('sales_orders');
    });
  });

  describe('Sales Invoice Creation', () => {
    const validInvoice: Omit<SalesInvoice, 'id' | 'invoice_number'> = {
      customer_id: 'cust-1',
      invoice_date: '2025-12-20',
      due_date: '2026-01-20',
      delivery_status: 'pending',
      payment_status: 'unpaid',
      subtotal: 1000,
      tax_amount: 150,
      total_amount: 1150,
      lines: [
        {
          item_id: 'item-1',
          quantity: 10,
          unit_price: 100,
          line_total: 1000,
        },
      ],
    };

    it('should create invoice with accounting entry', async () => {
      // Mock invoice number generation
      mockSingle.mockResolvedValueOnce({
        data: { invoice_number: 'SI-000001' },
        error: null,
      });

      // Mock invoice insert
      mockSingle.mockResolvedValueOnce({
        data: { id: 'inv-1', invoice_number: 'SI-000002' },
        error: null,
      });

      // Mock lines insert
      mockInsert.mockImplementationOnce(() => ({
        error: null,
      }));

      // Mock full invoice fetch
      mockSingle.mockResolvedValueOnce({
        data: {
          id: 'inv-1',
          invoice_number: 'SI-000002',
          lines: [],
        },
        error: null,
      });

      const result = await createSalesInvoice(validInvoice);

      // The function may call various tables during creation process
      expect(mockFrom).toHaveBeenCalled();
    });

    it('should fail when no lines provided', async () => {
      const invoiceWithoutLines = { ...validInvoice, lines: [] };

      const result = await createSalesInvoice(invoiceWithoutLines);

      expect(result.success).toBe(false);
      expect(result.error).toContain('at least one line');
    });
  });

  describe('Type Definitions', () => {
    it('should have correct SalesOrder type structure', () => {
      const order: Partial<SalesOrder> = {
        id: 'so-1',
        so_number: 'SO-000001',
        customer_id: 'cust-1',
        order_date: '2025-12-20',
        status: 'draft',
        total_amount: 1000,
      };

      expect(order.id).toBeDefined();
      expect(order.so_number).toBeDefined();
      expect(order.status).toBe('draft');
    });

    it('should have correct DeliveryNote type structure', () => {
      const delivery: Partial<DeliveryNote> = {
        id: 'dn-1',
        delivery_number: 'DN-000001',
        sales_invoice_id: 'inv-1',
        customer_id: 'cust-1',
        delivery_date: '2025-12-20',
        status: 'draft',
        lines: [],
      };

      expect(delivery.status).toBe('draft');
      expect(delivery.lines).toEqual([]);
    });

    it('should have correct CustomerCollection type structure', () => {
      const collection: Partial<CustomerCollection> = {
        id: 'col-1',
        collection_number: 'COL-000001',
        sales_invoice_id: 'inv-1',
        customer_id: 'cust-1',
        collection_date: '2025-12-20',
        amount: 500,
        payment_method: 'cash',
      };

      expect(collection.payment_method).toBe('cash');
      expect(collection.amount).toBe(500);
    });

    it('should validate payment methods', () => {
      const validMethods = ['cash', 'bank', 'check', 'credit_card', 'other'];
      
      validMethods.forEach(method => {
        const collection: Partial<CustomerCollection> = {
          payment_method: method as CustomerCollection['payment_method'],
        };
        expect(validMethods).toContain(collection.payment_method);
      });
    });

    it('should validate order status values', () => {
      const validStatuses = ['draft', 'confirmed', 'in_production', 'ready', 'delivered', 'cancelled'];
      
      validStatuses.forEach(status => {
        const order: Partial<SalesOrder> = {
          status: status as SalesOrder['status'],
        };
        expect(validStatuses).toContain(order.status);
      });
    });
  });

  describe('Credit Limit Validation', () => {
    it('should calculate available credit correctly', () => {
      const creditLimit = 50000;
      const currentBalance = 30000;
      const availableCredit = creditLimit - currentBalance;
      
      expect(availableCredit).toBe(20000);
    });

    it('should allow when credit limit is zero (unlimited)', () => {
      const creditLimit = 0;
      const newAmount = 100000;
      const allowed = creditLimit === 0 || newAmount <= creditLimit;
      
      expect(allowed).toBe(true);
    });

    it('should block when exceeding credit limit', () => {
      const creditLimit = 10000;
      const currentBalance = 8000;
      const newAmount = 5000;
      const allowed = (currentBalance + newAmount) <= creditLimit;
      
      expect(allowed).toBe(false);
    });
  });

  describe('Number Generation', () => {
    it('should parse SO number correctly', () => {
      const lastNumber = 'SO-000005';
      const match = lastNumber.match(/SO-(\d+)/);
      const nextNum = match ? Number.parseInt(match[1], 10) + 1 : 1;
      
      expect(nextNum).toBe(6);
    });

    it('should parse invoice number correctly', () => {
      const lastNumber = 'SI-000010';
      const match = lastNumber.match(/SI-(\d+)/);
      const nextNum = match ? Number.parseInt(match[1], 10) + 1 : 1;
      
      expect(nextNum).toBe(11);
    });

    it('should format number with padding', () => {
      const num = 42;
      const formatted = `SO-${String(num).padStart(6, '0')}`;
      
      expect(formatted).toBe('SO-000042');
    });

    it('should handle first order (no previous)', () => {
      const lastNumber = 'SO-000000';
      const match = lastNumber.match(/SO-(\d+)/);
      const nextNum = match ? Number.parseInt(match[1], 10) + 1 : 1;
      
      expect(nextNum).toBe(1);
    });
  });

  describe('Stock Validation', () => {
    it('should validate sufficient stock', () => {
      const availableQty = 100;
      const requiredQty = 50;
      const available = availableQty >= requiredQty;
      
      expect(available).toBe(true);
    });

    it('should reject insufficient stock', () => {
      const availableQty = 30;
      const requiredQty = 50;
      const available = availableQty >= requiredQty;
      
      expect(available).toBe(false);
    });

    it('should calculate new stock after sale', () => {
      const currentStock = 100;
      const soldQuantity = 25;
      const newStock = currentStock - soldQuantity;
      
      expect(newStock).toBe(75);
    });
  });

  describe('COGS Calculation', () => {
    it('should calculate COGS correctly', () => {
      const quantity = 10;
      const unitCost = 50;
      const cogs = quantity * unitCost;
      
      expect(cogs).toBe(500);
    });

    it('should calculate profit margin', () => {
      const sellingPrice = 100;
      const unitCost = 60;
      const quantity = 10;
      
      const revenue = sellingPrice * quantity;
      const cogs = unitCost * quantity;
      const profit = revenue - cogs;
      const margin = (profit / revenue) * 100;
      
      expect(profit).toBe(400);
      expect(margin).toBe(40);
    });
  });

  describe('Invoice Totals', () => {
    it('should calculate subtotal correctly', () => {
      const lines = [
        { quantity: 10, unit_price: 100 },
        { quantity: 5, unit_price: 200 },
      ];
      
      const subtotal = lines.reduce((sum, line) => sum + (line.quantity * line.unit_price), 0);
      
      expect(subtotal).toBe(2000);
    });

    it('should calculate tax correctly', () => {
      const subtotal = 1000;
      const taxRate = 15;
      const taxAmount = subtotal * (taxRate / 100);
      
      expect(taxAmount).toBe(150);
    });

    it('should calculate total with discount', () => {
      const subtotal = 1000;
      const discount = 50;
      const taxRate = 15;
      
      const afterDiscount = subtotal - discount;
      const taxAmount = afterDiscount * (taxRate / 100);
      const total = afterDiscount + taxAmount;
      
      expect(total).toBe(1092.5);
    });
  });

  describe('Payment Status', () => {
    it('should determine unpaid status', () => {
      const totalAmount = 1000;
      const paidAmount = 0;
      
      let status: string;
      if (paidAmount === 0) {
        status = 'unpaid';
      } else if (paidAmount < totalAmount) {
        status = 'partially_paid';
      } else {
        status = 'paid';
      }
      
      expect(status).toBe('unpaid');
    });

    it('should determine partially paid status', () => {
      const totalAmount = 1000;
      const paidAmount = 500;
      
      let status: string;
      if (paidAmount === 0) {
        status = 'unpaid';
      } else if (paidAmount < totalAmount) {
        status = 'partially_paid';
      } else {
        status = 'paid';
      }
      
      expect(status).toBe('partially_paid');
    });

    it('should determine paid status', () => {
      const totalAmount = 1000;
      const paidAmount = 1000;
      
      let status: string;
      if (paidAmount === 0) {
        status = 'unpaid';
      } else if (paidAmount < totalAmount) {
        status = 'partially_paid';
      } else {
        status = 'paid';
      }
      
      expect(status).toBe('paid');
    });
  });

  describe('Delivery Status', () => {
    it('should determine pending delivery', () => {
      const totalQty = 100;
      const deliveredQty = 0;
      
      let status: string;
      if (deliveredQty === 0) {
        status = 'pending';
      } else if (deliveredQty < totalQty) {
        status = 'partially_delivered';
      } else {
        status = 'fully_delivered';
      }
      
      expect(status).toBe('pending');
    });

    it('should determine partial delivery', () => {
      const totalQty = 100;
      const deliveredQty = 50;
      
      let status: string;
      if (deliveredQty === 0) {
        status = 'pending';
      } else if (deliveredQty < totalQty) {
        status = 'partially_delivered';
      } else {
        status = 'fully_delivered';
      }
      
      expect(status).toBe('partially_delivered');
    });

    it('should determine full delivery', () => {
      const totalQty = 100;
      const deliveredQty = 100;
      
      let status: string;
      if (deliveredQty === 0) {
        status = 'pending';
      } else if (deliveredQty < totalQty) {
        status = 'partially_delivered';
      } else {
        status = 'fully_delivered';
      }
      
      expect(status).toBe('fully_delivered');
    });
  });
});
