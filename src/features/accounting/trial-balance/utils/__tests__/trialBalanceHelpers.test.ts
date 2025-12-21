/**
 * Tests for features/accounting/trial-balance/utils/trialBalanceHelpers.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code functions
 */
import { describe, it, expect } from 'vitest';
import { calculateTotals, filterBalancesByType } from '../trialBalanceHelpers';
import type { TrialBalanceRow } from '../../types';

describe('trialBalanceHelpers', () => {
  const mockBalances: TrialBalanceRow[] = [
    {
      account_id: '1',
      account_code: '1001',
      account_name: 'Cash',
      account_name_ar: 'نقدية',
      account_type: 'asset',
      opening_debit: 1000,
      opening_credit: 0,
      period_debit: 500,
      period_credit: 200,
      closing_debit: 1300,
      closing_credit: 0
    },
    {
      account_id: '2',
      account_code: '2001',
      account_name: 'Accounts Payable',
      account_name_ar: 'ذمم دائنة',
      account_type: 'liability',
      opening_debit: 0,
      opening_credit: 500,
      period_debit: 100,
      period_credit: 300,
      closing_debit: 0,
      closing_credit: 700
    },
    {
      account_id: '3',
      account_code: '4001',
      account_name: 'Sales Revenue',
      account_name_ar: 'إيرادات المبيعات',
      account_type: 'revenue',
      opening_debit: 0,
      opening_credit: 2000,
      period_debit: 0,
      period_credit: 1000,
      closing_debit: 0,
      closing_credit: 3000
    }
  ];

  describe('calculateTotals', () => {
    it('should calculate all totals correctly', () => {
      const result = calculateTotals(mockBalances);
      
      expect(result.opening_debit).toBe(1000);
      expect(result.opening_credit).toBe(2500);
      expect(result.period_debit).toBe(600);
      expect(result.period_credit).toBe(1500);
      expect(result.closing_debit).toBe(1300);
      expect(result.closing_credit).toBe(3700);
    });

    it('should return zeros for empty array', () => {
      const result = calculateTotals([]);
      
      expect(result.opening_debit).toBe(0);
      expect(result.opening_credit).toBe(0);
      expect(result.period_debit).toBe(0);
      expect(result.period_credit).toBe(0);
      expect(result.closing_debit).toBe(0);
      expect(result.closing_credit).toBe(0);
    });

    it('should handle single row', () => {
      const singleRow: TrialBalanceRow[] = [mockBalances[0]];
      const result = calculateTotals(singleRow);
      
      expect(result.opening_debit).toBe(1000);
      expect(result.opening_credit).toBe(0);
      expect(result.period_debit).toBe(500);
      expect(result.period_credit).toBe(200);
      expect(result.closing_debit).toBe(1300);
      expect(result.closing_credit).toBe(0);
    });
  });

  describe('filterBalancesByType', () => {
    it('should return all balances for "all" filter', () => {
      const result = filterBalancesByType(mockBalances, 'all');
      expect(result).toEqual(mockBalances);
      expect(result).toHaveLength(3);
    });

    it('should filter by asset type', () => {
      const result = filterBalancesByType(mockBalances, 'asset');
      expect(result).toHaveLength(1);
      expect(result[0].account_code).toBe('1001');
    });

    it('should filter by liability type', () => {
      const result = filterBalancesByType(mockBalances, 'liability');
      expect(result).toHaveLength(1);
      expect(result[0].account_code).toBe('2001');
    });

    it('should filter by revenue type', () => {
      const result = filterBalancesByType(mockBalances, 'revenue');
      expect(result).toHaveLength(1);
      expect(result[0].account_code).toBe('4001');
    });

    it('should return empty array for non-matching type', () => {
      const result = filterBalancesByType(mockBalances, 'expense');
      expect(result).toHaveLength(0);
    });

    it('should return empty array for empty input', () => {
      const result = filterBalancesByType([], 'asset');
      expect(result).toHaveLength(0);
    });
  });
});
