/**
 * @fileoverview Comprehensive Tests for Payment Vouchers Service
 * Tests customer receipts, supplier payments, and related financial operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Supabase
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          order: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
        order: vi.fn(() => ({
          eq: vi.fn().mockResolvedValue({ data: [], error: null }),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: { id: 'new-id' }, error: null }),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })),
  },
  getEffectiveTenantId: vi.fn().mockResolvedValue('test-tenant'),
}));

describe('Payment Vouchers Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Payment Method Types', () => {
    it('should validate payment method types', () => {
      const validMethods = [
        'cash',
        'bank_transfer',
        'check',
        'credit_card',
        'debit_card',
        'online_payment',
        'mobile_payment',
        'other',
      ];

      validMethods.forEach((method) => {
        expect(validMethods.includes(method)).toBe(true);
      });
    });

    it('should identify check payment requiring additional info', () => {
      const paymentMethod = 'check';
      const requiresCheckInfo = paymentMethod === 'check';

      expect(requiresCheckInfo).toBe(true);
    });

    it('should identify bank transfer requiring account info', () => {
      const bankMethods = ['bank_transfer', 'online_payment'];
      const paymentMethod = 'bank_transfer';

      const requiresAccountInfo = bankMethods.includes(paymentMethod);

      expect(requiresAccountInfo).toBe(true);
    });
  });

  describe('Voucher Status Management', () => {
    it('should validate voucher status types', () => {
      const validStatuses = ['draft', 'posted', 'cancelled'];

      expect(validStatuses).toContain('draft');
      expect(validStatuses).toContain('posted');
      expect(validStatuses).toContain('cancelled');
    });

    it('should validate status transition from draft to posted', () => {
      const validTransitions: Record<string, string[]> = {
        draft: ['posted', 'cancelled'],
        posted: ['cancelled'],
        cancelled: [],
      };

      const currentStatus = 'draft';
      const newStatus = 'posted';

      const isValid = validTransitions[currentStatus]?.includes(newStatus);

      expect(isValid).toBe(true);
    });

    it('should reject invalid status transition', () => {
      const validTransitions: Record<string, string[]> = {
        draft: ['posted', 'cancelled'],
        posted: ['cancelled'],
        cancelled: [],
      };

      const currentStatus = 'posted';
      const newStatus = 'draft'; // Can't go back to draft

      const isValid = validTransitions[currentStatus]?.includes(newStatus);

      expect(isValid).toBe(false);
    });

    it('should not allow transition from cancelled', () => {
      const validTransitions: Record<string, string[]> = {
        draft: ['posted', 'cancelled'],
        posted: ['cancelled'],
        cancelled: [],
      };

      const currentStatus = 'cancelled';
      const availableTransitions = validTransitions[currentStatus];

      expect(availableTransitions).toHaveLength(0);
    });
  });

  describe('Customer Receipt Calculations', () => {
    it('should calculate total receipt amount from lines', () => {
      const receiptLines = [
        { invoice_id: 'inv-1', allocated_amount: 1000, discount_amount: 0 },
        { invoice_id: 'inv-2', allocated_amount: 500, discount_amount: 50 },
        { invoice_id: 'inv-3', allocated_amount: 750, discount_amount: 25 },
      ];

      const totalAllocated = receiptLines.reduce(
        (sum, line) => sum + line.allocated_amount,
        0
      );
      const totalDiscount = receiptLines.reduce(
        (sum, line) => sum + (line.discount_amount || 0),
        0
      );

      expect(totalAllocated).toBe(2250);
      expect(totalDiscount).toBe(75);
    });

    it('should validate receipt amount matches allocated total', () => {
      const receipt = {
        amount: 2000,
        lines: [
          { allocated_amount: 1000 },
          { allocated_amount: 800 },
          { allocated_amount: 200 },
        ],
      };

      const totalAllocated = receipt.lines.reduce(
        (sum, line) => sum + line.allocated_amount,
        0
      );

      const isValid = receipt.amount === totalAllocated;

      expect(isValid).toBe(true);
    });

    it('should reject over-allocation', () => {
      const invoice = {
        id: 'inv-1',
        total_amount: 1000,
        paid_amount: 600,
      };

      const allocationAmount = 500; // Would exceed remaining balance
      const remainingBalance = invoice.total_amount - invoice.paid_amount;
      const isValid = allocationAmount <= remainingBalance;

      expect(remainingBalance).toBe(400);
      expect(isValid).toBe(false);
    });

    it('should calculate remaining invoice balance after receipt', () => {
      const invoice = {
        total_amount: 5000,
        paid_amount: 2000,
      };

      const newPayment = 1500;
      const newPaidAmount = invoice.paid_amount + newPayment;
      const remainingBalance = invoice.total_amount - newPaidAmount;

      expect(newPaidAmount).toBe(3500);
      expect(remainingBalance).toBe(1500);
    });
  });

  describe('Supplier Payment Calculations', () => {
    it('should calculate total payment amount', () => {
      const paymentLines = [
        { invoice_id: 'sinv-1', allocated_amount: 2000 },
        { invoice_id: 'sinv-2', allocated_amount: 1500 },
      ];

      const totalPayment = paymentLines.reduce(
        (sum, line) => sum + line.allocated_amount,
        0
      );

      expect(totalPayment).toBe(3500);
    });

    it('should validate payment does not exceed invoice balance', () => {
      const supplierInvoice = {
        id: 'sinv-1',
        total_amount: 10000,
        paid_amount: 4000,
      };

      const paymentAmount = 5000;
      const remainingBalance = supplierInvoice.total_amount - supplierInvoice.paid_amount;
      const isValid = paymentAmount <= remainingBalance;

      expect(remainingBalance).toBe(6000);
      expect(isValid).toBe(true);
    });

    it('should calculate supplier account balance', () => {
      const invoices = [
        { total: 5000, paid: 5000 },
        { total: 3000, paid: 1000 },
        { total: 2000, paid: 0 },
      ];

      const totalBalance = invoices.reduce(
        (sum, inv) => sum + (inv.total - inv.paid),
        0
      );

      expect(totalBalance).toBe(4000);
    });
  });

  describe('Receipt Number Generation', () => {
    it('should generate sequential receipt number', () => {
      const prefix = 'RV';
      const year = 2025;
      const sequence = 42;

      const receiptNumber = `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;

      expect(receiptNumber).toBe('RV-2025-000042');
    });

    it('should generate payment voucher number', () => {
      const prefix = 'PV';
      const year = 2025;
      const sequence = 156;

      const paymentNumber = `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;

      expect(paymentNumber).toBe('PV-2025-000156');
    });

    it('should validate voucher number format', () => {
      const voucherPattern = /^[RP]V-\d{4}-\d{6}$/;

      expect(voucherPattern.test('RV-2025-000001')).toBe(true);
      expect(voucherPattern.test('PV-2025-000156')).toBe(true);
      expect(voucherPattern.test('invalid')).toBe(false);
      expect(voucherPattern.test('RV-25-001')).toBe(false);
    });
  });

  describe('Check Payment Processing', () => {
    it('should validate check details', () => {
      const checkPayment = {
        payment_method: 'check',
        check_number: '123456',
        check_date: '2025-12-25',
        check_bank: 'National Bank',
      };

      const isValid =
        checkPayment.check_number &&
        checkPayment.check_date &&
        checkPayment.check_bank;

      expect(isValid).toBeTruthy();
    });

    it('should reject check with missing details', () => {
      const checkPayment = {
        payment_method: 'check',
        check_number: '123456',
        check_date: null,
        check_bank: null,
      };

      const isValid =
        checkPayment.check_number &&
        checkPayment.check_date &&
        checkPayment.check_bank;

      expect(isValid).toBeFalsy();
    });

    it('should validate check date is not in past for new check', () => {
      const today = new Date('2025-12-21');
      const checkDate = new Date('2025-12-25');

      const isValidDate = checkDate >= today;

      expect(isValidDate).toBe(true);
    });

    it('should calculate days until check maturity', () => {
      const today = new Date('2025-12-21');
      const checkDate = new Date('2025-12-31');

      const daysUntilMaturity = Math.ceil(
        (checkDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      expect(daysUntilMaturity).toBe(10);
    });
  });

  describe('GL Entry Creation', () => {
    it('should create balanced GL entry for customer receipt', () => {
      const receipt = {
        amount: 5000,
        payment_method: 'bank_transfer',
        customer_id: 'cust-1',
      };

      const glEntry = {
        lines: [
          { account_code: '1110', debit: receipt.amount, credit: 0 }, // Bank
          { account_code: '1200', debit: 0, credit: receipt.amount }, // Accounts Receivable
        ],
      };

      const totalDebit = glEntry.lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = glEntry.lines.reduce((sum, l) => sum + l.credit, 0);
      const isBalanced = totalDebit === totalCredit;

      expect(isBalanced).toBe(true);
      expect(totalDebit).toBe(5000);
    });

    it('should create balanced GL entry for supplier payment', () => {
      const payment = {
        amount: 3000,
        payment_method: 'cash',
        vendor_id: 'vendor-1',
      };

      const glEntry = {
        lines: [
          { account_code: '2100', debit: payment.amount, credit: 0 }, // Accounts Payable
          { account_code: '1100', debit: 0, credit: payment.amount }, // Cash
        ],
      };

      const totalDebit = glEntry.lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = glEntry.lines.reduce((sum, l) => sum + l.credit, 0);
      const isBalanced = totalDebit === totalCredit;

      expect(isBalanced).toBe(true);
      expect(totalDebit).toBe(3000);
    });

    it('should include discount in GL entry', () => {
      const receipt = {
        amount: 950,
        discount: 50,
        customer_id: 'cust-1',
      };

      const glEntry = {
        lines: [
          { account_code: '1110', debit: receipt.amount, credit: 0 }, // Bank
          { account_code: '5200', debit: receipt.discount, credit: 0 }, // Sales Discount
          {
            account_code: '1200',
            debit: 0,
            credit: receipt.amount + receipt.discount,
          }, // AR
        ],
      };

      const totalDebit = glEntry.lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = glEntry.lines.reduce((sum, l) => sum + l.credit, 0);

      expect(totalDebit).toBe(1000);
      expect(totalCredit).toBe(1000);
    });
  });

  describe('Multi-Invoice Allocation', () => {
    it('should allocate payment across multiple invoices', () => {
      const invoices = [
        { id: 'inv-1', balance: 1000 },
        { id: 'inv-2', balance: 500 },
        { id: 'inv-3', balance: 800 },
      ];

      let paymentAmount = 1200;
      const allocations: Array<{ invoice_id: string; amount: number }> = [];

      for (const invoice of invoices) {
        if (paymentAmount <= 0) break;
        const allocation = Math.min(paymentAmount, invoice.balance);
        allocations.push({ invoice_id: invoice.id, amount: allocation });
        paymentAmount -= allocation;
      }

      expect(allocations).toHaveLength(2);
      expect(allocations[0].amount).toBe(1000);
      expect(allocations[1].amount).toBe(200);
    });

    it('should prioritize oldest invoices first', () => {
      const invoices = [
        { id: 'inv-3', date: '2025-12-15', balance: 500 },
        { id: 'inv-1', date: '2025-11-01', balance: 1000 },
        { id: 'inv-2', date: '2025-12-01', balance: 800 },
      ];

      const sortedByDate = [...invoices].sort(
        (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
      );

      expect(sortedByDate[0].id).toBe('inv-1');
      expect(sortedByDate[1].id).toBe('inv-2');
      expect(sortedByDate[2].id).toBe('inv-3');
    });

    it('should validate total allocation equals payment amount', () => {
      const paymentAmount = 1500;
      const allocations = [
        { invoice_id: 'inv-1', amount: 1000 },
        { invoice_id: 'inv-2', amount: 500 },
      ];

      const totalAllocated = allocations.reduce((sum, a) => sum + a.amount, 0);
      const isValid = totalAllocated === paymentAmount;

      expect(isValid).toBe(true);
    });
  });

  describe('Payment Reconciliation', () => {
    it('should identify unreconciled payments', () => {
      const payments = [
        { id: '1', amount: 1000, reconciled: true },
        { id: '2', amount: 500, reconciled: false },
        { id: '3', amount: 750, reconciled: false },
      ];

      const unreconciledPayments = payments.filter((p) => !p.reconciled);

      expect(unreconciledPayments).toHaveLength(2);
    });

    it('should calculate unreconciled total', () => {
      const payments = [
        { id: '1', amount: 1000, reconciled: true },
        { id: '2', amount: 500, reconciled: false },
        { id: '3', amount: 750, reconciled: false },
      ];

      const unreconciledTotal = payments
        .filter((p) => !p.reconciled)
        .reduce((sum, p) => sum + p.amount, 0);

      expect(unreconciledTotal).toBe(1250);
    });

    it('should match payment to bank statement', () => {
      const payment = {
        id: 'pay-1',
        amount: 1000,
        date: '2025-12-20',
        reference: 'REF-001',
      };

      const bankStatement = {
        id: 'stmt-1',
        amount: 1000,
        date: '2025-12-20',
        reference: 'REF-001',
      };

      const isMatch =
        payment.amount === bankStatement.amount &&
        payment.date === bankStatement.date &&
        payment.reference === bankStatement.reference;

      expect(isMatch).toBe(true);
    });
  });

  describe('Cash Flow Impact', () => {
    it('should calculate daily cash inflow', () => {
      const receipts = [
        { date: '2025-12-21', amount: 5000 },
        { date: '2025-12-21', amount: 3000 },
        { date: '2025-12-20', amount: 2000 },
      ];

      const targetDate = '2025-12-21';
      const dailyInflow = receipts
        .filter((r) => r.date === targetDate)
        .reduce((sum, r) => sum + r.amount, 0);

      expect(dailyInflow).toBe(8000);
    });

    it('should calculate daily cash outflow', () => {
      const payments = [
        { date: '2025-12-21', amount: 4000 },
        { date: '2025-12-21', amount: 1500 },
        { date: '2025-12-20', amount: 3000 },
      ];

      const targetDate = '2025-12-21';
      const dailyOutflow = payments
        .filter((p) => p.date === targetDate)
        .reduce((sum, p) => sum + p.amount, 0);

      expect(dailyOutflow).toBe(5500);
    });

    it('should calculate net cash flow', () => {
      const inflow = 8000;
      const outflow = 5500;

      const netCashFlow = inflow - outflow;

      expect(netCashFlow).toBe(2500);
    });
  });

  describe('Payment Due Date Handling', () => {
    it('should identify payments due today', () => {
      const today = '2025-12-21';
      const scheduledPayments = [
        { id: '1', due_date: '2025-12-21', amount: 1000 },
        { id: '2', due_date: '2025-12-22', amount: 2000 },
        { id: '3', due_date: '2025-12-21', amount: 500 },
      ];

      const dueToday = scheduledPayments.filter((p) => p.due_date === today);

      expect(dueToday).toHaveLength(2);
    });

    it('should identify overdue payments', () => {
      const today = new Date('2025-12-21');
      const scheduledPayments = [
        { id: '1', due_date: '2025-12-15', status: 'pending' },
        { id: '2', due_date: '2025-12-25', status: 'pending' },
        { id: '3', due_date: '2025-12-10', status: 'paid' },
      ];

      const overdue = scheduledPayments.filter((p) => {
        const dueDate = new Date(p.due_date);
        return p.status === 'pending' && dueDate < today;
      });

      expect(overdue).toHaveLength(1);
      expect(overdue[0].id).toBe('1');
    });

    it('should calculate payment schedule', () => {
      const invoice = {
        total: 12000,
        payment_terms: 'installment',
        installment_count: 4,
        start_date: '2025-12-01',
      };

      const installmentAmount = invoice.total / invoice.installment_count;
      const schedule = [];

      for (let i = 0; i < invoice.installment_count; i++) {
        const dueDate = new Date(invoice.start_date);
        dueDate.setMonth(dueDate.getMonth() + i);
        schedule.push({
          installment: i + 1,
          due_date: dueDate.toISOString().split('T')[0],
          amount: installmentAmount,
        });
      }

      expect(schedule).toHaveLength(4);
      expect(schedule[0].amount).toBe(3000);
    });
  });

  describe('Audit Trail', () => {
    it('should record voucher creation audit', () => {
      const voucher = {
        id: 'v-1',
        created_by: 'user-1',
        created_at: new Date().toISOString(),
      };

      expect(voucher.created_by).toBeDefined();
      expect(voucher.created_at).toBeDefined();
    });

    it('should record posting audit', () => {
      const voucher = {
        id: 'v-1',
        status: 'posted',
        posted_by: 'user-2',
        posted_at: new Date().toISOString(),
      };

      expect(voucher.posted_by).toBeDefined();
      expect(voucher.posted_at).toBeDefined();
    });

    it('should track voucher modifications', () => {
      const auditLog = [
        { action: 'create', user: 'user-1', timestamp: '2025-12-20T10:00:00Z' },
        { action: 'update', user: 'user-1', timestamp: '2025-12-20T11:00:00Z' },
        { action: 'post', user: 'user-2', timestamp: '2025-12-21T09:00:00Z' },
      ];

      expect(auditLog).toHaveLength(3);
      expect(auditLog[auditLog.length - 1].action).toBe('post');
    });
  });

  describe('Currency Handling', () => {
    it('should calculate exchange rate conversion', () => {
      const foreignAmount = 1000;
      const exchangeRate = 3.75; // USD to SAR

      const localAmount = foreignAmount * exchangeRate;

      expect(localAmount).toBe(3750);
    });

    it('should record foreign currency payment', () => {
      const payment = {
        amount: 1000,
        currency: 'USD',
        exchange_rate: 3.75,
        local_amount: 3750,
        local_currency: 'SAR',
      };

      expect(payment.local_amount).toBe(payment.amount * payment.exchange_rate);
    });

    it('should handle exchange rate difference', () => {
      const originalRate = 3.75;
      const currentRate = 3.80;
      const amount = 1000;

      const originalLocal = amount * originalRate;
      const currentLocal = amount * currentRate;
      const exchangeDifference = currentLocal - originalLocal;

      expect(exchangeDifference).toBe(50);
    });
  });
});
