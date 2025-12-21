/**
 * General Ledger Module Tests
 * اختبارات وحدة دفتر الأستاذ العام
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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
  getEffectiveTenantId: vi.fn().mockResolvedValue('test-tenant'),
  getAllGLAccounts: vi.fn().mockResolvedValue([]),
  createGLAccount: vi.fn(),
  updateGLAccount: vi.fn(),
  deleteGLAccount: vi.fn(),
  checkAccountCodeExists: vi.fn().mockResolvedValue(false)
}));

// Helper Types
interface GLAccount {
  id: string;
  code: string;
  name: string;
  name_ar?: string;
  category: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
  normal_balance: 'Debit' | 'Credit';
  parent_code?: string;
  allow_posting: boolean;
  is_active: boolean;
  balance?: number;
}

// ===================== ACCOUNT CODE VALIDATION =====================

describe('Account Code Validation', () => {
  const validateAccountCode = (code: string) => {
    if (!code) return { valid: false, message: 'Code is required' };
    if (code.length < 3) return { valid: false, message: 'Code must be at least 3 characters' };
    if (code.length > 20) return { valid: false, message: 'Code must be at most 20 characters' };
    if (!/^[A-Za-z0-9-]+$/.test(code)) return { valid: false, message: 'Code can only contain letters, numbers, and hyphens' };
    return { valid: true, message: '' };
  };

  it('should fail for empty code', () => {
    const result = validateAccountCode('');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('required');
  });

  it('should fail for short code', () => {
    const result = validateAccountCode('AB');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('3 characters');
  });

  it('should fail for long code', () => {
    const result = validateAccountCode('A'.repeat(25));
    expect(result.valid).toBe(false);
    expect(result.message).toContain('20 characters');
  });

  it('should fail for invalid characters', () => {
    const result = validateAccountCode('ACC@123');
    expect(result.valid).toBe(false);
    expect(result.message).toContain('letters, numbers');
  });

  it('should pass for valid code', () => {
    expect(validateAccountCode('1001').valid).toBe(true);
    expect(validateAccountCode('ACC-001').valid).toBe(true);
    expect(validateAccountCode('Revenue-Sales').valid).toBe(true);
  });
});

// ===================== ACCOUNT HIERARCHY =====================

describe('Account Hierarchy', () => {
  const accounts: GLAccount[] = [
    { id: '1', code: '1000', name: 'Assets', category: 'ASSET', normal_balance: 'Debit', allow_posting: false, is_active: true },
    { id: '2', code: '1100', name: 'Current Assets', category: 'ASSET', normal_balance: 'Debit', parent_code: '1000', allow_posting: false, is_active: true },
    { id: '3', code: '1101', name: 'Cash', category: 'ASSET', normal_balance: 'Debit', parent_code: '1100', allow_posting: true, is_active: true },
    { id: '4', code: '1102', name: 'Bank', category: 'ASSET', normal_balance: 'Debit', parent_code: '1100', allow_posting: true, is_active: true },
    { id: '5', code: '1200', name: 'Fixed Assets', category: 'ASSET', normal_balance: 'Debit', parent_code: '1000', allow_posting: false, is_active: true }
  ];

  const getChildren = (parentCode: string) => {
    return accounts.filter(a => a.parent_code === parentCode);
  };

  const getParent = (account: GLAccount) => {
    if (!account.parent_code) return null;
    return accounts.find(a => a.code === account.parent_code);
  };

  const getAncestors = (account: GLAccount): GLAccount[] => {
    const ancestors: GLAccount[] = [];
    let current: GLAccount | null | undefined = account;
    while (current && current.parent_code) {
      const parent = accounts.find(a => a.code === current!.parent_code);
      if (parent) {
        ancestors.push(parent);
        current = parent;
      } else {
        break;
      }
    }
    return ancestors;
  };

  const getLevel = (account: GLAccount): number => {
    return getAncestors(account).length + 1;
  };

  const getRootAccounts = () => {
    return accounts.filter(a => !a.parent_code);
  };

  it('should get children of parent', () => {
    const children = getChildren('1100');
    expect(children.length).toBe(2);
    expect(children.map(c => c.code)).toContain('1101');
    expect(children.map(c => c.code)).toContain('1102');
  });

  it('should get parent account', () => {
    const cash = accounts.find(a => a.code === '1101')!;
    const parent = getParent(cash);
    expect(parent?.code).toBe('1100');
  });

  it('should return null for root accounts', () => {
    const root = accounts.find(a => a.code === '1000')!;
    expect(getParent(root)).toBeNull();
  });

  it('should get all ancestors', () => {
    const cash = accounts.find(a => a.code === '1101')!;
    const ancestors = getAncestors(cash);
    expect(ancestors.length).toBe(2);
    expect(ancestors.map(a => a.code)).toEqual(['1100', '1000']);
  });

  it('should calculate correct level', () => {
    expect(getLevel(accounts.find(a => a.code === '1000')!)).toBe(1);
    expect(getLevel(accounts.find(a => a.code === '1100')!)).toBe(2);
    expect(getLevel(accounts.find(a => a.code === '1101')!)).toBe(3);
  });

  it('should get root accounts', () => {
    const roots = getRootAccounts();
    expect(roots.length).toBe(1);
    expect(roots[0].code).toBe('1000');
  });
});

// ===================== ACCOUNT CATEGORIES =====================

describe('Account Categories', () => {
  const categories = [
    { code: 'ASSET', name: 'Assets', name_ar: 'الأصول', normal_balance: 'Debit' as const },
    { code: 'LIABILITY', name: 'Liabilities', name_ar: 'الخصوم', normal_balance: 'Credit' as const },
    { code: 'EQUITY', name: 'Equity', name_ar: 'حقوق الملكية', normal_balance: 'Credit' as const },
    { code: 'REVENUE', name: 'Revenue', name_ar: 'الإيرادات', normal_balance: 'Credit' as const },
    { code: 'EXPENSE', name: 'Expenses', name_ar: 'المصروفات', normal_balance: 'Debit' as const }
  ];

  const getCategoryByCode = (code: string) => {
    return categories.find(c => c.code === code);
  };

  const getDefaultNormalBalance = (categoryCode: string) => {
    const category = getCategoryByCode(categoryCode);
    return category?.normal_balance ?? 'Debit';
  };

  const isBalanceSheetCategory = (code: string) => {
    return ['ASSET', 'LIABILITY', 'EQUITY'].includes(code);
  };

  const isIncomeStatementCategory = (code: string) => {
    return ['REVENUE', 'EXPENSE'].includes(code);
  };

  it('should find category by code', () => {
    const category = getCategoryByCode('ASSET');
    expect(category?.name).toBe('Assets');
    expect(category?.name_ar).toBe('الأصول');
  });

  it('should get default normal balance', () => {
    expect(getDefaultNormalBalance('ASSET')).toBe('Debit');
    expect(getDefaultNormalBalance('LIABILITY')).toBe('Credit');
    expect(getDefaultNormalBalance('EXPENSE')).toBe('Debit');
  });

  it('should identify balance sheet categories', () => {
    expect(isBalanceSheetCategory('ASSET')).toBe(true);
    expect(isBalanceSheetCategory('LIABILITY')).toBe(true);
    expect(isBalanceSheetCategory('EQUITY')).toBe(true);
    expect(isBalanceSheetCategory('REVENUE')).toBe(false);
  });

  it('should identify income statement categories', () => {
    expect(isIncomeStatementCategory('REVENUE')).toBe(true);
    expect(isIncomeStatementCategory('EXPENSE')).toBe(true);
    expect(isIncomeStatementCategory('ASSET')).toBe(false);
  });
});

// ===================== BALANCE CALCULATIONS =====================

describe('Balance Calculations', () => {
  interface Transaction {
    account_id: string;
    debit: number;
    credit: number;
  }

  const calculateBalance = (transactions: Transaction[], accountId: string, normalBalance: 'Debit' | 'Credit') => {
    const accountTxns = transactions.filter(t => t.account_id === accountId);
    const totalDebit = accountTxns.reduce((sum, t) => sum + t.debit, 0);
    const totalCredit = accountTxns.reduce((sum, t) => sum + t.credit, 0);
    
    if (normalBalance === 'Debit') {
      return totalDebit - totalCredit;
    }
    return totalCredit - totalDebit;
  };

  const calculateRunningBalance = (transactions: Transaction[], normalBalance: 'Debit' | 'Credit') => {
    let balance = 0;
    return transactions.map(t => {
      if (normalBalance === 'Debit') {
        balance += t.debit - t.credit;
      } else {
        balance += t.credit - t.debit;
      }
      return { ...t, runningBalance: balance };
    });
  };

  const transactions: Transaction[] = [
    { account_id: 'a1', debit: 1000, credit: 0 },
    { account_id: 'a1', debit: 500, credit: 0 },
    { account_id: 'a1', debit: 0, credit: 300 },
    { account_id: 'a2', debit: 0, credit: 1200 }
  ];

  it('should calculate debit balance account', () => {
    const balance = calculateBalance(transactions, 'a1', 'Debit');
    expect(balance).toBe(1200); // 1000 + 500 - 300
  });

  it('should calculate credit balance account', () => {
    const balance = calculateBalance(transactions, 'a2', 'Credit');
    expect(balance).toBe(1200);
  });

  it('should calculate running balance', () => {
    const a1Txns = transactions.filter(t => t.account_id === 'a1');
    const running = calculateRunningBalance(a1Txns, 'Debit');
    expect(running[0].runningBalance).toBe(1000);
    expect(running[1].runningBalance).toBe(1500);
    expect(running[2].runningBalance).toBe(1200);
  });
});

// ===================== TRIAL BALANCE =====================

describe('Trial Balance', () => {
  interface AccountBalance {
    code: string;
    name: string;
    category: string;
    debit_balance: number;
    credit_balance: number;
  }

  const calculateTrialBalance = (accounts: AccountBalance[]) => {
    const totalDebit = accounts.reduce((sum, a) => sum + a.debit_balance, 0);
    const totalCredit = accounts.reduce((sum, a) => sum + a.credit_balance, 0);
    const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01;
    return { totalDebit, totalCredit, isBalanced };
  };

  const groupByCategory = (accounts: AccountBalance[]) => {
    return accounts.reduce((groups, account) => {
      const category = account.category;
      if (!groups[category]) {
        groups[category] = [];
      }
      groups[category].push(account);
      return groups;
    }, {} as Record<string, AccountBalance[]>);
  };

  const accounts: AccountBalance[] = [
    { code: '1001', name: 'Cash', category: 'ASSET', debit_balance: 10000, credit_balance: 0 },
    { code: '1002', name: 'Bank', category: 'ASSET', debit_balance: 25000, credit_balance: 0 },
    { code: '2001', name: 'Accounts Payable', category: 'LIABILITY', debit_balance: 0, credit_balance: 15000 },
    { code: '3001', name: 'Capital', category: 'EQUITY', debit_balance: 0, credit_balance: 20000 }
  ];

  it('should calculate trial balance totals', () => {
    const { totalDebit, totalCredit, isBalanced } = calculateTrialBalance(accounts);
    expect(totalDebit).toBe(35000);
    expect(totalCredit).toBe(35000);
    expect(isBalanced).toBe(true);
  });

  it('should detect unbalanced trial balance', () => {
    const unbalanced: AccountBalance[] = [
      { code: '1001', name: 'Cash', category: 'ASSET', debit_balance: 10000, credit_balance: 0 },
      { code: '2001', name: 'Payable', category: 'LIABILITY', debit_balance: 0, credit_balance: 5000 }
    ];
    const { isBalanced } = calculateTrialBalance(unbalanced);
    expect(isBalanced).toBe(false);
  });

  it('should group accounts by category', () => {
    const groups = groupByCategory(accounts);
    expect(Object.keys(groups).length).toBe(3);
    expect(groups['ASSET'].length).toBe(2);
    expect(groups['LIABILITY'].length).toBe(1);
    expect(groups['EQUITY'].length).toBe(1);
  });
});

// ===================== ACCOUNT SEARCHING =====================

describe('Account Searching', () => {
  const accounts: GLAccount[] = [
    { id: '1', code: '1001', name: 'Cash in Hand', name_ar: 'النقدية', category: 'ASSET', normal_balance: 'Debit', allow_posting: true, is_active: true },
    { id: '2', code: '1002', name: 'Cash in Bank', name_ar: 'النقدية في البنك', category: 'ASSET', normal_balance: 'Debit', allow_posting: true, is_active: true },
    { id: '3', code: '2001', name: 'Accounts Payable', name_ar: 'الذمم الدائنة', category: 'LIABILITY', normal_balance: 'Credit', allow_posting: true, is_active: true },
    { id: '4', code: '4001', name: 'Sales Revenue', name_ar: 'إيراد المبيعات', category: 'REVENUE', normal_balance: 'Credit', allow_posting: true, is_active: true }
  ];

  const searchAccounts = (query: string) => {
    const lower = query.toLowerCase();
    return accounts.filter(a =>
      a.code.toLowerCase().includes(lower) ||
      a.name.toLowerCase().includes(lower) ||
      (a.name_ar && a.name_ar.includes(query))
    );
  };

  const filterByCategory = (category: string) => {
    return accounts.filter(a => a.category === category);
  };

  const filterByPostable = () => {
    return accounts.filter(a => a.allow_posting);
  };

  const filterByActive = () => {
    return accounts.filter(a => a.is_active);
  };

  it('should search by code', () => {
    const results = searchAccounts('1001');
    expect(results.length).toBe(1);
    expect(results[0].name).toBe('Cash in Hand');
  });

  it('should search by name', () => {
    const results = searchAccounts('cash');
    expect(results.length).toBe(2);
  });

  it('should search by Arabic name', () => {
    const results = searchAccounts('النقدية');
    expect(results.length).toBe(2);
  });

  it('should filter by category', () => {
    const assets = filterByCategory('ASSET');
    expect(assets.length).toBe(2);
  });

  it('should filter postable accounts', () => {
    const postable = filterByPostable();
    expect(postable.length).toBe(4);
  });
});

// ===================== ACCOUNT EXPORT =====================

describe('Account Export', () => {
  const accounts: GLAccount[] = [
    { id: '1', code: '1001', name: 'Cash', name_ar: 'النقدية', category: 'ASSET', normal_balance: 'Debit', allow_posting: true, is_active: true, balance: 10000 },
    { id: '2', code: '2001', name: 'Payable', name_ar: 'الدائنون', category: 'LIABILITY', normal_balance: 'Credit', allow_posting: true, is_active: true, balance: 5000 }
  ];

  const formatForExcel = (accounts: GLAccount[]) => {
    return accounts.map(a => ({
      'Account Code': a.code,
      'Account Name': a.name,
      'Account Name (AR)': a.name_ar || '',
      'Category': a.category,
      'Normal Balance': a.normal_balance,
      'Balance': a.balance || 0
    }));
  };

  const formatForPDF = (accounts: GLAccount[]) => {
    return {
      headers: ['Code', 'Name', 'Category', 'Balance'],
      rows: accounts.map(a => [a.code, a.name, a.category, String(a.balance || 0)])
    };
  };

  it('should format for Excel export', () => {
    const formatted = formatForExcel(accounts);
    expect(formatted.length).toBe(2);
    expect(formatted[0]['Account Code']).toBe('1001');
    expect(formatted[0]['Balance']).toBe(10000);
  });

  it('should format for PDF export', () => {
    const formatted = formatForPDF(accounts);
    expect(formatted.headers.length).toBe(4);
    expect(formatted.rows.length).toBe(2);
    expect(formatted.rows[0]).toEqual(['1001', 'Cash', 'ASSET', '10000']);
  });
});

// ===================== ACCOUNT VALIDATION =====================

describe('Account Validation', () => {
  const validateAccount = (account: Partial<GLAccount>) => {
    const errors: string[] = [];

    if (!account.code) errors.push('Account code is required');
    if (!account.name) errors.push('Account name is required');
    if (!account.category) errors.push('Category is required');
    if (!account.normal_balance) errors.push('Normal balance is required');

    // Parent validation
    if (account.parent_code && account.parent_code === account.code) {
      errors.push('Account cannot be its own parent');
    }

    return { valid: errors.length === 0, errors };
  };

  const checkCircularReference = (accountCode: string, parentCode: string, allAccounts: GLAccount[]) => {
    let current = parentCode;
    const visited = new Set<string>();
    
    while (current) {
      if (current === accountCode) return true;
      if (visited.has(current)) return true;
      visited.add(current);
      
      const parent = allAccounts.find(a => a.code === current);
      current = parent?.parent_code || '';
    }
    
    return false;
  };

  it('should validate required fields', () => {
    const result = validateAccount({});
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(4);
  });

  it('should pass valid account', () => {
    const result = validateAccount({
      code: '1001',
      name: 'Cash',
      category: 'ASSET',
      normal_balance: 'Debit'
    });
    expect(result.valid).toBe(true);
  });

  it('should detect self-reference', () => {
    const result = validateAccount({
      code: '1001',
      name: 'Cash',
      category: 'ASSET',
      normal_balance: 'Debit',
      parent_code: '1001'
    });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Account cannot be its own parent');
  });

  it('should detect circular reference', () => {
    const accounts: GLAccount[] = [
      { id: '1', code: '1000', name: 'A', category: 'ASSET', normal_balance: 'Debit', parent_code: '1002', allow_posting: false, is_active: true },
      { id: '2', code: '1001', name: 'B', category: 'ASSET', normal_balance: 'Debit', parent_code: '1000', allow_posting: false, is_active: true },
      { id: '3', code: '1002', name: 'C', category: 'ASSET', normal_balance: 'Debit', parent_code: '1001', allow_posting: false, is_active: true }
    ];

    // This would create a cycle: 1002 -> 1001 -> 1000 -> 1002
    const hasCircular = checkCircularReference('1002', '1001', accounts);
    expect(hasCircular).toBe(true);
  });
});

// ===================== BUDGET COMPARISON =====================

describe('Budget Comparison', () => {
  interface BudgetItem {
    account_id: string;
    budgeted_amount: number;
    actual_amount: number;
  }

  const calculateVariance = (budgeted: number, actual: number) => {
    return actual - budgeted;
  };

  const calculateVariancePercentage = (budgeted: number, actual: number) => {
    if (budgeted === 0) return actual === 0 ? 0 : 100;
    return ((actual - budgeted) / budgeted) * 100;
  };

  const analyzeBudget = (items: BudgetItem[]) => {
    const total = items.reduce(
      (acc, item) => ({
        budgeted: acc.budgeted + item.budgeted_amount,
        actual: acc.actual + item.actual_amount
      }),
      { budgeted: 0, actual: 0 }
    );

    const variance = calculateVariance(total.budgeted, total.actual);
    const variancePercentage = calculateVariancePercentage(total.budgeted, total.actual);

    return {
      totalBudgeted: total.budgeted,
      totalActual: total.actual,
      totalVariance: variance,
      variancePercentage: Math.round(variancePercentage * 100) / 100
    };
  };

  it('should calculate positive variance (over budget)', () => {
    expect(calculateVariance(1000, 1200)).toBe(200);
  });

  it('should calculate negative variance (under budget)', () => {
    expect(calculateVariance(1000, 800)).toBe(-200);
  });

  it('should calculate variance percentage', () => {
    expect(calculateVariancePercentage(1000, 1100)).toBe(10);
    expect(calculateVariancePercentage(1000, 900)).toBe(-10);
  });

  it('should handle zero budget', () => {
    expect(calculateVariancePercentage(0, 0)).toBe(0);
    expect(calculateVariancePercentage(0, 100)).toBe(100);
  });

  it('should analyze complete budget', () => {
    const items: BudgetItem[] = [
      { account_id: 'a1', budgeted_amount: 10000, actual_amount: 9500 },
      { account_id: 'a2', budgeted_amount: 5000, actual_amount: 5500 }
    ];

    const analysis = analyzeBudget(items);
    expect(analysis.totalBudgeted).toBe(15000);
    expect(analysis.totalActual).toBe(15000);
    expect(analysis.totalVariance).toBe(0);
    expect(analysis.variancePercentage).toBe(0);
  });
});

// ===================== PERIOD CLOSING =====================

describe('Period Closing', () => {
  type Period = { year: number; month: number };
  type PeriodStatus = 'open' | 'soft-closed' | 'hard-closed';

  const formatPeriod = (period: Period) => {
    return `${period.year}-${String(period.month).padStart(2, '0')}`;
  };

  const getPreviousPeriod = (period: Period): Period => {
    if (period.month === 1) {
      return { year: period.year - 1, month: 12 };
    }
    return { year: period.year, month: period.month - 1 };
  };

  const getNextPeriod = (period: Period): Period => {
    if (period.month === 12) {
      return { year: period.year + 1, month: 1 };
    }
    return { year: period.year, month: period.month + 1 };
  };

  const canPostToperiod = (status: PeriodStatus) => {
    return status === 'open';
  };

  const canReopenPeriod = (status: PeriodStatus) => {
    return status === 'soft-closed';
  };

  it('should format period correctly', () => {
    expect(formatPeriod({ year: 2024, month: 1 })).toBe('2024-01');
    expect(formatPeriod({ year: 2024, month: 12 })).toBe('2024-12');
  });

  it('should get previous period', () => {
    expect(getPreviousPeriod({ year: 2024, month: 5 })).toEqual({ year: 2024, month: 4 });
    expect(getPreviousPeriod({ year: 2024, month: 1 })).toEqual({ year: 2023, month: 12 });
  });

  it('should get next period', () => {
    expect(getNextPeriod({ year: 2024, month: 5 })).toEqual({ year: 2024, month: 6 });
    expect(getNextPeriod({ year: 2024, month: 12 })).toEqual({ year: 2025, month: 1 });
  });

  it('should check posting permissions', () => {
    expect(canPostToperiod('open')).toBe(true);
    expect(canPostToperiod('soft-closed')).toBe(false);
    expect(canPostToperiod('hard-closed')).toBe(false);
  });

  it('should check reopen permissions', () => {
    expect(canReopenPeriod('soft-closed')).toBe(true);
    expect(canReopenPeriod('hard-closed')).toBe(false);
    expect(canReopenPeriod('open')).toBe(false);
  });
});
