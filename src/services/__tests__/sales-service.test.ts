/**
 * @file sales-service.test.ts
 * @description Unit tests for Sales Service
 *
 * Tests cover:
 * - Invoice calculations (subtotal, tax, discounts)
 * - COGS (Cost of Goods Sold) calculations
 * - Payment processing and status
 * - Delivery status management
 * - GL entry generation
 */

import { describe, it, expect, vi } from 'vitest';

// ===== Types for Testing =====

interface SalesInvoiceLine {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_percentage?: number;
  notes?: string;
}

interface SalesInvoice {
  id?: string;
  invoice_number: string;
  customer_id: string;
  invoice_date: string;
  due_date: string;
  payment_terms?: string;
  delivery_status: 'pending' | 'partially_delivered' | 'fully_delivered';
  payment_status: 'unpaid' | 'partially_paid' | 'paid';
  subtotal: number;
  discount_amount?: number;
  tax_amount: number;
  total_amount: number;
  paid_amount?: number;
  notes?: string;
  lines: SalesInvoiceLine[];
}

interface DeliveryNoteLine {
  product_id: string;
  invoiced_quantity: number;
  delivered_quantity: number;
  unit_price: number;
  unit_cost?: number;
  notes?: string;
}

interface GLEntry {
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description: string;
  reference_type: string;
  reference_id: string;
  transaction_date: string;
}

// ===== Pure Functions for Testing =====

/**
 * Calculate line total (before tax)
 */
function calculateLineTotal(line: SalesInvoiceLine): number {
  const grossAmount = line.quantity * line.unit_price;
  const discountAmount = grossAmount * ((line.discount_percentage || 0) / 100);
  return grossAmount - discountAmount;
}

/**
 * Calculate line tax
 */
function calculateLineTax(line: SalesInvoiceLine): number {
  const netAmount = calculateLineTotal(line);
  return netAmount * ((line.tax_percentage || 0) / 100);
}

/**
 * Calculate invoice subtotal
 */
function calculateSubtotal(lines: SalesInvoiceLine[]): number {
  return lines.reduce((sum, line) => sum + calculateLineTotal(line), 0);
}

/**
 * Calculate total tax
 */
function calculateTotalTax(lines: SalesInvoiceLine[]): number {
  return lines.reduce((sum, line) => sum + calculateLineTax(line), 0);
}

/**
 * Calculate invoice total
 */
function calculateInvoiceTotal(
  subtotal: number,
  discountAmount: number,
  taxAmount: number
): number {
  return subtotal - discountAmount + taxAmount;
}

/**
 * Calculate COGS for a delivery line
 */
function calculateLineCOGS(quantity: number, unitCost: number): number {
  return quantity * unitCost;
}

/**
 * Calculate total COGS for all delivery lines
 */
function calculateTotalCOGS(
  lines: Array<{ delivered_quantity: number; unit_cost: number }>
): number {
  return lines.reduce(
    (sum, line) => sum + calculateLineCOGS(line.delivered_quantity, line.unit_cost),
    0
  );
}

/**
 * Determine delivery status based on delivered quantities
 */
function determineDeliveryStatus(
  invoiceLines: Array<{ quantity: number; delivered_quantity: number }>
): 'pending' | 'partially_delivered' | 'fully_delivered' {
  let allDelivered = true;
  let anyDelivered = false;

  for (const line of invoiceLines) {
    if ((line.delivered_quantity || 0) < line.quantity) {
      allDelivered = false;
    }
    if ((line.delivered_quantity || 0) > 0) {
      anyDelivered = true;
    }
  }

  if (allDelivered) return 'fully_delivered';
  if (anyDelivered) return 'partially_delivered';
  return 'pending';
}

/**
 * Determine payment status based on amounts
 */
function determinePaymentStatus(
  totalAmount: number,
  paidAmount: number
): 'unpaid' | 'partially_paid' | 'paid' {
  if (paidAmount <= 0) return 'unpaid';
  if (paidAmount >= totalAmount) return 'paid';
  return 'partially_paid';
}

/**
 * Calculate remaining amount to pay
 */
function calculateRemainingAmount(totalAmount: number, paidAmount: number): number {
  return Math.max(0, totalAmount - paidAmount);
}

/**
 * Generate sales GL entries
 */
function generateSalesGLEntries(invoice: {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  tax_amount: number;
}): GLEntry[] {
  const entries: GLEntry[] = [];
  const revenueAmount = invoice.total_amount - invoice.tax_amount;

  // Debit: Accounts Receivable
  entries.push({
    account_code: '1120',
    account_name: 'حسابات مدينة - عملاء',
    debit: invoice.total_amount,
    credit: 0,
    description: `فاتورة مبيعات ${invoice.invoice_number}`,
    reference_type: 'SALES_INVOICE',
    reference_id: invoice.id,
    transaction_date: invoice.invoice_date,
  });

  // Credit: Sales Revenue
  entries.push({
    account_code: '4001',
    account_name: 'إيرادات المبيعات',
    debit: 0,
    credit: revenueAmount,
    description: `فاتورة مبيعات ${invoice.invoice_number}`,
    reference_type: 'SALES_INVOICE',
    reference_id: invoice.id,
    transaction_date: invoice.invoice_date,
  });

  // Credit: VAT Output (if applicable)
  if (invoice.tax_amount > 0) {
    entries.push({
      account_code: '2162',
      account_name: 'ضريبة القيمة المضافة - مخرجات',
      debit: 0,
      credit: invoice.tax_amount,
      description: `ضريبة فاتورة ${invoice.invoice_number}`,
      reference_type: 'SALES_INVOICE',
      reference_id: invoice.id,
      transaction_date: invoice.invoice_date,
    });
  }

  return entries;
}

/**
 * Generate COGS GL entries
 */
function generateCOGSGLEntries(delivery: {
  id: string;
  delivery_number?: string;
  delivery_date: string;
  totalCOGS: number;
}): GLEntry[] {
  const reference = delivery.delivery_number || delivery.id;

  return [
    // Debit: COGS
    {
      account_code: '5001',
      account_name: 'تكلفة البضاعة المباعة',
      debit: delivery.totalCOGS,
      credit: 0,
      description: `تكلفة بضاعة مباعة - ${reference}`,
      reference_type: 'DELIVERY_NOTE',
      reference_id: delivery.id,
      transaction_date: delivery.delivery_date,
    },
    // Credit: Inventory
    {
      account_code: '1130',
      account_name: 'المخزون',
      debit: 0,
      credit: delivery.totalCOGS,
      description: `تكلفة بضاعة مباعة - ${reference}`,
      reference_type: 'DELIVERY_NOTE',
      reference_id: delivery.id,
      transaction_date: delivery.delivery_date,
    },
  ];
}

/**
 * Generate payment receipt GL entries
 */
function generatePaymentGLEntries(payment: {
  id: string;
  invoice_id: string;
  payment_date: string;
  amount: number;
  payment_method: 'cash' | 'bank' | 'check';
}): GLEntry[] {
  const accountCode = payment.payment_method === 'cash' ? '1101' : '1102';
  const accountName = payment.payment_method === 'cash' ? 'الصندوق' : 'البنك';

  return [
    // Debit: Cash/Bank
    {
      account_code: accountCode,
      account_name: accountName,
      debit: payment.amount,
      credit: 0,
      description: `تحصيل فاتورة ${payment.invoice_id}`,
      reference_type: 'PAYMENT_RECEIPT',
      reference_id: payment.id,
      transaction_date: payment.payment_date,
    },
    // Credit: Accounts Receivable
    {
      account_code: '1120',
      account_name: 'حسابات مدينة - عملاء',
      debit: 0,
      credit: payment.amount,
      description: `تحصيل فاتورة ${payment.invoice_id}`,
      reference_type: 'PAYMENT_RECEIPT',
      reference_id: payment.id,
      transaction_date: payment.payment_date,
    },
  ];
}

/**
 * Validate invoice balance
 */
function validateInvoiceBalance(entries: GLEntry[]): boolean {
  const totalDebit = entries.reduce((sum, e) => sum + e.debit, 0);
  const totalCredit = entries.reduce((sum, e) => sum + e.credit, 0);
  return Math.abs(totalDebit - totalCredit) < 0.01;
}

/**
 * Calculate gross profit
 */
function calculateGrossProfit(salesAmount: number, cogsAmount: number): number {
  return salesAmount - cogsAmount;
}

/**
 * Calculate gross profit margin
 */
function calculateGrossProfitMargin(salesAmount: number, cogsAmount: number): number {
  if (salesAmount <= 0) return 0;
  return ((salesAmount - cogsAmount) / salesAmount) * 100;
}

// ===== Test Suites =====

describe('Sales Service - Invoice Calculations', () => {
  describe('calculateLineTotal', () => {
    it('should calculate line total without discount', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 10,
        unit_price: 100,
      };

      const total = calculateLineTotal(line);

      expect(total).toBe(1000);
    });

    it('should apply discount correctly', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 10,
        unit_price: 100,
        discount_percentage: 10,
      };

      const total = calculateLineTotal(line);

      expect(total).toBe(900);
    });

    it('should handle zero quantity', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 0,
        unit_price: 100,
      };

      const total = calculateLineTotal(line);

      expect(total).toBe(0);
    });

    it('should handle 100% discount', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 10,
        unit_price: 100,
        discount_percentage: 100,
      };

      const total = calculateLineTotal(line);

      expect(total).toBe(0);
    });
  });

  describe('calculateLineTax', () => {
    it('should calculate 15% VAT correctly', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 10,
        unit_price: 100,
        tax_percentage: 15,
      };

      const tax = calculateLineTax(line);

      expect(tax).toBe(150);
    });

    it('should calculate tax after discount', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 10,
        unit_price: 100,
        discount_percentage: 10,
        tax_percentage: 15,
      };

      const tax = calculateLineTax(line);

      expect(tax).toBe(135); // 900 * 15%
    });

    it('should handle zero tax', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 10,
        unit_price: 100,
        tax_percentage: 0,
      };

      const tax = calculateLineTax(line);

      expect(tax).toBe(0);
    });
  });

  describe('calculateSubtotal', () => {
    it('should calculate subtotal for multiple lines', () => {
      const lines: SalesInvoiceLine[] = [
        { product_id: 'P001', quantity: 5, unit_price: 100 },
        { product_id: 'P002', quantity: 3, unit_price: 200 },
        { product_id: 'P003', quantity: 2, unit_price: 50 },
      ];

      const subtotal = calculateSubtotal(lines);

      expect(subtotal).toBe(1200); // 500 + 600 + 100
    });

    it('should handle empty lines', () => {
      const subtotal = calculateSubtotal([]);

      expect(subtotal).toBe(0);
    });

    it('should apply discounts per line', () => {
      const lines: SalesInvoiceLine[] = [
        { product_id: 'P001', quantity: 10, unit_price: 100, discount_percentage: 10 },
        { product_id: 'P002', quantity: 10, unit_price: 100 },
      ];

      const subtotal = calculateSubtotal(lines);

      expect(subtotal).toBe(1900); // 900 + 1000
    });
  });

  describe('calculateInvoiceTotal', () => {
    it('should calculate total correctly', () => {
      const total = calculateInvoiceTotal(1000, 50, 142.5);

      expect(total).toBe(1092.5);
    });

    it('should handle zero discount', () => {
      const total = calculateInvoiceTotal(1000, 0, 150);

      expect(total).toBe(1150);
    });

    it('should handle zero tax', () => {
      const total = calculateInvoiceTotal(1000, 100, 0);

      expect(total).toBe(900);
    });
  });
});

describe('Sales Service - COGS Calculations', () => {
  describe('calculateLineCOGS', () => {
    it('should calculate line COGS correctly', () => {
      const cogs = calculateLineCOGS(10, 50);

      expect(cogs).toBe(500);
    });

    it('should handle zero quantity', () => {
      const cogs = calculateLineCOGS(0, 50);

      expect(cogs).toBe(0);
    });

    it('should handle decimal costs', () => {
      const cogs = calculateLineCOGS(10, 49.99);

      expect(cogs).toBeCloseTo(499.9, 2);
    });
  });

  describe('calculateTotalCOGS', () => {
    it('should calculate total COGS for multiple lines', () => {
      const lines = [
        { delivered_quantity: 10, unit_cost: 50 },
        { delivered_quantity: 5, unit_cost: 100 },
        { delivered_quantity: 20, unit_cost: 25 },
      ];

      const totalCOGS = calculateTotalCOGS(lines);

      expect(totalCOGS).toBe(1500); // 500 + 500 + 500
    });

    it('should handle empty lines', () => {
      const totalCOGS = calculateTotalCOGS([]);

      expect(totalCOGS).toBe(0);
    });
  });

  describe('calculateGrossProfit', () => {
    it('should calculate positive profit', () => {
      const profit = calculateGrossProfit(10000, 6000);

      expect(profit).toBe(4000);
    });

    it('should calculate negative profit (loss)', () => {
      const profit = calculateGrossProfit(10000, 12000);

      expect(profit).toBe(-2000);
    });
  });

  describe('calculateGrossProfitMargin', () => {
    it('should calculate margin correctly', () => {
      const margin = calculateGrossProfitMargin(10000, 6000);

      expect(margin).toBe(40);
    });

    it('should handle zero sales', () => {
      const margin = calculateGrossProfitMargin(0, 0);

      expect(margin).toBe(0);
    });

    it('should handle 100% margin (no cost)', () => {
      const margin = calculateGrossProfitMargin(10000, 0);

      expect(margin).toBe(100);
    });
  });
});

describe('Sales Service - Status Management', () => {
  describe('determineDeliveryStatus', () => {
    it('should return pending when nothing delivered', () => {
      const lines = [
        { quantity: 10, delivered_quantity: 0 },
        { quantity: 20, delivered_quantity: 0 },
      ];

      const status = determineDeliveryStatus(lines);

      expect(status).toBe('pending');
    });

    it('should return partially_delivered when some delivered', () => {
      const lines = [
        { quantity: 10, delivered_quantity: 10 },
        { quantity: 20, delivered_quantity: 5 },
      ];

      const status = determineDeliveryStatus(lines);

      expect(status).toBe('partially_delivered');
    });

    it('should return fully_delivered when all delivered', () => {
      const lines = [
        { quantity: 10, delivered_quantity: 10 },
        { quantity: 20, delivered_quantity: 20 },
      ];

      const status = determineDeliveryStatus(lines);

      expect(status).toBe('fully_delivered');
    });

    it('should handle over-delivery', () => {
      const lines = [
        { quantity: 10, delivered_quantity: 15 },
        { quantity: 20, delivered_quantity: 25 },
      ];

      const status = determineDeliveryStatus(lines);

      expect(status).toBe('fully_delivered');
    });
  });

  describe('determinePaymentStatus', () => {
    it('should return unpaid when nothing paid', () => {
      const status = determinePaymentStatus(1000, 0);

      expect(status).toBe('unpaid');
    });

    it('should return partially_paid when some paid', () => {
      const status = determinePaymentStatus(1000, 500);

      expect(status).toBe('partially_paid');
    });

    it('should return paid when fully paid', () => {
      const status = determinePaymentStatus(1000, 1000);

      expect(status).toBe('paid');
    });

    it('should return paid when overpaid', () => {
      const status = determinePaymentStatus(1000, 1200);

      expect(status).toBe('paid');
    });

    it('should return unpaid for negative paid amount', () => {
      const status = determinePaymentStatus(1000, -100);

      expect(status).toBe('unpaid');
    });
  });

  describe('calculateRemainingAmount', () => {
    it('should calculate remaining correctly', () => {
      const remaining = calculateRemainingAmount(1000, 600);

      expect(remaining).toBe(400);
    });

    it('should return zero when fully paid', () => {
      const remaining = calculateRemainingAmount(1000, 1000);

      expect(remaining).toBe(0);
    });

    it('should return zero when overpaid', () => {
      const remaining = calculateRemainingAmount(1000, 1500);

      expect(remaining).toBe(0);
    });
  });
});

describe('Sales Service - GL Entry Generation', () => {
  describe('generateSalesGLEntries', () => {
    it('should generate balanced entries', () => {
      const invoice = {
        id: 'INV-001',
        invoice_number: 'INV-2024-001',
        invoice_date: '2024-01-15',
        total_amount: 11500,
        tax_amount: 1500,
      };

      const entries = generateSalesGLEntries(invoice);

      expect(entries).toHaveLength(3);
      expect(validateInvoiceBalance(entries)).toBe(true);
    });

    it('should have correct account codes', () => {
      const invoice = {
        id: 'INV-001',
        invoice_number: 'INV-2024-001',
        invoice_date: '2024-01-15',
        total_amount: 1150,
        tax_amount: 150,
      };

      const entries = generateSalesGLEntries(invoice);

      expect(entries[0].account_code).toBe('1120'); // AR
      expect(entries[1].account_code).toBe('4001'); // Sales
      expect(entries[2].account_code).toBe('2162'); // VAT
    });

    it('should skip VAT entry when tax is zero', () => {
      const invoice = {
        id: 'INV-001',
        invoice_number: 'INV-2024-001',
        invoice_date: '2024-01-15',
        total_amount: 1000,
        tax_amount: 0,
      };

      const entries = generateSalesGLEntries(invoice);

      expect(entries).toHaveLength(2);
      expect(validateInvoiceBalance(entries)).toBe(true);
    });
  });

  describe('generateCOGSGLEntries', () => {
    it('should generate balanced COGS entries', () => {
      const delivery = {
        id: 'DN-001',
        delivery_number: 'DN-2024-001',
        delivery_date: '2024-01-15',
        totalCOGS: 5000,
      };

      const entries = generateCOGSGLEntries(delivery);

      expect(entries).toHaveLength(2);
      expect(validateInvoiceBalance(entries)).toBe(true);
    });

    it('should debit COGS and credit Inventory', () => {
      const delivery = {
        id: 'DN-001',
        delivery_date: '2024-01-15',
        totalCOGS: 5000,
      };

      const entries = generateCOGSGLEntries(delivery);

      expect(entries[0].account_code).toBe('5001'); // COGS
      expect(entries[0].debit).toBe(5000);
      expect(entries[1].account_code).toBe('1130'); // Inventory
      expect(entries[1].credit).toBe(5000);
    });
  });

  describe('generatePaymentGLEntries', () => {
    it('should generate entries for cash payment', () => {
      const payment = {
        id: 'PAY-001',
        invoice_id: 'INV-001',
        payment_date: '2024-01-20',
        amount: 5000,
        payment_method: 'cash' as const,
      };

      const entries = generatePaymentGLEntries(payment);

      expect(entries).toHaveLength(2);
      expect(entries[0].account_code).toBe('1101'); // Cash
      expect(validateInvoiceBalance(entries)).toBe(true);
    });

    it('should generate entries for bank payment', () => {
      const payment = {
        id: 'PAY-001',
        invoice_id: 'INV-001',
        payment_date: '2024-01-20',
        amount: 5000,
        payment_method: 'bank' as const,
      };

      const entries = generatePaymentGLEntries(payment);

      expect(entries[0].account_code).toBe('1102'); // Bank
    });
  });

  describe('validateInvoiceBalance', () => {
    it('should validate balanced entries', () => {
      const entries: GLEntry[] = [
        { account_code: '1120', account_name: 'AR', debit: 1150, credit: 0, description: '', reference_type: '', reference_id: '', transaction_date: '' },
        { account_code: '4001', account_name: 'Sales', debit: 0, credit: 1000, description: '', reference_type: '', reference_id: '', transaction_date: '' },
        { account_code: '2162', account_name: 'VAT', debit: 0, credit: 150, description: '', reference_type: '', reference_id: '', transaction_date: '' },
      ];

      expect(validateInvoiceBalance(entries)).toBe(true);
    });

    it('should reject unbalanced entries', () => {
      const entries: GLEntry[] = [
        { account_code: '1120', account_name: 'AR', debit: 1150, credit: 0, description: '', reference_type: '', reference_id: '', transaction_date: '' },
        { account_code: '4001', account_name: 'Sales', debit: 0, credit: 900, description: '', reference_type: '', reference_id: '', transaction_date: '' },
      ];

      expect(validateInvoiceBalance(entries)).toBe(false);
    });

    it('should handle tolerance for small differences', () => {
      const entries: GLEntry[] = [
        { account_code: '1120', account_name: 'AR', debit: 1150.005, credit: 0, description: '', reference_type: '', reference_id: '', transaction_date: '' },
        { account_code: '4001', account_name: 'Sales', debit: 0, credit: 1150, description: '', reference_type: '', reference_id: '', transaction_date: '' },
      ];

      expect(validateInvoiceBalance(entries)).toBe(true);
    });
  });
});

describe('Sales Service - Edge Cases', () => {
  describe('Decimal Precision', () => {
    it('should handle fractional quantities', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 2.5,
        unit_price: 99.99,
      };

      const total = calculateLineTotal(line);

      expect(total).toBeCloseTo(249.975, 2);
    });

    it('should handle many decimal places in tax', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 3,
        unit_price: 33.33,
        tax_percentage: 15,
      };

      const tax = calculateLineTax(line);

      expect(tax).toBeCloseTo(14.9985, 2);
    });
  });

  describe('Large Numbers', () => {
    it('should handle large invoice amounts', () => {
      const lines: SalesInvoiceLine[] = [
        { product_id: 'P001', quantity: 10000, unit_price: 9999.99 },
      ];

      const subtotal = calculateSubtotal(lines);

      expect(subtotal).toBe(99999900);
    });

    it('should handle large COGS', () => {
      const lines = [
        { delivered_quantity: 10000, unit_cost: 5000 },
      ];

      const cogs = calculateTotalCOGS(lines);

      expect(cogs).toBe(50000000);
    });
  });

  describe('Zero Values', () => {
    it('should handle zero price', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 10,
        unit_price: 0,
      };

      expect(calculateLineTotal(line)).toBe(0);
      expect(calculateLineTax(line)).toBe(0);
    });

    it('should handle free items', () => {
      const line: SalesInvoiceLine = {
        product_id: 'P001',
        quantity: 10,
        unit_price: 100,
        discount_percentage: 100,
      };

      expect(calculateLineTotal(line)).toBe(0);
    });
  });
});
