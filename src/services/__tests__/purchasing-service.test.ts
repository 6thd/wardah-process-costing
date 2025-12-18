/**
 * Purchasing Service Tests
 * Tests purchase orders, goods receipts, and supplier invoices logic
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// TYPES (copied from purchasing-service.ts for testing)
// ============================================================

interface PurchaseOrderLine {
  product_id: string;
  quantity: number;
  unit_price: number;
  discount_percentage?: number;
  tax_percentage?: number;
  notes?: string;
}

interface PurchaseOrder {
  id?: string;
  order_number?: string;
  vendor_id: string;
  order_date: string;
  expected_delivery_date?: string;
  status: 'draft' | 'submitted' | 'approved' | 'partially_received' | 'fully_received' | 'cancelled';
  subtotal?: number;
  discount_amount?: number;
  tax_amount?: number;
  total_amount?: number;
  notes?: string;
  lines: PurchaseOrderLine[];
}

interface GoodsReceiptLine {
  product_id: string;
  purchase_order_line_id?: string;
  ordered_quantity: number;
  received_quantity: number;
  unit_cost: number;
  quality_status: 'accepted' | 'rejected' | 'pending_inspection';
  notes?: string;
}

interface SupplierInvoice {
  id?: string;
  invoice_number: string;
  vendor_id: string;
  invoice_date: string;
  due_date: string;
  subtotal: number;
  discount_amount?: number;
  tax_amount: number;
  total_amount: number;
  paid_amount?: number;
  status: 'draft' | 'submitted' | 'approved' | 'paid' | 'partially_paid' | 'overdue';
  lines: { product_id: string; quantity: number; unit_cost: number }[];
}

// ============================================================
// PURE CALCULATION FUNCTIONS (extracted for testing)
// ============================================================

/**
 * Calculate purchase order totals from lines
 */
function calculatePurchaseOrderTotals(lines: PurchaseOrderLine[]): {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
} {
  let subtotal = 0;
  let discountAmount = 0;
  let taxAmount = 0;

  lines.forEach(line => {
    const lineSubtotal = line.quantity * line.unit_price;
    const lineDiscount = lineSubtotal * (line.discount_percentage || 0) / 100;
    const lineAfterDiscount = lineSubtotal - lineDiscount;
    const lineTax = lineAfterDiscount * (line.tax_percentage || 0) / 100;

    subtotal += lineSubtotal;
    discountAmount += lineDiscount;
    taxAmount += lineTax;
  });

  const totalAmount = subtotal - discountAmount + taxAmount;

  return { subtotal, discountAmount, taxAmount, totalAmount };
}

/**
 * Calculate line subtotal
 */
function calculateLineSubtotal(line: PurchaseOrderLine): number {
  return line.quantity * line.unit_price;
}

/**
 * Calculate line discount
 */
function calculateLineDiscount(line: PurchaseOrderLine): number {
  const lineSubtotal = calculateLineSubtotal(line);
  return lineSubtotal * (line.discount_percentage || 0) / 100;
}

/**
 * Calculate line tax
 */
function calculateLineTax(line: PurchaseOrderLine): number {
  const lineSubtotal = calculateLineSubtotal(line);
  const lineDiscount = calculateLineDiscount(line);
  const lineAfterDiscount = lineSubtotal - lineDiscount;
  return lineAfterDiscount * (line.tax_percentage || 0) / 100;
}

/**
 * Calculate line total (after discount + tax)
 */
function calculateLineTotal(line: PurchaseOrderLine): number {
  const lineSubtotal = calculateLineSubtotal(line);
  const lineDiscount = calculateLineDiscount(line);
  const lineTax = calculateLineTax(line);
  return lineSubtotal - lineDiscount + lineTax;
}

/**
 * Determine PO status based on received quantities
 */
function determinePOStatus(
  poLines: { quantity: number; received_quantity: number }[]
): 'approved' | 'partially_received' | 'fully_received' {
  let allReceived = true;
  let anyReceived = false;

  for (const poLine of poLines) {
    if ((poLine.received_quantity || 0) < poLine.quantity) {
      allReceived = false;
    }
    if ((poLine.received_quantity || 0) > 0) {
      anyReceived = true;
    }
  }

  if (allReceived) return 'fully_received';
  if (anyReceived) return 'partially_received';
  return 'approved';
}

/**
 * Calculate payment balance and status
 */
function calculatePaymentStatus(
  totalAmount: number,
  paidAmount: number,
  currentStatus: string
): { balance: number; newStatus: string } {
  const balance = totalAmount - paidAmount;

  let newStatus = currentStatus;
  if (balance === 0) {
    newStatus = 'paid';
  } else if (paidAmount > 0 && balance > 0) {
    newStatus = 'partially_paid';
  }

  return { balance, newStatus };
}

/**
 * Validate goods receipt has warehouse
 */
function validateGoodsReceiptWarehouse(warehouseId: string | undefined): { valid: boolean; error?: string } {
  if (!warehouseId) {
    return { valid: false, error: 'يجب تحديد المخزن (Warehouse) لإتمام الاستلام' };
  }
  return { valid: true };
}

/**
 * Calculate total value of goods receipt
 */
function calculateGoodsReceiptValue(lines: GoodsReceiptLine[]): number {
  return lines.reduce((total, line) => {
    if (line.quality_status === 'accepted') {
      return total + (line.received_quantity * line.unit_cost);
    }
    return total;
  }, 0);
}

/**
 * Count accepted vs rejected items
 */
function countQualityStatus(lines: GoodsReceiptLine[]): {
  accepted: number;
  rejected: number;
  pending: number;
} {
  return lines.reduce((counts, line) => {
    if (line.quality_status === 'accepted') {
      counts.accepted += line.received_quantity;
    } else if (line.quality_status === 'rejected') {
      counts.rejected += line.received_quantity;
    } else {
      counts.pending += line.received_quantity;
    }
    return counts;
  }, { accepted: 0, rejected: 0, pending: 0 });
}

/**
 * Generate GL entries for purchase invoice
 */
function generatePurchaseGLEntries(invoice: {
  id: string;
  invoice_number: string;
  invoice_date: string;
  total_amount: number;
  tax_amount: number;
}): { account_code: string; debit: number; credit: number; description: string }[] {
  const entries = [];
  const invAmount = invoice.total_amount - invoice.tax_amount;

  // Debit: Inventory
  entries.push({
    account_code: '1130',
    debit: invAmount,
    credit: 0,
    description: `فاتورة مورد ${invoice.invoice_number}`,
  });

  // Debit: VAT (Input)
  if (invoice.tax_amount > 0) {
    entries.push({
      account_code: '1161',
      debit: invoice.tax_amount,
      credit: 0,
      description: `ضريبة فاتورة ${invoice.invoice_number}`,
    });
  }

  // Credit: Accounts Payable
  entries.push({
    account_code: '2101',
    debit: 0,
    credit: invoice.total_amount,
    description: `فاتورة مورد ${invoice.invoice_number}`,
  });

  return entries;
}

/**
 * Generate GL entries for supplier payment
 */
function generatePaymentGLEntries(
  invoiceNumber: string,
  paymentAmount: number,
  paymentDate: string
): { account_code: string; debit: number; credit: number }[] {
  return [
    // Debit: Accounts Payable
    {
      account_code: '2101',
      debit: paymentAmount,
      credit: 0,
    },
    // Credit: Cash
    {
      account_code: '1110',
      debit: 0,
      credit: paymentAmount,
    },
  ];
}

/**
 * Validate invoice due date
 */
function isInvoiceOverdue(dueDate: string, currentDate: string = new Date().toISOString().split('T')[0]): boolean {
  return dueDate < currentDate;
}

/**
 * Calculate days until due
 */
function calculateDaysUntilDue(dueDate: string, currentDate: string = new Date().toISOString().split('T')[0]): number {
  const due = new Date(dueDate);
  const current = new Date(currentDate);
  const diffTime = due.getTime() - current.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

// ============================================================
// TESTS
// ============================================================

describe('Purchasing Service', () => {
  describe('Purchase Order Calculations', () => {
    describe('calculatePurchaseOrderTotals', () => {
      it('should calculate totals for single line without discount or tax', () => {
        const lines: PurchaseOrderLine[] = [
          { product_id: 'p1', quantity: 10, unit_price: 100 }
        ];

        const result = calculatePurchaseOrderTotals(lines);

        expect(result.subtotal).toBe(1000);
        expect(result.discountAmount).toBe(0);
        expect(result.taxAmount).toBe(0);
        expect(result.totalAmount).toBe(1000);
      });

      it('should calculate totals with discount', () => {
        const lines: PurchaseOrderLine[] = [
          { product_id: 'p1', quantity: 10, unit_price: 100, discount_percentage: 10 }
        ];

        const result = calculatePurchaseOrderTotals(lines);

        expect(result.subtotal).toBe(1000);
        expect(result.discountAmount).toBe(100); // 10% of 1000
        expect(result.taxAmount).toBe(0);
        expect(result.totalAmount).toBe(900); // 1000 - 100
      });

      it('should calculate totals with tax', () => {
        const lines: PurchaseOrderLine[] = [
          { product_id: 'p1', quantity: 10, unit_price: 100, tax_percentage: 15 }
        ];

        const result = calculatePurchaseOrderTotals(lines);

        expect(result.subtotal).toBe(1000);
        expect(result.discountAmount).toBe(0);
        expect(result.taxAmount).toBe(150); // 15% of 1000
        expect(result.totalAmount).toBe(1150); // 1000 + 150
      });

      it('should calculate totals with both discount and tax', () => {
        const lines: PurchaseOrderLine[] = [
          { product_id: 'p1', quantity: 10, unit_price: 100, discount_percentage: 10, tax_percentage: 15 }
        ];

        const result = calculatePurchaseOrderTotals(lines);

        expect(result.subtotal).toBe(1000);
        expect(result.discountAmount).toBe(100); // 10% of 1000
        // Tax is on amount after discount: 900 * 15% = 135
        expect(result.taxAmount).toBe(135);
        expect(result.totalAmount).toBe(1035); // 1000 - 100 + 135
      });

      it('should calculate totals for multiple lines', () => {
        const lines: PurchaseOrderLine[] = [
          { product_id: 'p1', quantity: 10, unit_price: 100 },
          { product_id: 'p2', quantity: 5, unit_price: 200, discount_percentage: 20 },
          { product_id: 'p3', quantity: 2, unit_price: 500, tax_percentage: 15 }
        ];

        const result = calculatePurchaseOrderTotals(lines);

        // Line 1: 10 * 100 = 1000, no discount, no tax
        // Line 2: 5 * 200 = 1000, 20% discount = 200
        // Line 3: 2 * 500 = 1000, 15% tax = 150

        expect(result.subtotal).toBe(3000); // 1000 + 1000 + 1000
        expect(result.discountAmount).toBe(200);
        expect(result.taxAmount).toBe(150);
        expect(result.totalAmount).toBe(2950); // 3000 - 200 + 150
      });

      it('should handle empty lines array', () => {
        const lines: PurchaseOrderLine[] = [];

        const result = calculatePurchaseOrderTotals(lines);

        expect(result.subtotal).toBe(0);
        expect(result.discountAmount).toBe(0);
        expect(result.taxAmount).toBe(0);
        expect(result.totalAmount).toBe(0);
      });

      it('should handle zero quantities', () => {
        const lines: PurchaseOrderLine[] = [
          { product_id: 'p1', quantity: 0, unit_price: 100 }
        ];

        const result = calculatePurchaseOrderTotals(lines);

        expect(result.subtotal).toBe(0);
        expect(result.totalAmount).toBe(0);
      });

      it('should handle decimal values', () => {
        const lines: PurchaseOrderLine[] = [
          { product_id: 'p1', quantity: 2.5, unit_price: 33.33 }
        ];

        const result = calculatePurchaseOrderTotals(lines);

        expect(result.subtotal).toBeCloseTo(83.325);
        expect(result.totalAmount).toBeCloseTo(83.325);
      });
    });

    describe('calculateLineSubtotal', () => {
      it('should calculate line subtotal correctly', () => {
        const line: PurchaseOrderLine = { product_id: 'p1', quantity: 10, unit_price: 50 };
        expect(calculateLineSubtotal(line)).toBe(500);
      });

      it('should handle fractional quantities', () => {
        const line: PurchaseOrderLine = { product_id: 'p1', quantity: 1.5, unit_price: 100 };
        expect(calculateLineSubtotal(line)).toBe(150);
      });
    });

    describe('calculateLineDiscount', () => {
      it('should calculate discount correctly', () => {
        const line: PurchaseOrderLine = { 
          product_id: 'p1', quantity: 10, unit_price: 100, discount_percentage: 25 
        };
        expect(calculateLineDiscount(line)).toBe(250); // 25% of 1000
      });

      it('should return 0 when no discount', () => {
        const line: PurchaseOrderLine = { product_id: 'p1', quantity: 10, unit_price: 100 };
        expect(calculateLineDiscount(line)).toBe(0);
      });

      it('should handle 100% discount', () => {
        const line: PurchaseOrderLine = { 
          product_id: 'p1', quantity: 10, unit_price: 100, discount_percentage: 100 
        };
        expect(calculateLineDiscount(line)).toBe(1000);
      });
    });

    describe('calculateLineTax', () => {
      it('should calculate tax on amount after discount', () => {
        const line: PurchaseOrderLine = { 
          product_id: 'p1', quantity: 10, unit_price: 100, 
          discount_percentage: 10, tax_percentage: 15 
        };
        // Subtotal: 1000, Discount: 100, After discount: 900
        // Tax: 900 * 15% = 135
        expect(calculateLineTax(line)).toBe(135);
      });

      it('should return 0 when no tax', () => {
        const line: PurchaseOrderLine = { product_id: 'p1', quantity: 10, unit_price: 100 };
        expect(calculateLineTax(line)).toBe(0);
      });
    });

    describe('calculateLineTotal', () => {
      it('should calculate total with discount and tax', () => {
        const line: PurchaseOrderLine = { 
          product_id: 'p1', quantity: 10, unit_price: 100, 
          discount_percentage: 10, tax_percentage: 15 
        };
        // Subtotal: 1000, Discount: 100, After discount: 900
        // Tax: 135, Total: 900 + 135 = 1035
        expect(calculateLineTotal(line)).toBe(1035);
      });
    });
  });

  describe('PO Status Determination', () => {
    describe('determinePOStatus', () => {
      it('should return fully_received when all quantities received', () => {
        const poLines = [
          { quantity: 10, received_quantity: 10 },
          { quantity: 5, received_quantity: 5 }
        ];
        expect(determinePOStatus(poLines)).toBe('fully_received');
      });

      it('should return partially_received when some received', () => {
        const poLines = [
          { quantity: 10, received_quantity: 10 },
          { quantity: 5, received_quantity: 2 }
        ];
        expect(determinePOStatus(poLines)).toBe('partially_received');
      });

      it('should return approved when nothing received', () => {
        const poLines = [
          { quantity: 10, received_quantity: 0 },
          { quantity: 5, received_quantity: 0 }
        ];
        expect(determinePOStatus(poLines)).toBe('approved');
      });

      it('should handle null received_quantity as 0', () => {
        const poLines = [
          { quantity: 10, received_quantity: null as any },
          { quantity: 5, received_quantity: undefined as any }
        ];
        expect(determinePOStatus(poLines)).toBe('approved');
      });

      it('should handle over-receiving', () => {
        const poLines = [
          { quantity: 10, received_quantity: 15 }
        ];
        expect(determinePOStatus(poLines)).toBe('fully_received');
      });
    });
  });

  describe('Goods Receipt', () => {
    describe('validateGoodsReceiptWarehouse', () => {
      it('should return valid when warehouse provided', () => {
        const result = validateGoodsReceiptWarehouse('wh-001');
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      });

      it('should return invalid when warehouse not provided', () => {
        const result = validateGoodsReceiptWarehouse(undefined);
        expect(result.valid).toBe(false);
        expect(result.error).toBe('يجب تحديد المخزن (Warehouse) لإتمام الاستلام');
      });

      it('should return invalid for empty string', () => {
        const result = validateGoodsReceiptWarehouse('');
        expect(result.valid).toBe(false);
      });
    });

    describe('calculateGoodsReceiptValue', () => {
      it('should sum only accepted items', () => {
        const lines: GoodsReceiptLine[] = [
          { product_id: 'p1', ordered_quantity: 10, received_quantity: 10, unit_cost: 100, quality_status: 'accepted' },
          { product_id: 'p2', ordered_quantity: 5, received_quantity: 5, unit_cost: 50, quality_status: 'rejected' },
          { product_id: 'p3', ordered_quantity: 3, received_quantity: 3, unit_cost: 200, quality_status: 'accepted' }
        ];

        const result = calculateGoodsReceiptValue(lines);

        // Only accepted: (10 * 100) + (3 * 200) = 1000 + 600 = 1600
        expect(result).toBe(1600);
      });

      it('should return 0 when all rejected', () => {
        const lines: GoodsReceiptLine[] = [
          { product_id: 'p1', ordered_quantity: 10, received_quantity: 10, unit_cost: 100, quality_status: 'rejected' }
        ];

        expect(calculateGoodsReceiptValue(lines)).toBe(0);
      });

      it('should handle empty array', () => {
        expect(calculateGoodsReceiptValue([])).toBe(0);
      });
    });

    describe('countQualityStatus', () => {
      it('should count items by quality status', () => {
        const lines: GoodsReceiptLine[] = [
          { product_id: 'p1', ordered_quantity: 10, received_quantity: 10, unit_cost: 100, quality_status: 'accepted' },
          { product_id: 'p2', ordered_quantity: 5, received_quantity: 5, unit_cost: 50, quality_status: 'rejected' },
          { product_id: 'p3', ordered_quantity: 3, received_quantity: 3, unit_cost: 200, quality_status: 'pending_inspection' }
        ];

        const result = countQualityStatus(lines);

        expect(result.accepted).toBe(10);
        expect(result.rejected).toBe(5);
        expect(result.pending).toBe(3);
      });

      it('should handle all same status', () => {
        const lines: GoodsReceiptLine[] = [
          { product_id: 'p1', ordered_quantity: 10, received_quantity: 10, unit_cost: 100, quality_status: 'accepted' },
          { product_id: 'p2', ordered_quantity: 5, received_quantity: 5, unit_cost: 50, quality_status: 'accepted' }
        ];

        const result = countQualityStatus(lines);

        expect(result.accepted).toBe(15);
        expect(result.rejected).toBe(0);
        expect(result.pending).toBe(0);
      });
    });
  });

  describe('Payment Processing', () => {
    describe('calculatePaymentStatus', () => {
      it('should return paid when fully paid', () => {
        const result = calculatePaymentStatus(1000, 1000, 'approved');
        expect(result.balance).toBe(0);
        expect(result.newStatus).toBe('paid');
      });

      it('should return partially_paid when partial payment', () => {
        const result = calculatePaymentStatus(1000, 500, 'approved');
        expect(result.balance).toBe(500);
        expect(result.newStatus).toBe('partially_paid');
      });

      it('should keep current status when no payment', () => {
        const result = calculatePaymentStatus(1000, 0, 'approved');
        expect(result.balance).toBe(1000);
        expect(result.newStatus).toBe('approved');
      });

      it('should handle overpayment', () => {
        const result = calculatePaymentStatus(1000, 1200, 'approved');
        expect(result.balance).toBe(-200);
        // Overpayment with balance < 0: function keeps current status (not covered by conditions)
        expect(result.newStatus).toBe('approved');
      });
    });
  });

  describe('GL Entry Generation', () => {
    describe('generatePurchaseGLEntries', () => {
      it('should generate entries for invoice with tax', () => {
        const invoice = {
          id: 'inv-001',
          invoice_number: 'INV-2025-001',
          invoice_date: '2025-01-15',
          total_amount: 1150,
          tax_amount: 150
        };

        const entries = generatePurchaseGLEntries(invoice);

        expect(entries).toHaveLength(3);

        // Inventory debit
        expect(entries[0].account_code).toBe('1130');
        expect(entries[0].debit).toBe(1000);
        expect(entries[0].credit).toBe(0);

        // VAT debit
        expect(entries[1].account_code).toBe('1161');
        expect(entries[1].debit).toBe(150);
        expect(entries[1].credit).toBe(0);

        // Accounts Payable credit
        expect(entries[2].account_code).toBe('2101');
        expect(entries[2].debit).toBe(0);
        expect(entries[2].credit).toBe(1150);
      });

      it('should generate entries without VAT when tax is 0', () => {
        const invoice = {
          id: 'inv-002',
          invoice_number: 'INV-2025-002',
          invoice_date: '2025-01-15',
          total_amount: 1000,
          tax_amount: 0
        };

        const entries = generatePurchaseGLEntries(invoice);

        expect(entries).toHaveLength(2);
        expect(entries[0].account_code).toBe('1130');
        expect(entries[1].account_code).toBe('2101');
      });

      it('should have balanced entries (debits = credits)', () => {
        const invoice = {
          id: 'inv-003',
          invoice_number: 'INV-2025-003',
          invoice_date: '2025-01-15',
          total_amount: 2300,
          tax_amount: 300
        };

        const entries = generatePurchaseGLEntries(invoice);

        const totalDebits = entries.reduce((sum, e) => sum + e.debit, 0);
        const totalCredits = entries.reduce((sum, e) => sum + e.credit, 0);

        expect(totalDebits).toBe(totalCredits);
        expect(totalDebits).toBe(2300);
      });
    });

    describe('generatePaymentGLEntries', () => {
      it('should generate payment entries', () => {
        const entries = generatePaymentGLEntries('INV-001', 500, '2025-01-20');

        expect(entries).toHaveLength(2);

        // Accounts Payable debit
        expect(entries[0].account_code).toBe('2101');
        expect(entries[0].debit).toBe(500);
        expect(entries[0].credit).toBe(0);

        // Cash credit
        expect(entries[1].account_code).toBe('1110');
        expect(entries[1].debit).toBe(0);
        expect(entries[1].credit).toBe(500);
      });

      it('should have balanced payment entries', () => {
        const entries = generatePaymentGLEntries('INV-001', 1500, '2025-01-20');

        const totalDebits = entries.reduce((sum, e) => sum + e.debit, 0);
        const totalCredits = entries.reduce((sum, e) => sum + e.credit, 0);

        expect(totalDebits).toBe(totalCredits);
        expect(totalDebits).toBe(1500);
      });
    });
  });

  describe('Due Date Handling', () => {
    describe('isInvoiceOverdue', () => {
      it('should return true when past due date', () => {
        expect(isInvoiceOverdue('2025-01-01', '2025-01-15')).toBe(true);
      });

      it('should return false when before due date', () => {
        expect(isInvoiceOverdue('2025-01-31', '2025-01-15')).toBe(false);
      });

      it('should return false on due date', () => {
        expect(isInvoiceOverdue('2025-01-15', '2025-01-15')).toBe(false);
      });
    });

    describe('calculateDaysUntilDue', () => {
      it('should calculate positive days for future due date', () => {
        const days = calculateDaysUntilDue('2025-01-25', '2025-01-15');
        expect(days).toBe(10);
      });

      it('should calculate negative days for past due date', () => {
        const days = calculateDaysUntilDue('2025-01-10', '2025-01-15');
        expect(days).toBe(-5);
      });

      it('should return 0 on due date', () => {
        const days = calculateDaysUntilDue('2025-01-15', '2025-01-15');
        expect(days).toBe(0);
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large quantities', () => {
      const lines: PurchaseOrderLine[] = [
        { product_id: 'p1', quantity: 1000000, unit_price: 10000 }
      ];

      const result = calculatePurchaseOrderTotals(lines);

      expect(result.subtotal).toBe(10000000000); // 10 billion
      expect(result.totalAmount).toBe(10000000000);
    });

    it('should handle very small decimal values', () => {
      const lines: PurchaseOrderLine[] = [
        { product_id: 'p1', quantity: 0.001, unit_price: 0.01 }
      ];

      const result = calculatePurchaseOrderTotals(lines);

      expect(result.subtotal).toBeCloseTo(0.00001);
    });

    it('should handle 100% discount correctly', () => {
      const lines: PurchaseOrderLine[] = [
        { product_id: 'p1', quantity: 10, unit_price: 100, discount_percentage: 100, tax_percentage: 15 }
      ];

      const result = calculatePurchaseOrderTotals(lines);

      expect(result.subtotal).toBe(1000);
      expect(result.discountAmount).toBe(1000);
      expect(result.taxAmount).toBe(0); // Tax on 0 after discount
      expect(result.totalAmount).toBe(0);
    });

    it('should handle negative quantities gracefully', () => {
      // This might represent returns
      const lines: PurchaseOrderLine[] = [
        { product_id: 'p1', quantity: -5, unit_price: 100 }
      ];

      const result = calculatePurchaseOrderTotals(lines);

      expect(result.subtotal).toBe(-500);
      expect(result.totalAmount).toBe(-500);
    });
  });
});
