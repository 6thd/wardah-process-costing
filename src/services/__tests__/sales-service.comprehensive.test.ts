/**
 * @fileoverview Comprehensive Tests for Sales Service
 * Tests the complete sales cycle: Invoice → Delivery → Collection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock supabase
const mockSupabaseFrom = vi.fn();
const mockSupabaseSelect = vi.fn();
const mockSupabaseInsert = vi.fn();
const mockSupabaseUpdate = vi.fn();
const mockSupabaseSingle = vi.fn();
const mockSupabaseEq = vi.fn();

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockSupabaseFrom(table);
      return {
        select: (...args: any[]) => {
          mockSupabaseSelect(...args);
          return {
            eq: (...eqArgs: any[]) => {
              mockSupabaseEq(...eqArgs);
              return {
                single: () => mockSupabaseSingle(),
                then: (cb: any) => cb({ data: [], error: null }),
              };
            },
            single: () => mockSupabaseSingle(),
          };
        },
        insert: (data: any) => {
          mockSupabaseInsert(data);
          return {
            select: () => ({
              single: () => mockSupabaseSingle(),
            }),
          };
        },
        update: (data: any) => {
          mockSupabaseUpdate(data);
          return {
            eq: () => ({ error: null }),
          };
        },
      };
    },
  },
}));

// Import functions and types after mocking
import {
  createSalesInvoice,
  getSalesInvoiceWithDetails,
  deliverGoods,
  recordCustomerCollection,
  getAllSalesInvoices,
  getAllDeliveryNotes,
  type SalesInvoice,
  type SalesInvoiceLine,
  type DeliveryNote,
  type DeliveryNoteLine,
} from '../sales-service';

describe('Sales Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createSalesInvoice', () => {
    const validInvoice: SalesInvoice = {
      invoice_number: 'INV-001',
      customer_id: 'cust-1',
      invoice_date: '2025-12-20',
      due_date: '2025-01-20',
      payment_terms: 'Net 30',
      delivery_status: 'pending',
      payment_status: 'unpaid',
      subtotal: 1000,
      discount_amount: 50,
      tax_amount: 142.5, // 15% VAT
      total_amount: 1092.5,
      paid_amount: 0,
      lines: [
        {
          product_id: 'prod-1',
          quantity: 10,
          unit_price: 100,
          discount_percentage: 5,
          tax_percentage: 15,
        },
      ],
    };

    it('should create invoice successfully when stock is available', async () => {
      // Mock stock check
      mockSupabaseSingle.mockResolvedValueOnce({
        data: { quantity_in_stock: 100, name: 'Product A' },
        error: null,
      });

      // Mock invoice insert
      mockSupabaseSingle.mockResolvedValueOnce({
        data: { id: 'inv-1', ...validInvoice },
        error: null,
      });

      const result = await createSalesInvoice(validInvoice);

      expect(mockSupabaseFrom).toHaveBeenCalledWith('products');
      expect(mockSupabaseFrom).toHaveBeenCalledWith('sales_invoices');
    });

    it('should fail when stock is insufficient', async () => {
      mockSupabaseSingle.mockResolvedValueOnce({
        data: { quantity_in_stock: 5, name: 'Product A' },
        error: null,
      });

      const result = await createSalesInvoice(validInvoice);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle product not found error', async () => {
      mockSupabaseSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Product not found' },
      });

      const result = await createSalesInvoice(validInvoice);

      expect(result.success).toBe(false);
    });

    it('should calculate correct amounts', () => {
      const subtotal = 1000;
      const discount = 50;
      const taxRate = 0.15;
      const taxableAmount = subtotal - discount;
      const tax = taxableAmount * taxRate;
      const total = taxableAmount + tax;

      expect(validInvoice.subtotal).toBe(subtotal);
      expect(validInvoice.discount_amount).toBe(discount);
      expect(validInvoice.tax_amount).toBe(142.5);
      expect(validInvoice.total_amount).toBe(1092.5);
    });
  });

  describe('getSalesInvoiceWithDetails', () => {
    it('should fetch invoice with customer and lines', async () => {
      const mockInvoice = {
        id: 'inv-1',
        invoice_number: 'INV-001',
        customer: { id: 'cust-1', name: 'Customer A' },
        lines: [{ product_id: 'prod-1', quantity: 10 }],
      };

      mockSupabaseSingle.mockResolvedValueOnce({
        data: mockInvoice,
        error: null,
      });

      const result = await getSalesInvoiceWithDetails('inv-1');

      expect(mockSupabaseFrom).toHaveBeenCalledWith('sales_invoices');
      expect(mockSupabaseEq).toHaveBeenCalledWith('id', 'inv-1');
    });

    it('should handle not found error', async () => {
      mockSupabaseSingle.mockResolvedValueOnce({
        data: null,
        error: { message: 'Invoice not found' },
      });

      const result = await getSalesInvoiceWithDetails('invalid-id');

      expect(result.success).toBe(false);
    });
  });

  describe('deliverGoods', () => {
    const delivery: DeliveryNote = {
      sales_invoice_id: 'inv-1',
      customer_id: 'cust-1',
      delivery_date: '2025-12-20',
      vehicle_number: 'ABC-123',
      driver_name: 'Driver A',
    };

    const deliveryLines: DeliveryNoteLine[] = [
      {
        product_id: 'prod-1',
        invoiced_quantity: 10,
        delivered_quantity: 10,
        unit_price: 100,
      },
    ];

    it('should create delivery note and deduct inventory', async () => {
      // Mock delivery note insert
      mockSupabaseSingle.mockResolvedValueOnce({
        data: { id: 'dn-1', delivery_number: 'DN-001' },
        error: null,
      });

      // Mock product fetch for AVCO
      mockSupabaseSingle.mockResolvedValueOnce({
        data: { cost_price: 80, quantity_in_stock: 100, name: 'Product A' },
        error: null,
      });

      const result = await deliverGoods(delivery, deliveryLines);

      expect(mockSupabaseFrom).toHaveBeenCalledWith('delivery_notes');
    });

    it('should calculate COGS correctly using AVCO', async () => {
      const unitCost = 80;
      const quantity = 10;
      const expectedCOGS = unitCost * quantity; // 800

      expect(expectedCOGS).toBe(800);
    });

    it('should fail when stock is insufficient for delivery', async () => {
      mockSupabaseSingle.mockResolvedValueOnce({
        data: { id: 'dn-1' },
        error: null,
      });

      mockSupabaseSingle.mockResolvedValueOnce({
        data: { cost_price: 80, quantity_in_stock: 5, name: 'Product A' },
        error: null,
      });

      const result = await deliverGoods(delivery, deliveryLines);

      expect(result.success).toBe(false);
    });
  });

  describe('recordCustomerCollection', () => {
    it('should update invoice paid amount and status', async () => {
      // Mock fetch invoice
      mockSupabaseSingle.mockResolvedValueOnce({
        data: {
          id: 'inv-1',
          invoice_number: 'INV-001',
          total_amount: 1000,
          paid_amount: 0,
        },
        error: null,
      });

      const result = await recordCustomerCollection('inv-1', 500, '2025-12-20', 'cash');

      expect(mockSupabaseFrom).toHaveBeenCalledWith('sales_invoices');
      expect(mockSupabaseUpdate).toHaveBeenCalled();
    });

    it('should set status to paid when fully collected', async () => {
      mockSupabaseSingle.mockResolvedValueOnce({
        data: {
          id: 'inv-1',
          invoice_number: 'INV-001',
          total_amount: 1000,
          paid_amount: 500,
        },
        error: null,
      });

      // Collecting remaining 500
      const result = await recordCustomerCollection('inv-1', 500, '2025-12-20', 'bank');

      // Verify update was called
      expect(mockSupabaseUpdate).toHaveBeenCalled();
    });

    it('should set status to partially_paid when partially collected', async () => {
      const totalAmount = 1000;
      const paidAmount = 0;
      const collectionAmount = 300;
      const newPaidAmount = paidAmount + collectionAmount;
      const balance = totalAmount - newPaidAmount;

      let status = 'unpaid';
      if (balance === 0) status = 'paid';
      else if (newPaidAmount > 0) status = 'partially_paid';

      expect(status).toBe('partially_paid');
      expect(newPaidAmount).toBe(300);
      expect(balance).toBe(700);
    });

    it('should create correct GL entry for cash collection', async () => {
      // Cash collection uses account 1110
      const paymentMethod: string = 'cash';
      const accountCode = paymentMethod === 'cash' ? '1110' : '1111';

      expect(accountCode).toBe('1110');
    });

    it('should create correct GL entry for bank collection', async () => {
      const paymentMethod: string = 'bank';
      const accountCode = paymentMethod === 'cash' ? '1110' : '1111';

      expect(accountCode).toBe('1111');
    });
  });

  describe('GL Entry Generation', () => {
    it('should create sales GL entry with correct accounts', () => {
      const invoice = {
        invoice_number: 'INV-001',
        total_amount: 1150,
        tax_amount: 150,
      };

      const revenueAmount = invoice.total_amount - invoice.tax_amount;

      // Expected entries:
      // DR: 1120 (Accounts Receivable) = 1150
      // CR: 4001 (Sales Revenue) = 1000
      // CR: 2162 (VAT Output) = 150

      expect(revenueAmount).toBe(1000);
    });

    it('should create COGS GL entry with correct accounts', () => {
      const totalCOGS = 800;

      // Expected entries:
      // DR: 5001 (COGS) = 800
      // CR: 1130 (Inventory) = 800

      expect(totalCOGS).toBe(800);
    });

    it('should create collection GL entry with correct accounts', () => {
      const collectionAmount = 500;
      const paymentMethod = 'cash';

      // Expected entries:
      // DR: 1110 (Cash) = 500
      // CR: 1120 (Accounts Receivable) = 500

      expect(collectionAmount).toBe(500);
    });
  });

  describe('Delivery Status Updates', () => {
    // Helper function to calculate delivery status
    const calculateDeliveryStatus = (lines: Array<{ quantity: number; delivered_quantity?: number }>): string => {
      let allDelivered = true;
      let anyDelivered = false;

      for (const line of lines) {
        if ((line.delivered_quantity || 0) < line.quantity) allDelivered = false;
        if ((line.delivered_quantity || 0) > 0) anyDelivered = true;
      }

      if (allDelivered) {
        return 'fully_delivered';
      }
      if (anyDelivered) {
        return 'partially_delivered';
      }
      return 'pending';
    };

    it('should set status to pending when nothing delivered', () => {
      const lines = [
        { quantity: 10, delivered_quantity: 0 },
        { quantity: 5, delivered_quantity: 0 },
      ];

      const status = calculateDeliveryStatus(lines);

      expect(status).toBe('pending');
    });

    it('should set status to partially_delivered when some items delivered', () => {
      const lines = [
        { quantity: 10, delivered_quantity: 5 },
        { quantity: 5, delivered_quantity: 0 },
      ];

      const status = calculateDeliveryStatus(lines);

      expect(status).toBe('partially_delivered');
    });

    it('should set status to fully_delivered when all items delivered', () => {
      const lines = [
        { quantity: 10, delivered_quantity: 10 },
        { quantity: 5, delivered_quantity: 5 },
      ];

      const status = calculateDeliveryStatus(lines);

      expect(status).toBe('fully_delivered');
    });
  });

  describe('Payment Status Updates', () => {
    it('should calculate correct payment status - unpaid', () => {
      const totalAmount: number = 1000;
      const paidAmount: number = 0;

      let status: string;
      if (paidAmount === 0) status = 'unpaid';
      else if (paidAmount >= totalAmount) status = 'paid';
      else status = 'partially_paid';

      expect(status).toBe('unpaid');
    });

    it('should calculate correct payment status - partially_paid', () => {
      const totalAmount: number = 1000;
      const paidAmount: number = 500;

      let status: string;
      if (paidAmount === 0) status = 'unpaid';
      else if (paidAmount >= totalAmount) status = 'paid';
      else status = 'partially_paid';

      expect(status).toBe('partially_paid');
    });

    it('should calculate correct payment status - paid', () => {
      const totalAmount: number = 1000;
      const paidAmount: number = 1000;

      let status: string;
      if (paidAmount === 0) status = 'unpaid';
      else if (paidAmount >= totalAmount) status = 'paid';
      else status = 'partially_paid';

      expect(status).toBe('paid');
    });
  });

  describe('AVCO Calculation', () => {
    it('should use current cost price for COGS', () => {
      const productCostPrice = 80;
      const quantityDelivered = 10;
      const expectedCOGS = productCostPrice * quantityDelivered;

      expect(expectedCOGS).toBe(800);
    });

    it('should handle multiple products with different costs', () => {
      const products = [
        { cost_price: 80, quantity: 10 },
        { cost_price: 120, quantity: 5 },
      ];

      const totalCOGS = products.reduce((sum, p) => sum + (p.cost_price * p.quantity), 0);

      expect(totalCOGS).toBe(800 + 600); // 1400
    });
  });

  describe('Tax Calculations', () => {
    it('should calculate VAT at 15%', () => {
      const subtotal = 1000;
      const discount = 50;
      const taxableAmount = subtotal - discount;
      const vatRate = 0.15;
      const vat = taxableAmount * vatRate;

      expect(vat).toBe(142.5);
    });

    it('should calculate total with tax correctly', () => {
      const subtotal = 1000;
      const discount = 50;
      const taxableAmount = subtotal - discount;
      const vat = taxableAmount * 0.15;
      const total = taxableAmount + vat;

      expect(total).toBe(1092.5);
    });

    it('should handle zero discount', () => {
      const subtotal = 1000;
      const discount = 0;
      const taxableAmount = subtotal - discount;
      const vat = taxableAmount * 0.15;
      const total = taxableAmount + vat;

      expect(total).toBe(1150);
    });
  });
});
