/**
 * Tests for features/accounting/journal-entries/utils/journalHelpers.ts - REAL COVERAGE TESTS
 * These tests import and test actual source code functions
 */
import { describe, it, expect } from 'vitest';
import { normalizeLines, calculateTotals, validateEntry } from '../journalHelpers';
import type { Account, JournalLine } from '../../types';

describe('journalHelpers', () => {
  const mockAccounts: Account[] = [
    { id: 'acc-1', code: '1001', name: 'Cash', name_ar: 'نقدية', type: 'asset' },
    { id: 'acc-2', code: '2001', name: 'Accounts Payable', name_ar: 'ذمم دائنة', type: 'liability' },
    { id: 'acc-3', code: '4001', name: 'Sales Revenue', name_ar: 'إيرادات المبيعات', type: 'revenue' },
  ];

  describe('normalizeLines', () => {
    it('should return empty array for empty rawLines', () => {
      expect(normalizeLines([], undefined, mockAccounts)).toEqual([]);
    });

    it('should return empty array for null rawLines', () => {
      expect(normalizeLines(null as any, undefined, mockAccounts)).toEqual([]);
    });

    it('should normalize line with account_id', () => {
      const rawLines = [{ account_id: 'acc-1', debit: 100 }];
      const result = normalizeLines(rawLines, 'entry-1', mockAccounts);
      
      expect(result).toHaveLength(1);
      expect(result[0].account_id).toBe('acc-1');
      expect(result[0].account_code).toBe('1001');
      expect(result[0].account_name).toBe('Cash');
      expect(result[0].account_name_ar).toBe('نقدية');
    });

    it('should normalize line with account_code when account_id not found', () => {
      const rawLines = [{ account_code: '2001', credit: 50 }];
      const result = normalizeLines(rawLines, 'entry-1', mockAccounts);
      
      expect(result[0].account_id).toBe('acc-2');
      expect(result[0].account_name).toBe('Accounts Payable');
    });

    it('should set line_number based on index', () => {
      const rawLines = [
        { account_id: 'acc-1', debit: 100 },
        { account_id: 'acc-2', credit: 100 }
      ];
      const result = normalizeLines(rawLines, 'entry-1', mockAccounts);
      
      expect(result[0].line_number).toBe(1);
      expect(result[1].line_number).toBe(2);
    });

    it('should preserve existing line_number', () => {
      const rawLines = [{ account_id: 'acc-1', debit: 100, line_number: 5 }];
      const result = normalizeLines(rawLines, 'entry-1', mockAccounts);
      
      expect(result[0].line_number).toBe(5);
    });

    it('should generate id from entry id and index', () => {
      const rawLines = [{ account_id: 'acc-1', debit: 100 }];
      const result = normalizeLines(rawLines, 'entry-1', mockAccounts);
      
      expect(result[0].id).toBe('entry-1-0');
    });

    it('should preserve existing id', () => {
      const rawLines = [{ id: 'line-existing', account_id: 'acc-1', debit: 100 }];
      const result = normalizeLines(rawLines, 'entry-1', mockAccounts);
      
      expect(result[0].id).toBe('line-existing');
    });

    it('should default currency to SAR', () => {
      const rawLines = [{ account_id: 'acc-1', debit: 100 }];
      const result = normalizeLines(rawLines, 'entry-1', mockAccounts);
      
      expect(result[0].currency_code).toBe('SAR');
    });

    it('should handle missing account gracefully', () => {
      const rawLines = [{ account_id: 'non-existent', debit: 100 }];
      const result = normalizeLines(rawLines, 'entry-1', mockAccounts);
      
      expect(result[0].account_id).toBe('non-existent');
      expect(result[0].account_code).toBe('');
    });

    it('should default debit and credit to empty string', () => {
      const rawLines = [{ account_id: 'acc-1' }];
      const result = normalizeLines(rawLines, undefined, mockAccounts);
      
      expect(result[0].debit).toBe('');
      expect(result[0].credit).toBe('');
    });
  });

  describe('calculateTotals', () => {
    it('should calculate totals correctly', () => {
      const lines: Partial<JournalLine>[] = [
        { debit: 100, credit: 0 },
        { debit: 50, credit: 0 },
        { debit: 0, credit: 150 }
      ];
      const result = calculateTotals(lines);
      
      expect(result.totalDebit).toBe(150);
      expect(result.totalCredit).toBe(150);
      expect(result.balanced).toBe(true);
    });

    it('should handle string values', () => {
      const lines = [
        { debit: '100', credit: '0' },
        { debit: '0', credit: '100' }
      ] as any;
      const result = calculateTotals(lines);
      
      expect(result.totalDebit).toBe(100);
      expect(result.totalCredit).toBe(100);
      expect(result.balanced).toBe(true);
    });

    it('should return balanced=false when unbalanced', () => {
      const lines: Partial<JournalLine>[] = [
        { debit: 100, credit: 0 },
        { debit: 0, credit: 50 }
      ];
      const result = calculateTotals(lines);
      
      expect(result.balanced).toBe(false);
    });

    it('should return balanced=false when totals are zero', () => {
      const lines: Partial<JournalLine>[] = [
        { debit: 0, credit: 0 }
      ];
      const result = calculateTotals(lines);
      
      expect(result.balanced).toBe(false);
    });

    it('should handle empty lines', () => {
      const result = calculateTotals([]);
      
      expect(result.totalDebit).toBe(0);
      expect(result.totalCredit).toBe(0);
      expect(result.balanced).toBe(false);
    });

    it('should handle undefined values', () => {
      const lines: Partial<JournalLine>[] = [
        { debit: undefined, credit: undefined }
      ];
      const result = calculateTotals(lines);
      
      expect(result.totalDebit).toBe(0);
      expect(result.totalCredit).toBe(0);
    });
  });

  describe('validateEntry', () => {
    it('should return invalid when journalId is empty', () => {
      const result = validateEntry('', [{ debit: 100, credit: 0 }], false);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Please select a journal type');
    });

    it('should return invalid when journalId is empty (RTL)', () => {
      const result = validateEntry('', [], true);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('يجب اختيار نوع القيد');
    });

    it('should return invalid when lines is empty', () => {
      const result = validateEntry('journal-1', [], false);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Please add lines to the entry');
    });

    it('should return invalid when lines is empty (RTL)', () => {
      const result = validateEntry('journal-1', [], true);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('يجب إضافة بنود للقيد');
    });

    it('should return invalid when entry is not balanced', () => {
      const lines: Partial<JournalLine>[] = [
        { debit: 100, credit: 0 },
        { debit: 0, credit: 50 }
      ];
      const result = validateEntry('journal-1', lines, false);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('Entry not balanced! Debit and Credit must be equal');
    });

    it('should return invalid when entry is not balanced (RTL)', () => {
      const lines: Partial<JournalLine>[] = [
        { debit: 100, credit: 0 },
        { debit: 0, credit: 50 }
      ];
      const result = validateEntry('journal-1', lines, true);
      
      expect(result.valid).toBe(false);
      expect(result.message).toBe('القيد غير متوازن! يجب تساوي المدين والدائن');
    });

    it('should return valid for balanced entry', () => {
      const lines: Partial<JournalLine>[] = [
        { debit: 100, credit: 0 },
        { debit: 0, credit: 100 }
      ];
      const result = validateEntry('journal-1', lines, false);
      
      expect(result.valid).toBe(true);
      expect(result.message).toBeUndefined();
    });
  });
});
