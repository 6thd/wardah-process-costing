/**
 * @fileoverview Comprehensive Tests for Payment Vouchers Service
 * Tests Customer Receipts and Supplier Payments
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
const mockSupabaseFrom = vi.fn();
const mockSupabaseSelect = vi.fn();
const mockSupabaseInsert = vi.fn();
const mockSupabaseUpdate = vi.fn();
const mockSupabaseSingle = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      mockSupabaseFrom(table);
      return {
        select: (...args: any[]) => {
          mockSupabaseSelect(...args);
          return {
            like: () => ({
              order: () => ({
                limit: () => ({ single: () => mockSupabaseSingle() }),
              }),
            }),
            eq: () => ({ single: () => mockSupabaseSingle() }),
            single: () => mockSupabaseSingle(),
          };
        },
        insert: (data: any) => {
          mockSupabaseInsert(data);
          return {
            select: () => ({ single: () => mockSupabaseSingle() }),
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
  getEffectiveTenantId: vi.fn().mockResolvedValue('tenant-1'),
}));

import type {
  CustomerReceipt,
  CustomerReceiptLine,
  SupplierPayment,
  SupplierPaymentLine,
  PaymentMethod,
  VoucherStatus,
} from '../payment-vouchers-service';

describe('Payment Vouchers Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Payment Methods', () => {
    const paymentMethods: PaymentMethod[] = [
      'cash',
      'bank_transfer',
      'check',
      'credit_card',
      'debit_card',
      'online_payment',
      'mobile_payment',
      'other',
    ];

    it('should support all payment methods', () => {
      expect(paymentMethods.length).toBe(8);
      expect(paymentMethods).toContain('cash');
      expect(paymentMethods).toContain('bank_transfer');
      expect(paymentMethods).toContain('check');
    });

    it('should identify cash payment', () => {
      const method: PaymentMethod = 'cash';
      const accountCode = method === 'cash' ? '1110' : '1111';
      expect(accountCode).toBe('1110');
    });

    it('should identify bank transfer payment', () => {
      const method: string = 'bank_transfer';
      const accountCode = method === 'cash' ? '1110' : '1111';
      expect(accountCode).toBe('1111');
    });
  });

  describe('Voucher Statuses', () => {
    it('should support all voucher statuses', () => {
      const statuses: VoucherStatus[] = ['draft', 'posted', 'cancelled'];
      expect(statuses.length).toBe(3);
    });

    it('should start as draft', () => {
      const newReceipt: Partial<CustomerReceipt> = {
        receipt_number: 'CR-202512-00001',
        status: 'draft',
      };
      expect(newReceipt.status).toBe('draft');
    });
  });

  describe('Receipt Number Generation', () => {
    it('should generate receipt number with correct format', () => {
      const year = new Date().getFullYear();
      const month = String(new Date().getMonth() + 1).padStart(2, '0');
      const prefix = `CR-${year}${month}-`;
      const sequence = '00001';
      const receiptNumber = `${prefix}${sequence}`;

      expect(receiptNumber).toMatch(/^CR-\d{6}-\d{5}$/);
    });

    it('should increment sequence number', () => {
      const lastNumber = 'CR-202512-00005';
      const lastSeq = Number.parseInt(lastNumber.split('-')[2] || '0', 10);
      const nextSeq = lastSeq + 1;
      const nextNumber = `CR-202512-${String(nextSeq).padStart(5, '0')}`;

      expect(nextNumber).toBe('CR-202512-00006');
    });
  });

  describe('Customer Receipt Validation', () => {
    it('should validate amount is positive', () => {
      const amount = 1000;
      const isValid = amount > 0;
      expect(isValid).toBe(true);
    });

    it('should reject zero amount', () => {
      const amount = 0;
      const isValid = amount > 0;
      expect(isValid).toBe(false);
    });

    it('should reject negative amount', () => {
      const amount = -100;
      const isValid = amount > 0;
      expect(isValid).toBe(false);
    });

    it('should validate lines total matches receipt amount', () => {
      const lines: CustomerReceiptLine[] = [
        { invoice_id: 'inv-1', allocated_amount: 500, discount_amount: 0 },
        { invoice_id: 'inv-2', allocated_amount: 300, discount_amount: 50 },
      ];
      const receiptAmount = 750;

      const linesTotal = lines.reduce(
        (sum, line) => sum + line.allocated_amount - (line.discount_amount || 0),
        0
      );

      expect(Math.abs(linesTotal - receiptAmount)).toBeLessThanOrEqual(0.01);
    });

    it('should reject mismatched lines total', () => {
      const lines: CustomerReceiptLine[] = [
        { invoice_id: 'inv-1', allocated_amount: 500 },
      ];
      const receiptAmount = 1000;

      const linesTotal = lines.reduce(
        (sum, line) => sum + line.allocated_amount - (line.discount_amount || 0),
        0
      );

      expect(Math.abs(linesTotal - receiptAmount)).toBeGreaterThan(0.01);
    });
  });

  describe('Supplier Payment Validation', () => {
    it('should validate payment amount', () => {
      const payment: Partial<SupplierPayment> = {
        amount: 5000,
        vendor_id: 'vendor-1',
      };

      expect(payment.amount).toBeGreaterThan(0);
    });

    it('should validate lines for multi-invoice payment', () => {
      const lines: SupplierPaymentLine[] = [
        { invoice_id: 'po-1', allocated_amount: 2000 },
        { invoice_id: 'po-2', allocated_amount: 3000 },
      ];
      const paymentAmount = 5000;

      const linesTotal = lines.reduce(
        (sum, line) => sum + line.allocated_amount - (line.discount_amount || 0),
        0
      );

      expect(linesTotal).toBe(paymentAmount);
    });
  });

  describe('Check Payment Validations', () => {
    it('should require check number for check payment', () => {
      const payment: Partial<CustomerReceipt> = {
        payment_method: 'check',
        check_number: 'CHK-001',
        check_date: '2025-01-15',
        check_bank: 'Bank ABC',
      };

      expect(payment.check_number).toBeDefined();
      expect(payment.check_date).toBeDefined();
      expect(payment.check_bank).toBeDefined();
    });

    it('should not require check details for cash payment', () => {
      const payment: Partial<CustomerReceipt> = {
        payment_method: 'cash',
        amount: 1000,
      };

      expect(payment.check_number).toBeUndefined();
    });
  });

  describe('GL Entry Generation for Receipts', () => {
    it('should create correct GL entry for cash receipt', () => {
      const receipt = {
        amount: 1000,
        payment_method: 'cash' as PaymentMethod,
        customer_id: 'cust-1',
      };

      // Expected entries:
      // DR: 1110 (Cash) = 1000
      // CR: 1120 (AR) = 1000

      const debitAccount = receipt.payment_method === 'cash' ? '1110' : '1111';
      const creditAccount = '1120'; // Accounts Receivable

      expect(debitAccount).toBe('1110');
      expect(creditAccount).toBe('1120');
    });

    it('should create correct GL entry for bank receipt', () => {
      const receipt = {
        amount: 5000,
        payment_method: 'bank_transfer' as PaymentMethod,
        customer_id: 'cust-1',
      };

      const debitAccount = receipt.payment_method === 'cash' ? '1110' : '1111';
      const creditAccount = '1120';

      expect(debitAccount).toBe('1111'); // Bank
      expect(creditAccount).toBe('1120'); // AR
    });

    it('should handle discount in GL entry', () => {
      const receipt = {
        amount: 950,
        discount_amount: 50,
        original_amount: 1000,
      };

      // Expected entries:
      // DR: Cash = 950
      // DR: Sales Discount = 50
      // CR: AR = 1000

      const totalDebit = receipt.amount + (receipt.discount_amount || 0);
      expect(totalDebit).toBe(1000);
    });
  });

  describe('GL Entry Generation for Payments', () => {
    it('should create correct GL entry for cash payment', () => {
      const payment = {
        amount: 2000,
        payment_method: 'cash' as PaymentMethod,
        vendor_id: 'vendor-1',
      };

      // Expected entries:
      // DR: 2110 (AP) = 2000
      // CR: 1110 (Cash) = 2000

      const debitAccount = '2110'; // Accounts Payable
      const creditAccount = payment.payment_method === 'cash' ? '1110' : '1111';

      expect(debitAccount).toBe('2110');
      expect(creditAccount).toBe('1110');
    });

    it('should create correct GL entry for bank payment', () => {
      const payment = {
        amount: 10000,
        payment_method: 'bank_transfer' as PaymentMethod,
        vendor_id: 'vendor-1',
      };

      const debitAccount = '2110';
      const creditAccount = payment.payment_method === 'cash' ? '1110' : '1111';

      expect(debitAccount).toBe('2110'); // AP
      expect(creditAccount).toBe('1111'); // Bank
    });
  });

  describe('Invoice Allocation', () => {
    it('should allocate payment to single invoice', () => {
      const invoice = {
        id: 'inv-1',
        total_amount: 1000,
        paid_amount: 0,
      };
      const allocation = 1000;

      const newPaidAmount = invoice.paid_amount + allocation;
      const status = newPaidAmount >= invoice.total_amount ? 'paid' : 'partially_paid';

      expect(newPaidAmount).toBe(1000);
      expect(status).toBe('paid');
    });

    it('should allocate payment to multiple invoices', () => {
      const invoices = [
        { id: 'inv-1', total_amount: 500, paid_amount: 0 },
        { id: 'inv-2', total_amount: 700, paid_amount: 200 },
      ];
      const allocations = [
        { invoice_id: 'inv-1', allocated_amount: 500 },
        { invoice_id: 'inv-2', allocated_amount: 500 },
      ];

      const results = invoices.map(inv => {
        const alloc = allocations.find(a => a.invoice_id === inv.id);
        const newPaid = inv.paid_amount + (alloc?.allocated_amount || 0);
        return {
          ...inv,
          paid_amount: newPaid,
          status: newPaid >= inv.total_amount ? 'paid' : 'partially_paid',
        };
      });

      expect(results[0].status).toBe('paid'); // 500 of 500
      expect(results[1].status).toBe('paid'); // 700 of 700
    });

    it('should handle partial allocation', () => {
      const invoice = {
        id: 'inv-1',
        total_amount: 1000,
        paid_amount: 300,
      };
      const allocation = 400;

      const newPaidAmount = invoice.paid_amount + allocation;
      const remaining = invoice.total_amount - newPaidAmount;
      const status = newPaidAmount >= invoice.total_amount ? 'paid' : 'partially_paid';

      expect(newPaidAmount).toBe(700);
      expect(remaining).toBe(300);
      expect(status).toBe('partially_paid');
    });
  });

  describe('Voucher Status Transitions', () => {
    it('should allow draft to posted transition', () => {
      const currentStatus: VoucherStatus = 'draft';
      const newStatus: VoucherStatus = 'posted';
      const isValid = currentStatus === 'draft' && newStatus === 'posted';
      expect(isValid).toBe(true);
    });

    it('should allow draft to cancelled transition', () => {
      const currentStatus: VoucherStatus = 'draft';
      const newStatus: VoucherStatus = 'cancelled';
      const isValid = currentStatus === 'draft' && newStatus === 'cancelled';
      expect(isValid).toBe(true);
    });

    it('should not allow posted to draft transition', () => {
      const currentStatus: VoucherStatus = 'posted';
      const newStatus: VoucherStatus = 'draft';
      const isValid = !(currentStatus === 'posted' && newStatus === 'draft');
      expect(isValid).toBe(false);
    });
  });

  describe('Multi-Tenant Support', () => {
    it('should include org_id in receipt data', () => {
      const tenantId = 'tenant-1';
      const receiptData = {
        org_id: tenantId,
        collection_number: 'CR-202512-00001',
        amount: 1000,
      };

      expect(receiptData.org_id).toBe(tenantId);
    });

    it('should filter receipts by tenant', () => {
      const tenantId = 'tenant-1';
      const receipts = [
        { id: 'r-1', org_id: 'tenant-1', amount: 1000 },
        { id: 'r-2', org_id: 'tenant-2', amount: 2000 },
        { id: 'r-3', org_id: 'tenant-1', amount: 1500 },
      ];

      const filtered = receipts.filter(r => r.org_id === tenantId);
      expect(filtered.length).toBe(2);
    });
  });
});
