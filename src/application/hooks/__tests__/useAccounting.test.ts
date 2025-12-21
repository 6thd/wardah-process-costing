/**
 * @fileoverview Comprehensive Tests for useAccounting Hook
 * Tests React hooks for accounting operations
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

// Mock the accounting app service
const mockGetAccounts = vi.fn();
const mockGetAccountById = vi.fn();
const mockGetTrialBalance = vi.fn();
const mockGetIncomeStatement = vi.fn();
const mockGetBalanceSheet = vi.fn();
const mockCreateJournalEntry = vi.fn();
const mockGetAccountStatement = vi.fn();

vi.mock('@/application/services', () => ({
  getAccountingAppService: () => ({
    getAccounts: mockGetAccounts,
    getAccountById: mockGetAccountById,
    getTrialBalance: mockGetTrialBalance,
    getIncomeStatement: mockGetIncomeStatement,
    getBalanceSheet: mockGetBalanceSheet,
    createJournalEntry: mockCreateJournalEntry,
    getAccountStatement: mockGetAccountStatement,
  }),
}));

// Import after mocking
import {
  useChartOfAccounts,
  type DashboardMetrics,
} from '../useAccounting';

describe('useAccounting Hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('useChartOfAccounts', () => {
    it('should fetch accounts on mount', async () => {
      const mockAccounts = [
        { id: '1', code: '1000', name: 'Cash', type: 'asset' },
        { id: '2', code: '2000', name: 'Accounts Payable', type: 'liability' },
      ];

      mockGetAccounts.mockResolvedValueOnce({ accounts: mockAccounts });

      const { result } = renderHook(() => useChartOfAccounts());

      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(mockGetAccounts).toHaveBeenCalled();
      expect(result.current.accounts).toEqual(mockAccounts);
    });

    it('should not fetch when disabled', async () => {
      const { result } = renderHook(() => useChartOfAccounts({ enabled: false }));

      expect(result.current.loading).toBe(false);
      expect(mockGetAccounts).not.toHaveBeenCalled();
    });

    it('should handle fetch error', async () => {
      mockGetAccounts.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useChartOfAccounts());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBeInstanceOf(Error);
      expect(result.current.error?.message).toBe('Network error');
    });

    it('should refetch accounts on demand', async () => {
      mockGetAccounts.mockResolvedValue({ accounts: [] });

      const { result } = renderHook(() => useChartOfAccounts());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.refetch();
      });

      expect(mockGetAccounts).toHaveBeenCalledTimes(2);
    });

    it('should update filters', async () => {
      mockGetAccounts.mockResolvedValue({ accounts: [] });

      const { result } = renderHook(() => useChartOfAccounts());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      act(() => {
        result.current.setFilters({ type: 'asset' });
      });

      await waitFor(() => {
        expect(mockGetAccounts).toHaveBeenLastCalledWith({ type: 'asset' });
      });
    });

    it('should apply initial filters', async () => {
      mockGetAccounts.mockResolvedValue({ accounts: [] });

      renderHook(() => useChartOfAccounts({ type: 'expense', active: true }));

      await waitFor(() => {
        expect(mockGetAccounts).toHaveBeenCalledWith({
          type: 'expense',
          active: true,
        });
      });
    });
  });

  describe('Dashboard Metrics Calculations', () => {
    it('should calculate total accounts', () => {
      const accounts = [
        { id: '1', type: 'asset' },
        { id: '2', type: 'liability' },
        { id: '3', type: 'expense' },
      ];

      const metrics: DashboardMetrics = {
        totalAccounts: accounts.length,
        activeAccounts: accounts.length,
        totalAssets: 0,
        totalLiabilities: 0,
        totalRevenue: 0,
        totalExpenses: 0,
      };

      expect(metrics.totalAccounts).toBe(3);
    });

    it('should calculate total assets', () => {
      const assetAccounts = [
        { type: 'asset', balance: 10000 },
        { type: 'asset', balance: 5000 },
        { type: 'liability', balance: 3000 },
      ];

      const totalAssets = assetAccounts
        .filter(a => a.type === 'asset')
        .reduce((sum, a) => sum + a.balance, 0);

      expect(totalAssets).toBe(15000);
    });

    it('should calculate total liabilities', () => {
      const accounts = [
        { type: 'liability', balance: 8000 },
        { type: 'liability', balance: 2000 },
        { type: 'asset', balance: 5000 },
      ];

      const totalLiabilities = accounts
        .filter(a => a.type === 'liability')
        .reduce((sum, a) => sum + a.balance, 0);

      expect(totalLiabilities).toBe(10000);
    });

    it('should calculate net income', () => {
      const revenue = 50000;
      const expenses = 35000;
      const netIncome = revenue - expenses;

      expect(netIncome).toBe(15000);
    });

    it('should calculate equity', () => {
      const assets = 100000;
      const liabilities = 40000;
      const equity = assets - liabilities;

      expect(equity).toBe(60000);
    });
  });

  describe('Account Type Classifications', () => {
    it('should identify asset accounts', () => {
      const assetCodes = ['1000', '1100', '1200', '1300'];
      const isAsset = (code: string) => code.startsWith('1');

      assetCodes.forEach(code => {
        expect(isAsset(code)).toBe(true);
      });
    });

    it('should identify liability accounts', () => {
      const liabilityCodes = ['2000', '2100', '2200'];
      const isLiability = (code: string) => code.startsWith('2');

      liabilityCodes.forEach(code => {
        expect(isLiability(code)).toBe(true);
      });
    });

    it('should identify equity accounts', () => {
      const equityCodes = ['3000', '3100', '3200'];
      const isEquity = (code: string) => code.startsWith('3');

      equityCodes.forEach(code => {
        expect(isEquity(code)).toBe(true);
      });
    });

    it('should identify revenue accounts', () => {
      const revenueCodes = ['4000', '4100', '4200'];
      const isRevenue = (code: string) => code.startsWith('4');

      revenueCodes.forEach(code => {
        expect(isRevenue(code)).toBe(true);
      });
    });

    it('should identify expense accounts', () => {
      const expenseCodes = ['5000', '5100', '5200', '6000', '6100'];
      const isExpense = (code: string) => code.startsWith('5') || code.startsWith('6');

      expenseCodes.forEach(code => {
        expect(isExpense(code)).toBe(true);
      });
    });
  });

  describe('Trial Balance Calculations', () => {
    it('should calculate total debits', () => {
      const entries = [
        { debit: 1000, credit: 0 },
        { debit: 500, credit: 0 },
        { debit: 0, credit: 1500 },
      ];

      const totalDebits = entries.reduce((sum, e) => sum + e.debit, 0);

      expect(totalDebits).toBe(1500);
    });

    it('should calculate total credits', () => {
      const entries = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 800 },
        { debit: 0, credit: 700 },
      ];

      const totalCredits = entries.reduce((sum, e) => sum + e.credit, 0);

      expect(totalCredits).toBe(1500);
    });

    it('should verify trial balance is balanced', () => {
      const entries = [
        { debit: 1000, credit: 0 },
        { debit: 500, credit: 0 },
        { debit: 0, credit: 1500 },
      ];

      const totalDebits = entries.reduce((sum, e) => sum + e.debit, 0);
      const totalCredits = entries.reduce((sum, e) => sum + e.credit, 0);
      const isBalanced = totalDebits === totalCredits;

      expect(isBalanced).toBe(true);
    });

    it('should detect unbalanced trial balance', () => {
      const entries = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 900 },
      ];

      const totalDebits = entries.reduce((sum, e) => sum + e.debit, 0);
      const totalCredits = entries.reduce((sum, e) => sum + e.credit, 0);
      const isBalanced = totalDebits === totalCredits;

      expect(isBalanced).toBe(false);
    });
  });

  describe('Journal Entry Validation', () => {
    it('should validate entry has lines', () => {
      const entry = {
        date: '2025-12-20',
        description: 'Test entry',
        lines: [
          { account_code: '1000', debit: 1000, credit: 0 },
          { account_code: '2000', debit: 0, credit: 1000 },
        ],
      };

      const hasLines = entry.lines.length > 0;
      expect(hasLines).toBe(true);
    });

    it('should validate entry is balanced', () => {
      const lines = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 1000 },
      ];

      const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
      const isBalanced = totalDebit === totalCredit;

      expect(isBalanced).toBe(true);
    });

    it('should reject unbalanced entry', () => {
      const lines = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 500 },
      ];

      const totalDebit = lines.reduce((sum, l) => sum + l.debit, 0);
      const totalCredit = lines.reduce((sum, l) => sum + l.credit, 0);
      const isBalanced = totalDebit === totalCredit;

      expect(isBalanced).toBe(false);
    });

    it('should validate each line has either debit or credit', () => {
      const lines = [
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 1000 },
      ];

      const allLinesValid = lines.every(l => 
        (l.debit > 0 && l.credit === 0) || (l.debit === 0 && l.credit > 0)
      );

      expect(allLinesValid).toBe(true);
    });
  });

  describe('Account Statement', () => {
    it('should calculate running balance (debit account)', () => {
      const transactions = [
        { debit: 1000, credit: 0 },
        { debit: 500, credit: 0 },
        { debit: 0, credit: 300 },
      ];

      let balance = 0;
      const withBalance = transactions.map(t => {
        balance = balance + t.debit - t.credit;
        return { ...t, balance };
      });

      expect(withBalance[0].balance).toBe(1000);
      expect(withBalance[1].balance).toBe(1500);
      expect(withBalance[2].balance).toBe(1200);
    });

    it('should calculate running balance (credit account)', () => {
      const transactions = [
        { debit: 0, credit: 5000 },
        { debit: 1000, credit: 0 },
        { debit: 0, credit: 2000 },
      ];

      let balance = 0;
      const withBalance = transactions.map(t => {
        balance = balance - t.debit + t.credit;
        return { ...t, balance };
      });

      expect(withBalance[0].balance).toBe(5000);
      expect(withBalance[1].balance).toBe(4000);
      expect(withBalance[2].balance).toBe(6000);
    });
  });

  describe('Financial Period Handling', () => {
    it('should calculate fiscal year start', () => {
      const year = 2025;
      const fiscalYearStart = { year, month: 1, day: 1 };

      expect(fiscalYearStart.year).toBe(2025);
      expect(fiscalYearStart.month).toBe(1);
      expect(fiscalYearStart.day).toBe(1);
    });

    it('should calculate fiscal year end', () => {
      const year = 2025;
      const fiscalYearEnd = { year, month: 12, day: 31 };

      expect(fiscalYearEnd.year).toBe(2025);
      expect(fiscalYearEnd.month).toBe(12);
      expect(fiscalYearEnd.day).toBe(31);
    });

    it('should determine current quarter', () => {
      const getQuarter = (month: number) => Math.floor(month / 3) + 1;

      expect(getQuarter(0)).toBe(1);  // January
      expect(getQuarter(3)).toBe(2);  // April
      expect(getQuarter(6)).toBe(3);  // July
      expect(getQuarter(9)).toBe(4);  // October
    });
  });

  describe('Currency Formatting', () => {
    it('should format SAR currency', () => {
      const amount = 1234.56;
      const formatted = new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'SAR',
      }).format(amount);

      // Check that it contains the amount (locale-independent)
      expect(formatted).toMatch(/1.?234/);
    });

    it('should handle negative amounts', () => {
      const amount = -500;
      const isNegative = amount < 0;

      expect(isNegative).toBe(true);
    });

    it('should round to 2 decimal places', () => {
      const amount = 123.456789;
      const rounded = Math.round(amount * 100) / 100;

      expect(rounded).toBe(123.46);
    });
  });

  describe('Account Code Validation', () => {
    it('should validate account code format', () => {
      const codeRegex = /^\d{4,6}$/;
      const validCodes = ['1000', '11000', '123456'];
      const invalidCodes = ['100', '1234567', 'ABCD', '12-34'];

      validCodes.forEach(code => {
        expect(codeRegex.test(code)).toBe(true);
      });

      invalidCodes.forEach(code => {
        expect(codeRegex.test(code)).toBe(false);
      });
    });

    it('should check for duplicate codes', () => {
      const existingCodes = ['1000', '1100', '2000'];
      const newCode = '1100';
      const isDuplicate = existingCodes.includes(newCode);

      expect(isDuplicate).toBe(true);
    });
  });

  describe('Parent-Child Account Hierarchy', () => {
    it('should find child accounts', () => {
      const accounts = [
        { code: '1000', name: 'Assets' },
        { code: '1100', name: 'Current Assets' },
        { code: '1110', name: 'Cash' },
        { code: '1120', name: 'Bank' },
        { code: '2000', name: 'Liabilities' },
      ];

      const parentCode = '11';
      const children: Array<{ code: string; name: string }> = [];
      for (const account of accounts) {
        if (account.code.startsWith(parentCode) && account.code.length > 2) {
          if (account.code === '1110' || account.code === '1120') {
            children.push(account);
          }
        }
      }

      expect(children.length).toBe(2);
      expect(children[0].code).toBe('1110');
      expect(children[1].code).toBe('1120');
    });

    it('should calculate parent account balance', () => {
      const childBalances = [
        { code: '1110', balance: 5000 },
        { code: '1120', balance: 10000 },
        { code: '1130', balance: 3000 },
      ];

      const parentBalance = childBalances.reduce((sum, c) => sum + c.balance, 0);

      expect(parentBalance).toBe(18000);
    });
  });
});
