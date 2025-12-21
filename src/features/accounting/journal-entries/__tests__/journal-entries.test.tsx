/**
 * Journal Entries Module Tests
 * اختبارات وحدة القيود اليومية
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import React from 'react';

// Mock dependencies
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' }
  })
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn()
  }
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: vi.fn(),
  getEffectiveTenantId: vi.fn().mockResolvedValue('test-tenant')
}));

vi.mock('../hooks/useJournalData', () => ({
  useJournalData: () => ({
    journals: [
      { id: 'j1', code: 'GJ', name: 'General Journal', name_ar: 'دفتر اليومية العام' },
      { id: 'j2', code: 'SJ', name: 'Sales Journal', name_ar: 'دفتر يومية المبيعات' }
    ],
    accounts: [
      { id: 'a1', code: '1001', name: 'Cash', name_ar: 'النقدية', category: 'ASSET' },
      { id: 'a2', code: '4001', name: 'Revenue', name_ar: 'الإيرادات', category: 'REVENUE' }
    ]
  })
}));

vi.mock('../hooks/useJournalEntries', () => ({
  useJournalEntries: () => ({
    entries: [
      { id: 'e1', entry_number: 'JE-0001', entry_date: '2024-01-15', description: 'Test Entry', status: 'draft', total_debit: 1000, total_credit: 1000 }
    ],
    loading: false,
    fetchEntries: vi.fn()
  })
}));

// Helper Types
interface JournalLine {
  line_number: number;
  account_id: string;
  debit: number | string;
  credit: number | string;
  description?: string;
}

// ===================== JOURNAL ENTRY CALCULATIONS =====================

describe('Journal Entry Calculations', () => {
  // Calculate totals helper
  const calculateTotals = (lines: JournalLine[]) => {
    const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
    return { totalDebit, totalCredit, isBalanced };
  };

  it('should calculate total debit correctly', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 500, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 300, credit: 0 },
      { line_number: 3, account_id: 'a3', debit: 0, credit: 800 }
    ];

    const { totalDebit } = calculateTotals(lines);
    expect(totalDebit).toBe(800);
  });

  it('should calculate total credit correctly', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 1000, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 600 },
      { line_number: 3, account_id: 'a3', debit: 0, credit: 400 }
    ];

    const { totalCredit } = calculateTotals(lines);
    expect(totalCredit).toBe(1000);
  });

  it('should detect balanced entry', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 1000, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 1000 }
    ];

    const { isBalanced } = calculateTotals(lines);
    expect(isBalanced).toBe(true);
  });

  it('should detect unbalanced entry', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 1000, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 900 }
    ];

    const { isBalanced } = calculateTotals(lines);
    expect(isBalanced).toBe(false);
  });

  it('should handle string inputs', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: '500', credit: '0' },
      { line_number: 2, account_id: 'a2', debit: '0', credit: '500' }
    ];

    const { totalDebit, totalCredit, isBalanced } = calculateTotals(lines);
    expect(totalDebit).toBe(500);
    expect(totalCredit).toBe(500);
    expect(isBalanced).toBe(true);
  });

  it('should handle empty lines', () => {
    const lines: JournalLine[] = [];
    const { totalDebit, totalCredit, isBalanced } = calculateTotals(lines);
    expect(totalDebit).toBe(0);
    expect(totalCredit).toBe(0);
    expect(isBalanced).toBe(true);
  });

  it('should handle decimal precision', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 100.005, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 100.009 }
    ];

    const { isBalanced } = calculateTotals(lines);
    expect(isBalanced).toBe(true); // Within 0.01 tolerance
  });
});

// ===================== JOURNAL ENTRY VALIDATION =====================

describe('Journal Entry Validation', () => {
  const validateEntry = (journalId: string, lines: JournalLine[], isRTL = false) => {
    if (!journalId) {
      return { valid: false, message: isRTL ? 'يجب اختيار دفتر اليومية' : 'Please select a journal' };
    }

    if (lines.length === 0) {
      return { valid: false, message: isRTL ? 'يجب إضافة سطور' : 'Please add lines' };
    }

    // Check for accounts
    const hasEmptyAccounts = lines.some(line => !line.account_id);
    if (hasEmptyAccounts) {
      return { valid: false, message: isRTL ? 'يجب اختيار حساب لكل سطر' : 'Please select an account for each line' };
    }

    // Check for zero amounts
    const hasZeroAmounts = lines.some(line => Number(line.debit) === 0 && Number(line.credit) === 0);
    if (hasZeroAmounts) {
      return { valid: false, message: isRTL ? 'كل سطر يجب أن يحتوي على مبلغ' : 'Each line must have an amount' };
    }

    // Check balance
    const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return { valid: false, message: isRTL ? 'القيد غير متوازن' : 'Entry is not balanced' };
    }

    return { valid: true, message: '' };
  };

  it('should fail when no journal selected', () => {
    const result = validateEntry('', [{ line_number: 1, account_id: 'a1', debit: 100, credit: 0 }]);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('journal');
  });

  it('should fail when no lines', () => {
    const result = validateEntry('j1', []);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('lines');
  });

  it('should fail when account is missing', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 100, credit: 0 },
      { line_number: 2, account_id: '', debit: 0, credit: 100 }
    ];
    const result = validateEntry('j1', lines);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('account');
  });

  it('should fail when amount is zero', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 0, credit: 0 }
    ];
    const result = validateEntry('j1', lines);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('amount');
  });

  it('should fail when unbalanced', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 100, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 50 }
    ];
    const result = validateEntry('j1', lines);
    expect(result.valid).toBe(false);
    expect(result.message).toContain('balanced');
  });

  it('should pass with valid entry', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 1000, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 1000 }
    ];
    const result = validateEntry('j1', lines);
    expect(result.valid).toBe(true);
  });

  it('should return Arabic messages when RTL', () => {
    const result = validateEntry('', [], true);
    expect(result.message).toContain('دفتر');
  });
});

// ===================== ENTRY STATUS MANAGEMENT =====================

describe('Entry Status Management', () => {
  type EntryStatus = 'draft' | 'pending' | 'posted' | 'reversed';

  const getStatusBadge = (status: EntryStatus) => {
    const badges: Record<EntryStatus, { label: string; variant: string }> = {
      draft: { label: 'Draft', variant: 'secondary' },
      pending: { label: 'Pending', variant: 'warning' },
      posted: { label: 'Posted', variant: 'success' },
      reversed: { label: 'Reversed', variant: 'destructive' }
    };
    return badges[status];
  };

  const canEditEntry = (status: EntryStatus) => status === 'draft';
  const canDeleteEntry = (status: EntryStatus) => status === 'draft';
  const canPostEntry = (status: EntryStatus) => status === 'draft' || status === 'pending';
  const canReverseEntry = (status: EntryStatus) => status === 'posted';

  it('should return correct badge for draft', () => {
    const badge = getStatusBadge('draft');
    expect(badge.label).toBe('Draft');
    expect(badge.variant).toBe('secondary');
  });

  it('should return correct badge for posted', () => {
    const badge = getStatusBadge('posted');
    expect(badge.label).toBe('Posted');
    expect(badge.variant).toBe('success');
  });

  it('should allow edit for draft entries', () => {
    expect(canEditEntry('draft')).toBe(true);
    expect(canEditEntry('posted')).toBe(false);
  });

  it('should allow delete for draft entries only', () => {
    expect(canDeleteEntry('draft')).toBe(true);
    expect(canDeleteEntry('pending')).toBe(false);
    expect(canDeleteEntry('posted')).toBe(false);
  });

  it('should allow post for draft and pending entries', () => {
    expect(canPostEntry('draft')).toBe(true);
    expect(canPostEntry('pending')).toBe(true);
    expect(canPostEntry('posted')).toBe(false);
  });

  it('should allow reverse for posted entries only', () => {
    expect(canReverseEntry('posted')).toBe(true);
    expect(canReverseEntry('draft')).toBe(false);
    expect(canReverseEntry('reversed')).toBe(false);
  });
});

// ===================== ENTRY NUMBER GENERATION =====================

describe('Entry Number Generation', () => {
  const generateEntryNumber = (journal: string, sequence: number) => {
    const prefix = journal.toUpperCase().substring(0, 2);
    const year = new Date().getFullYear();
    const paddedSequence = String(sequence).padStart(6, '0');
    return `${prefix}-${year}-${paddedSequence}`;
  };

  const parseEntryNumber = (entryNumber: string) => {
    const parts = entryNumber.split('-');
    if (parts.length !== 3) return null;
    return {
      prefix: parts[0],
      year: parseInt(parts[1]),
      sequence: parseInt(parts[2])
    };
  };

  it('should generate correct entry number format', () => {
    const year = new Date().getFullYear();
    const entryNumber = generateEntryNumber('GJ', 1);
    expect(entryNumber).toBe(`GJ-${year}-000001`);
  });

  it('should pad sequence correctly', () => {
    const year = new Date().getFullYear();
    expect(generateEntryNumber('SJ', 123)).toBe(`SJ-${year}-000123`);
    expect(generateEntryNumber('SJ', 999999)).toBe(`SJ-${year}-999999`);
  });

  it('should parse entry number correctly', () => {
    const parsed = parseEntryNumber('GJ-2024-000123');
    expect(parsed).toEqual({
      prefix: 'GJ',
      year: 2024,
      sequence: 123
    });
  });

  it('should return null for invalid format', () => {
    expect(parseEntryNumber('invalid')).toBeNull();
    expect(parseEntryNumber('GJ-2024')).toBeNull();
  });
});

// ===================== JOURNAL LINE OPERATIONS =====================

describe('Journal Line Operations', () => {
  const normalizeLines = (lines: any[]) => {
    return lines.map((line, index) => ({
      ...line,
      line_number: index + 1,
      debit: Number(line.debit) || 0,
      credit: Number(line.credit) || 0
    }));
  };

  const splitAmount = (amount: number, splitBy: 'debit' | 'credit') => {
    if (splitBy === 'debit') {
      return { debit: amount, credit: 0 };
    }
    return { debit: 0, credit: amount };
  };

  const autoBalanceLine = (lines: JournalLine[]) => {
    const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
    const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
    const difference = totalDebit - totalCredit;

    if (difference === 0) return null;

    if (difference > 0) {
      return { debit: 0, credit: difference };
    }
    return { debit: -difference, credit: 0 };
  };

  it('should normalize lines with sequential numbers', () => {
    const lines = [
      { account_id: 'a1', debit: '100', credit: '0' },
      { account_id: 'a2', debit: '0', credit: '100' }
    ];

    const normalized = normalizeLines(lines);
    expect(normalized[0].line_number).toBe(1);
    expect(normalized[1].line_number).toBe(2);
    expect(normalized[0].debit).toBe(100);
  });

  it('should split amount correctly', () => {
    expect(splitAmount(500, 'debit')).toEqual({ debit: 500, credit: 0 });
    expect(splitAmount(500, 'credit')).toEqual({ debit: 0, credit: 500 });
  });

  it('should calculate auto balance for debit heavy entry', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 1000, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 700 }
    ];

    const balance = autoBalanceLine(lines);
    expect(balance).toEqual({ debit: 0, credit: 300 });
  });

  it('should calculate auto balance for credit heavy entry', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 500, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 800 }
    ];

    const balance = autoBalanceLine(lines);
    expect(balance).toEqual({ debit: 300, credit: 0 });
  });

  it('should return null when already balanced', () => {
    const lines: JournalLine[] = [
      { line_number: 1, account_id: 'a1', debit: 500, credit: 0 },
      { line_number: 2, account_id: 'a2', debit: 0, credit: 500 }
    ];

    const balance = autoBalanceLine(lines);
    expect(balance).toBeNull();
  });
});

// ===================== REFERENCE TYPES =====================

describe('Reference Types', () => {
  const referenceTypes = [
    { code: 'SALES', name: 'Sales Invoice', prefix: 'SI' },
    { code: 'PURCHASE', name: 'Purchase Invoice', prefix: 'PI' },
    { code: 'RECEIPT', name: 'Customer Receipt', prefix: 'CR' },
    { code: 'PAYMENT', name: 'Supplier Payment', prefix: 'SP' },
    { code: 'ADJUSTMENT', name: 'Adjustment', prefix: 'ADJ' },
    { code: 'MANUAL', name: 'Manual Entry', prefix: 'ME' }
  ];

  const getReferenceTypeByCode = (code: string) => {
    return referenceTypes.find(rt => rt.code === code);
  };

  const getReferenceTypeByPrefix = (prefix: string) => {
    return referenceTypes.find(rt => rt.prefix === prefix);
  };

  it('should find reference type by code', () => {
    const type = getReferenceTypeByCode('SALES');
    expect(type?.name).toBe('Sales Invoice');
    expect(type?.prefix).toBe('SI');
  });

  it('should find reference type by prefix', () => {
    const type = getReferenceTypeByPrefix('PI');
    expect(type?.code).toBe('PURCHASE');
  });

  it('should return undefined for invalid code', () => {
    const type = getReferenceTypeByCode('INVALID');
    expect(type).toBeUndefined();
  });

  it('should have unique codes', () => {
    const codes = referenceTypes.map(rt => rt.code);
    const uniqueCodes = [...new Set(codes)];
    expect(codes.length).toBe(uniqueCodes.length);
  });

  it('should have unique prefixes', () => {
    const prefixes = referenceTypes.map(rt => rt.prefix);
    const uniquePrefixes = [...new Set(prefixes)];
    expect(prefixes.length).toBe(uniquePrefixes.length);
  });
});

// ===================== BATCH POSTING =====================

describe('Batch Posting', () => {
  type EntryStatus = 'draft' | 'pending' | 'posted';
  
  interface BatchEntry {
    id: string;
    entry_number: string;
    status: EntryStatus;
    total_debit: number;
    total_credit: number;
  }

  const filterPostableEntries = (entries: BatchEntry[]) => {
    return entries.filter(e => e.status === 'draft' || e.status === 'pending');
  };

  const validateBatchPost = (entries: BatchEntry[]) => {
    const errors: string[] = [];
    
    entries.forEach(entry => {
      if (entry.total_debit !== entry.total_credit) {
        errors.push(`${entry.entry_number}: Not balanced`);
      }
      if (entry.status === 'posted') {
        errors.push(`${entry.entry_number}: Already posted`);
      }
    });

    return { valid: errors.length === 0, errors };
  };

  const calculateBatchTotals = (entries: BatchEntry[]) => {
    const totalDebit = entries.reduce((sum, e) => sum + e.total_debit, 0);
    const totalCredit = entries.reduce((sum, e) => sum + e.total_credit, 0);
    return { totalDebit, totalCredit, count: entries.length };
  };

  it('should filter postable entries', () => {
    const entries: BatchEntry[] = [
      { id: '1', entry_number: 'JE-001', status: 'draft', total_debit: 100, total_credit: 100 },
      { id: '2', entry_number: 'JE-002', status: 'posted', total_debit: 200, total_credit: 200 },
      { id: '3', entry_number: 'JE-003', status: 'pending', total_debit: 300, total_credit: 300 }
    ];

    const postable = filterPostableEntries(entries);
    expect(postable.length).toBe(2);
    expect(postable.map(e => e.id)).toEqual(['1', '3']);
  });

  it('should validate batch with errors', () => {
    const entries: BatchEntry[] = [
      { id: '1', entry_number: 'JE-001', status: 'draft', total_debit: 100, total_credit: 50 },
      { id: '2', entry_number: 'JE-002', status: 'posted', total_debit: 200, total_credit: 200 }
    ];

    const result = validateBatchPost(entries);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(2);
  });

  it('should calculate batch totals', () => {
    const entries: BatchEntry[] = [
      { id: '1', entry_number: 'JE-001', status: 'draft', total_debit: 1000, total_credit: 1000 },
      { id: '2', entry_number: 'JE-002', status: 'draft', total_debit: 2500, total_credit: 2500 }
    ];

    const totals = calculateBatchTotals(entries);
    expect(totals.totalDebit).toBe(3500);
    expect(totals.totalCredit).toBe(3500);
    expect(totals.count).toBe(2);
  });
});

// ===================== DATE FILTERING =====================

describe('Date Filtering', () => {
  interface Entry {
    id: string;
    entry_date: string;
  }

  const filterByDateRange = (entries: Entry[], startDate: string, endDate: string) => {
    return entries.filter(e => {
      return e.entry_date >= startDate && e.entry_date <= endDate;
    });
  };

  const filterByMonth = (entries: Entry[], year: number, month: number) => {
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${lastDay}`;
    return filterByDateRange(entries, startDate, endDate);
  };

  const entries: Entry[] = [
    { id: '1', entry_date: '2024-01-15' },
    { id: '2', entry_date: '2024-01-25' },
    { id: '3', entry_date: '2024-02-10' },
    { id: '4', entry_date: '2024-03-05' }
  ];

  it('should filter by date range', () => {
    const filtered = filterByDateRange(entries, '2024-01-01', '2024-01-31');
    expect(filtered.length).toBe(2);
    expect(filtered.map(e => e.id)).toEqual(['1', '2']);
  });

  it('should filter by month', () => {
    const filtered = filterByMonth(entries, 2024, 2);
    expect(filtered.length).toBe(1);
    expect(filtered[0].id).toBe('3');
  });

  it('should return empty for no matches', () => {
    const filtered = filterByDateRange(entries, '2024-06-01', '2024-06-30');
    expect(filtered.length).toBe(0);
  });
});

// ===================== CURRENCY HANDLING =====================

describe('Currency Handling', () => {
  const exchangeRates: Record<string, number> = {
    'USD': 3.75,
    'EUR': 4.10,
    'GBP': 4.75,
    'SAR': 1.00
  };

  const convertToBaseCurrency = (amount: number, currency: string) => {
    const rate = exchangeRates[currency];
    if (!rate) throw new Error(`Unknown currency: ${currency}`);
    return amount * rate;
  };

  const convertFromBaseCurrency = (amount: number, currency: string) => {
    const rate = exchangeRates[currency];
    if (!rate) throw new Error(`Unknown currency: ${currency}`);
    return amount / rate;
  };

  it('should convert USD to SAR', () => {
    const result = convertToBaseCurrency(100, 'USD');
    expect(result).toBe(375);
  });

  it('should convert SAR to USD', () => {
    const result = convertFromBaseCurrency(375, 'USD');
    expect(result).toBe(100);
  });

  it('should handle SAR (no conversion)', () => {
    const result = convertToBaseCurrency(100, 'SAR');
    expect(result).toBe(100);
  });

  it('should throw for unknown currency', () => {
    expect(() => convertToBaseCurrency(100, 'XXX')).toThrow('Unknown currency');
  });
});

// ===================== APPROVAL WORKFLOW =====================

describe('Approval Workflow', () => {
  type ApprovalStatus = 'pending' | 'approved' | 'rejected';

  interface ApprovalStep {
    level: number;
    approver_id: string;
    status: ApprovalStatus;
    notes?: string;
  }

  const getNextApprovalLevel = (steps: ApprovalStep[]) => {
    const pending = steps.filter(s => s.status === 'pending');
    if (pending.length === 0) return null;
    return Math.min(...pending.map(s => s.level));
  };

  const canUserApprove = (steps: ApprovalStep[], userId: string) => {
    const nextLevel = getNextApprovalLevel(steps);
    if (!nextLevel) return false;
    return steps.some(s => s.level === nextLevel && s.approver_id === userId && s.status === 'pending');
  };

  const isFullyApproved = (steps: ApprovalStep[]) => {
    return steps.every(s => s.status === 'approved');
  };

  const hasRejection = (steps: ApprovalStep[]) => {
    return steps.some(s => s.status === 'rejected');
  };

  it('should get next approval level', () => {
    const steps: ApprovalStep[] = [
      { level: 1, approver_id: 'u1', status: 'approved' },
      { level: 2, approver_id: 'u2', status: 'pending' },
      { level: 3, approver_id: 'u3', status: 'pending' }
    ];

    expect(getNextApprovalLevel(steps)).toBe(2);
  });

  it('should return null when all approved', () => {
    const steps: ApprovalStep[] = [
      { level: 1, approver_id: 'u1', status: 'approved' }
    ];

    expect(getNextApprovalLevel(steps)).toBeNull();
  });

  it('should check if user can approve', () => {
    const steps: ApprovalStep[] = [
      { level: 1, approver_id: 'u1', status: 'approved' },
      { level: 2, approver_id: 'u2', status: 'pending' }
    ];

    expect(canUserApprove(steps, 'u2')).toBe(true);
    expect(canUserApprove(steps, 'u1')).toBe(false);
    expect(canUserApprove(steps, 'u3')).toBe(false);
  });

  it('should check fully approved', () => {
    const approved: ApprovalStep[] = [
      { level: 1, approver_id: 'u1', status: 'approved' },
      { level: 2, approver_id: 'u2', status: 'approved' }
    ];
    expect(isFullyApproved(approved)).toBe(true);

    const partial: ApprovalStep[] = [
      { level: 1, approver_id: 'u1', status: 'approved' },
      { level: 2, approver_id: 'u2', status: 'pending' }
    ];
    expect(isFullyApproved(partial)).toBe(false);
  });

  it('should detect rejection', () => {
    const rejected: ApprovalStep[] = [
      { level: 1, approver_id: 'u1', status: 'rejected' }
    ];
    expect(hasRejection(rejected)).toBe(true);
  });
});
