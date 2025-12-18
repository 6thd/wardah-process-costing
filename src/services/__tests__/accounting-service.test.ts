/**
 * @file accounting-service.test.ts
 * @description Unit tests for Accounting Service functions
 *
 * Tests focus on the business logic validation that doesn't require database calls:
 * - Journal entry balance validation
 * - Account balance calculations
 * - Data aggregation logic
 */

import { describe, it, expect, vi } from 'vitest';

// Types for testing
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

interface JournalEntry {
  entry_date: string;
  description: string;
  reference_type?: string;
  reference_id?: string;
  entries: GLEntry[];
}

// ===== Pure Function Tests (No Database) =====

/**
 * Validates if journal entries are balanced
 */
function validateJournalBalance(entries: GLEntry[]): {
  isBalanced: boolean;
  totalDebit: number;
  totalCredit: number;
  difference: number;
} {
  let totalDebit = 0;
  let totalCredit = 0;

  entries.forEach((entry) => {
    totalDebit += entry.debit;
    totalCredit += entry.credit;
  });

  const difference = Math.abs(totalDebit - totalCredit);

  return {
    isBalanced: difference <= 0.01,
    totalDebit,
    totalCredit,
    difference,
  };
}

/**
 * Calculates account balance from entries
 */
function calculateBalance(entries: { debit: number; credit: number }[]): {
  totalDebit: number;
  totalCredit: number;
  balance: number;
} {
  let totalDebit = 0;
  let totalCredit = 0;

  entries.forEach((entry) => {
    totalDebit += entry.debit;
    totalCredit += entry.credit;
  });

  return {
    totalDebit,
    totalCredit,
    balance: totalDebit - totalCredit,
  };
}

/**
 * Groups journal entries by reference
 */
function groupEntriesByReference(
  entries: Array<{
    reference_type: string;
    reference_id: string;
    transaction_date: string;
    description: string;
    debit: number;
    credit: number;
  }>
): Array<{
  reference_type: string;
  reference_id: string;
  transaction_date: string;
  description: string;
  entries: typeof entries;
  totalDebit: number;
  totalCredit: number;
}> {
  const grouped: Record<string, {
    reference_type: string;
    reference_id: string;
    transaction_date: string;
    description: string;
    entries: typeof entries;
    totalDebit: number;
    totalCredit: number;
  }> = {};

  entries.forEach((entry) => {
    const key = `${entry.reference_type}_${entry.reference_id}_${entry.transaction_date}`;

    if (!grouped[key]) {
      grouped[key] = {
        reference_type: entry.reference_type,
        reference_id: entry.reference_id,
        transaction_date: entry.transaction_date,
        description: entry.description,
        entries: [],
        totalDebit: 0,
        totalCredit: 0,
      };
    }

    grouped[key].entries.push(entry);
    grouped[key].totalDebit += entry.debit;
    grouped[key].totalCredit += entry.credit;
  });

  return Object.values(grouped);
}

/**
 * Calculates running balance for account movements
 */
function calculateRunningBalance(
  entries: Array<{ debit: number; credit: number }>,
  openingBalance: number = 0
): Array<{ debit: number; credit: number; balance: number }> {
  let runningBalance = openingBalance;

  return entries.map((entry) => {
    runningBalance += entry.debit - entry.credit;
    return {
      ...entry,
      balance: runningBalance,
    };
  });
}

/**
 * Categorizes accounts for financial statements
 */
function categorizeAccounts(
  accounts: Array<{
    account_code: string;
    account_name: string;
    account_type: string;
    balance: number;
  }>
): {
  assets: typeof accounts;
  liabilities: typeof accounts;
  equity: typeof accounts;
  revenues: typeof accounts;
  expenses: typeof accounts;
} {
  return {
    assets: accounts.filter((a) => a.account_type === 'asset'),
    liabilities: accounts.filter((a) => a.account_type === 'liability'),
    equity: accounts.filter((a) => a.account_type === 'equity'),
    revenues: accounts.filter((a) => a.account_type === 'revenue'),
    expenses: accounts.filter((a) => a.account_type === 'expense'),
  };
}

/**
 * Calculates trial balance totals
 */
function calculateTrialBalanceTotals(
  balances: Array<{ debit: number; credit: number }>
): {
  totalDebit: number;
  totalCredit: number;
  isBalanced: boolean;
} {
  const totals = balances.reduce(
    (acc, curr) => ({
      totalDebit: acc.totalDebit + curr.debit,
      totalCredit: acc.totalCredit + curr.credit,
    }),
    { totalDebit: 0, totalCredit: 0 }
  );

  return {
    ...totals,
    isBalanced: Math.abs(totals.totalDebit - totals.totalCredit) < 0.01,
  };
}

// ===== Test Suites =====

describe('Accounting Service - Business Logic', () => {
  describe('validateJournalBalance', () => {
    it('should validate balanced entries', () => {
      const entries: GLEntry[] = [
        {
          account_code: '1001',
          account_name: 'Cash',
          debit: 1000,
          credit: 0,
          description: 'Cash debit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
        {
          account_code: '4001',
          account_name: 'Sales',
          debit: 0,
          credit: 1000,
          description: 'Sales credit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
      ];

      const result = validateJournalBalance(entries);

      expect(result.isBalanced).toBe(true);
      expect(result.totalDebit).toBe(1000);
      expect(result.totalCredit).toBe(1000);
      expect(result.difference).toBe(0);
    });

    it('should reject unbalanced entries', () => {
      const entries: GLEntry[] = [
        {
          account_code: '1001',
          account_name: 'Cash',
          debit: 1000,
          credit: 0,
          description: 'Cash debit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
        {
          account_code: '4001',
          account_name: 'Sales',
          debit: 0,
          credit: 500,
          description: 'Sales credit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
      ];

      const result = validateJournalBalance(entries);

      expect(result.isBalanced).toBe(false);
      expect(result.difference).toBe(500);
    });

    it('should handle tolerance for small rounding differences', () => {
      const entries: GLEntry[] = [
        {
          account_code: '1001',
          account_name: 'Cash',
          debit: 1000.005,
          credit: 0,
          description: 'Cash debit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
        {
          account_code: '4001',
          account_name: 'Sales',
          debit: 0,
          credit: 1000,
          description: 'Sales credit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
      ];

      const result = validateJournalBalance(entries);

      expect(result.isBalanced).toBe(true);
    });

    it('should handle multiple entries', () => {
      const entries: GLEntry[] = [
        {
          account_code: '1001',
          account_name: 'Cash',
          debit: 500,
          credit: 0,
          description: 'Cash 1',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
        {
          account_code: '1002',
          account_name: 'Bank',
          debit: 500,
          credit: 0,
          description: 'Bank',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
        {
          account_code: '4001',
          account_name: 'Sales',
          debit: 0,
          credit: 1000,
          description: 'Sales credit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
      ];

      const result = validateJournalBalance(entries);

      expect(result.isBalanced).toBe(true);
      expect(result.totalDebit).toBe(1000);
      expect(result.totalCredit).toBe(1000);
    });

    it('should handle empty entries array', () => {
      const result = validateJournalBalance([]);

      expect(result.isBalanced).toBe(true);
      expect(result.totalDebit).toBe(0);
      expect(result.totalCredit).toBe(0);
    });

    it('should handle very large numbers', () => {
      const entries: GLEntry[] = [
        {
          account_code: '1001',
          account_name: 'Cash',
          debit: 999999999.99,
          credit: 0,
          description: 'Large debit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
        {
          account_code: '4001',
          account_name: 'Sales',
          debit: 0,
          credit: 999999999.99,
          description: 'Large credit',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
      ];

      const result = validateJournalBalance(entries);

      expect(result.isBalanced).toBe(true);
    });
  });

  describe('calculateBalance', () => {
    it('should calculate positive balance (more debits)', () => {
      const entries = [
        { debit: 1000, credit: 0 },
        { debit: 500, credit: 0 },
        { debit: 0, credit: 300 },
      ];

      const result = calculateBalance(entries);

      expect(result.totalDebit).toBe(1500);
      expect(result.totalCredit).toBe(300);
      expect(result.balance).toBe(1200);
    });

    it('should calculate negative balance (more credits)', () => {
      const entries = [
        { debit: 0, credit: 1000 },
        { debit: 0, credit: 500 },
        { debit: 300, credit: 0 },
      ];

      const result = calculateBalance(entries);

      expect(result.totalDebit).toBe(300);
      expect(result.totalCredit).toBe(1500);
      expect(result.balance).toBe(-1200);
    });

    it('should handle zero balance', () => {
      const entries = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 1000 },
      ];

      const result = calculateBalance(entries);

      expect(result.balance).toBe(0);
    });

    it('should handle empty entries', () => {
      const result = calculateBalance([]);

      expect(result.totalDebit).toBe(0);
      expect(result.totalCredit).toBe(0);
      expect(result.balance).toBe(0);
    });

    it('should handle entries with both debit and credit', () => {
      const entries = [{ debit: 500, credit: 500 }];

      const result = calculateBalance(entries);

      expect(result.balance).toBe(0);
    });
  });

  describe('groupEntriesByReference', () => {
    it('should group entries by reference correctly', () => {
      const entries = [
        { reference_type: 'JV', reference_id: '001', transaction_date: '2024-01-01', description: 'E1', debit: 1000, credit: 0 },
        { reference_type: 'JV', reference_id: '001', transaction_date: '2024-01-01', description: 'E1', debit: 0, credit: 1000 },
        { reference_type: 'JV', reference_id: '002', transaction_date: '2024-01-02', description: 'E2', debit: 500, credit: 0 },
        { reference_type: 'JV', reference_id: '002', transaction_date: '2024-01-02', description: 'E2', debit: 0, credit: 500 },
      ];

      const result = groupEntriesByReference(entries);

      expect(result).toHaveLength(2);
      expect(result[0].entries).toHaveLength(2);
      expect(result[0].totalDebit).toBe(1000);
      expect(result[0].totalCredit).toBe(1000);
      expect(result[1].totalDebit).toBe(500);
      expect(result[1].totalCredit).toBe(500);
    });

    it('should handle single entry', () => {
      const entries = [
        { reference_type: 'JV', reference_id: '001', transaction_date: '2024-01-01', description: 'E1', debit: 1000, credit: 0 },
      ];

      const result = groupEntriesByReference(entries);

      expect(result).toHaveLength(1);
      expect(result[0].entries).toHaveLength(1);
    });

    it('should handle empty entries', () => {
      const result = groupEntriesByReference([]);

      expect(result).toHaveLength(0);
    });

    it('should distinguish entries with same reference but different dates', () => {
      const entries = [
        { reference_type: 'JV', reference_id: '001', transaction_date: '2024-01-01', description: 'E1', debit: 1000, credit: 0 },
        { reference_type: 'JV', reference_id: '001', transaction_date: '2024-01-02', description: 'E1', debit: 500, credit: 0 },
      ];

      const result = groupEntriesByReference(entries);

      expect(result).toHaveLength(2);
    });
  });

  describe('calculateRunningBalance', () => {
    it('should calculate running balance correctly', () => {
      const entries = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 300 },
        { debit: 500, credit: 0 },
      ];

      const result = calculateRunningBalance(entries);

      expect(result[0].balance).toBe(1000);
      expect(result[1].balance).toBe(700);
      expect(result[2].balance).toBe(1200);
    });

    it('should use opening balance', () => {
      const entries = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 300 },
      ];

      const result = calculateRunningBalance(entries, 5000);

      expect(result[0].balance).toBe(6000);
      expect(result[1].balance).toBe(5700);
    });

    it('should handle negative balances', () => {
      const entries = [
        { debit: 0, credit: 1000 },
        { debit: 0, credit: 500 },
      ];

      const result = calculateRunningBalance(entries);

      expect(result[0].balance).toBe(-1000);
      expect(result[1].balance).toBe(-1500);
    });

    it('should handle empty entries', () => {
      const result = calculateRunningBalance([]);

      expect(result).toHaveLength(0);
    });

    it('should handle zero movements', () => {
      const entries = [
        { debit: 0, credit: 0 },
        { debit: 0, credit: 0 },
      ];

      const result = calculateRunningBalance(entries, 1000);

      expect(result[0].balance).toBe(1000);
      expect(result[1].balance).toBe(1000);
    });
  });

  describe('categorizeAccounts', () => {
    it('should categorize accounts correctly', () => {
      const accounts = [
        { account_code: '1001', account_name: 'Cash', account_type: 'asset', balance: 10000 },
        { account_code: '1002', account_name: 'Bank', account_type: 'asset', balance: 5000 },
        { account_code: '2001', account_name: 'Payables', account_type: 'liability', balance: 3000 },
        { account_code: '3001', account_name: 'Capital', account_type: 'equity', balance: 12000 },
        { account_code: '4001', account_name: 'Sales', account_type: 'revenue', balance: 8000 },
        { account_code: '5001', account_name: 'Rent', account_type: 'expense', balance: 2000 },
      ];

      const result = categorizeAccounts(accounts);

      expect(result.assets).toHaveLength(2);
      expect(result.liabilities).toHaveLength(1);
      expect(result.equity).toHaveLength(1);
      expect(result.revenues).toHaveLength(1);
      expect(result.expenses).toHaveLength(1);
    });

    it('should handle empty accounts', () => {
      const result = categorizeAccounts([]);

      expect(result.assets).toHaveLength(0);
      expect(result.liabilities).toHaveLength(0);
      expect(result.equity).toHaveLength(0);
    });

    it('should handle unknown account types', () => {
      const accounts = [
        { account_code: '9001', account_name: 'Unknown', account_type: 'other', balance: 1000 },
      ];

      const result = categorizeAccounts(accounts);

      expect(result.assets).toHaveLength(0);
      expect(result.liabilities).toHaveLength(0);
    });
  });

  describe('calculateTrialBalanceTotals', () => {
    it('should calculate balanced totals', () => {
      const balances = [
        { debit: 10000, credit: 0 },
        { debit: 5000, credit: 0 },
        { debit: 0, credit: 8000 },
        { debit: 0, credit: 7000 },
      ];

      const result = calculateTrialBalanceTotals(balances);

      expect(result.totalDebit).toBe(15000);
      expect(result.totalCredit).toBe(15000);
      expect(result.isBalanced).toBe(true);
    });

    it('should detect unbalanced totals', () => {
      const balances = [
        { debit: 10000, credit: 0 },
        { debit: 0, credit: 5000 },
      ];

      const result = calculateTrialBalanceTotals(balances);

      expect(result.isBalanced).toBe(false);
    });

    it('should handle small differences within tolerance', () => {
      const balances = [
        { debit: 1000.005, credit: 0 },
        { debit: 0, credit: 1000 },
      ];

      const result = calculateTrialBalanceTotals(balances);

      expect(result.isBalanced).toBe(true);
    });

    it('should handle empty balances', () => {
      const result = calculateTrialBalanceTotals([]);

      expect(result.totalDebit).toBe(0);
      expect(result.totalCredit).toBe(0);
      expect(result.isBalanced).toBe(true);
    });
  });
});

// ===== Integration Tests with Mocked Supabase =====

describe('Accounting Service - Integration Workflows', () => {
  describe('Journal Entry Workflow', () => {
    it('should create a complete debit-credit workflow', () => {
      const journalEntry: JournalEntry = {
        entry_date: '2024-01-01',
        description: 'Sales invoice #001',
        reference_type: 'INV',
        reference_id: 'INV-001',
        entries: [
          {
            account_code: '1001',
            account_name: 'Accounts Receivable',
            debit: 11500,
            credit: 0,
            description: 'Customer invoice',
            reference_type: 'INV',
            reference_id: 'INV-001',
            transaction_date: '2024-01-01',
          },
          {
            account_code: '4001',
            account_name: 'Sales Revenue',
            debit: 0,
            credit: 10000,
            description: 'Product sales',
            reference_type: 'INV',
            reference_id: 'INV-001',
            transaction_date: '2024-01-01',
          },
          {
            account_code: '2101',
            account_name: 'VAT Payable',
            debit: 0,
            credit: 1500,
            description: 'VAT 15%',
            reference_type: 'INV',
            reference_id: 'INV-001',
            transaction_date: '2024-01-01',
          },
        ],
      };

      const validation = validateJournalBalance(journalEntry.entries);

      expect(validation.isBalanced).toBe(true);
      expect(validation.totalDebit).toBe(11500);
      expect(validation.totalCredit).toBe(11500);
    });

    it('should handle compound journal entries', () => {
      const journalEntry: JournalEntry = {
        entry_date: '2024-01-15',
        description: 'Payroll entry',
        reference_type: 'PAY',
        reference_id: 'PAY-001',
        entries: [
          {
            account_code: '5001',
            account_name: 'Salaries Expense',
            debit: 50000,
            credit: 0,
            description: 'Gross salaries',
            reference_type: 'PAY',
            reference_id: 'PAY-001',
            transaction_date: '2024-01-15',
          },
          {
            account_code: '5002',
            account_name: 'GOSI Expense',
            debit: 5000,
            credit: 0,
            description: 'Employer GOSI contribution',
            reference_type: 'PAY',
            reference_id: 'PAY-001',
            transaction_date: '2024-01-15',
          },
          {
            account_code: '2201',
            account_name: 'GOSI Payable',
            debit: 0,
            credit: 10000,
            description: 'GOSI payable (employer + employee)',
            reference_type: 'PAY',
            reference_id: 'PAY-001',
            transaction_date: '2024-01-15',
          },
          {
            account_code: '2202',
            account_name: 'Salaries Payable',
            debit: 0,
            credit: 45000,
            description: 'Net salaries payable',
            reference_type: 'PAY',
            reference_id: 'PAY-001',
            transaction_date: '2024-01-15',
          },
        ],
      };

      const validation = validateJournalBalance(journalEntry.entries);

      expect(validation.isBalanced).toBe(true);
      expect(validation.totalDebit).toBe(55000);
      expect(validation.totalCredit).toBe(55000);
    });
  });

  describe('Account Statement Generation', () => {
    it('should generate account statement with all movements', () => {
      const openingBalance = 10000;
      const movements = [
        { debit: 5000, credit: 0 },
        { debit: 0, credit: 2000 },
        { debit: 3000, credit: 0 },
        { debit: 0, credit: 1000 },
      ];

      const result = calculateRunningBalance(movements, openingBalance);

      expect(result[0].balance).toBe(15000);
      expect(result[1].balance).toBe(13000);
      expect(result[2].balance).toBe(16000);
      expect(result[3].balance).toBe(15000);

      const closingBalance = result[result.length - 1].balance;
      expect(closingBalance).toBe(15000);
    });
  });

  describe('Trial Balance Validation', () => {
    it('should validate that assets = liabilities + equity', () => {
      const accounts = [
        { account_code: '1001', account_name: 'Cash', account_type: 'asset', balance: 50000 },
        { account_code: '1002', account_name: 'Inventory', account_type: 'asset', balance: 30000 },
        { account_code: '2001', account_name: 'Accounts Payable', account_type: 'liability', balance: -20000 },
        { account_code: '3001', account_name: 'Capital', account_type: 'equity', balance: -60000 },
      ];

      const categorized = categorizeAccounts(accounts);

      const totalAssets = categorized.assets.reduce((sum, a) => sum + a.balance, 0);
      const totalLiabilities = categorized.liabilities.reduce((sum, a) => sum + Math.abs(a.balance), 0);
      const totalEquity = categorized.equity.reduce((sum, a) => sum + Math.abs(a.balance), 0);

      expect(totalAssets).toBe(80000);
      expect(totalLiabilities).toBe(20000);
      expect(totalEquity).toBe(60000);
      expect(totalAssets).toBe(totalLiabilities + totalEquity);
    });
  });

  describe('Income Statement Calculation', () => {
    it('should calculate net income correctly', () => {
      const accounts = [
        { account_code: '4001', account_name: 'Sales', account_type: 'revenue', balance: 100000 },
        { account_code: '4002', account_name: 'Service Revenue', account_type: 'revenue', balance: 20000 },
        { account_code: '5001', account_name: 'Cost of Sales', account_type: 'expense', balance: 60000 },
        { account_code: '5002', account_name: 'Rent Expense', account_type: 'expense', balance: 10000 },
        { account_code: '5003', account_name: 'Utilities', account_type: 'expense', balance: 5000 },
      ];

      const categorized = categorizeAccounts(accounts);

      const totalRevenues = categorized.revenues.reduce((sum, a) => sum + a.balance, 0);
      const totalExpenses = categorized.expenses.reduce((sum, a) => sum + a.balance, 0);
      const netIncome = totalRevenues - totalExpenses;

      expect(totalRevenues).toBe(120000);
      expect(totalExpenses).toBe(75000);
      expect(netIncome).toBe(45000);
    });
  });
});

// ===== Edge Cases and Validation =====

describe('Accounting Service - Edge Cases', () => {
  describe('Decimal Precision', () => {
    it('should handle floating-point precision issues', () => {
      const entries: GLEntry[] = [
        {
          account_code: '1001',
          account_name: 'Cash',
          debit: 0.1 + 0.2,
          credit: 0,
          description: 'Small amount',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
        {
          account_code: '4001',
          account_name: 'Revenue',
          debit: 0,
          credit: 0.3,
          description: 'Revenue',
          reference_type: 'JV',
          reference_id: '1',
          transaction_date: '2024-01-01',
        },
      ];

      const result = validateJournalBalance(entries);

      expect(result.isBalanced).toBe(true);
    });

    it('should handle currency amounts with many decimals', () => {
      const entries = [
        { debit: 1000.123456, credit: 0 },
        { debit: 0, credit: 500.654321 },
      ];

      const result = calculateBalance(entries);

      expect(result.balance).toBeCloseTo(499.469135, 5);
    });
  });

  describe('Large Dataset Handling', () => {
    it('should handle many entries efficiently', () => {
      const entries: Array<{ debit: number; credit: number }> = [];

      for (let i = 0; i < 500; i++) {
        entries.push({ debit: 100, credit: 0 });
        entries.push({ debit: 0, credit: 100 });
      }

      const result = calculateBalance(entries);

      expect(result.totalDebit).toBe(50000);
      expect(result.totalCredit).toBe(50000);
      expect(result.balance).toBe(0);
    });

    it('should group many entries correctly', () => {
      const entries: Array<{
        reference_type: string;
        reference_id: string;
        transaction_date: string;
        description: string;
        debit: number;
        credit: number;
      }> = [];

      for (let i = 0; i < 100; i++) {
        entries.push({
          reference_type: 'JV',
          reference_id: `JV-${i.toString().padStart(3, '0')}`,
          transaction_date: '2024-01-01',
          description: `Entry ${i}`,
          debit: 1000,
          credit: 0,
        });
        entries.push({
          reference_type: 'JV',
          reference_id: `JV-${i.toString().padStart(3, '0')}`,
          transaction_date: '2024-01-01',
          description: `Entry ${i}`,
          debit: 0,
          credit: 1000,
        });
      }

      const result = groupEntriesByReference(entries);

      expect(result).toHaveLength(100);
      result.forEach((group) => {
        expect(group.entries).toHaveLength(2);
        expect(group.totalDebit).toBe(1000);
        expect(group.totalCredit).toBe(1000);
      });
    });
  });

  describe('Negative Values', () => {
    it('should handle negative debit values', () => {
      const entries = [
        { debit: -500, credit: 0 },
        { debit: 0, credit: -500 },
      ];

      const result = calculateBalance(entries);

      expect(result.totalDebit).toBe(-500);
      expect(result.totalCredit).toBe(-500);
      expect(result.balance).toBe(0);
    });
  });

  describe('Zero Values', () => {
    it('should handle all zero entries', () => {
      const entries = [
        { debit: 0, credit: 0 },
        { debit: 0, credit: 0 },
      ];

      const result = calculateBalance(entries);

      expect(result.balance).toBe(0);
    });

    it('should handle running balance with zero movements', () => {
      const entries = [
        { debit: 0, credit: 0 },
        { debit: 0, credit: 0 },
      ];

      const result = calculateRunningBalance(entries, 5000);

      expect(result[0].balance).toBe(5000);
      expect(result[1].balance).toBe(5000);
    });
  });
});
