/**
 * اختبارات خدمة القوائم المالية — قائمة دخل/ميزانية من أرصدة GL الفعلية بلا تلفيق:
 * السطور غير المطابِقة لشجرة الحسابات تُستبعَد بشفافية، وCOGS من خريطة أحداث
 * COGS_DELIVERY (كانت تُفلتر بـ sale_delivery% الذي لا يرحّل به التسليم ⇒ COGS=0).
 */
import { describe, it, expect, vi } from 'vitest';

const tableData: Record<string, unknown[]> = {
  gl_accounts: [
    { code: '410100', name: 'مبيعات محلية', category: 'REVENUE', normal_balance: 'CREDIT' },
    { code: '544000', name: 'COGS أكياس', category: 'EXPENSE', normal_balance: 'DEBIT' },
    { code: '110300', name: 'ذمم مدينة', category: 'ASSET', normal_balance: 'DEBIT' },
    { code: '210100', name: 'ذمم دائنة', category: 'LIABILITY', normal_balance: 'CREDIT' },
    { code: '330000', name: 'رأس المال', category: 'EQUITY', normal_balance: 'CREDIT' },
  ],
  gl_entry_lines: [
    { account_code: '410100', credit_amount: 5000, debit_amount: 0 },
    { account_code: '544000', debit_amount: 3000, credit_amount: 0, gl_entries: { entry_date: '2026-07-01', status: 'posted' } },
    { account_code: '110300', debit_amount: 5000, credit_amount: 0 },
    { account_code: '210100', credit_amount: 2000, debit_amount: 0 },
    { account_code: '330000', credit_amount: 1000, debit_amount: 0 },
    { account_code: '9999', debit_amount: 777, credit_amount: 0 }, // غير مطابِق ⇒ يُستبعَد
  ],
  gl_mappings: [
    // الحساب الحي 544000 (الافتراضي 511100 غير موجود بشجرة الحسابات الحية)
    { key_value: 'COGS_DELIVERY', debit_account_code: '544000' },
    // خريطة مضبوطة خطأً على حساب غير مصروف — يجب استبعادها من حسابات COGS
    { key_value: 'COGS_DELIVERY', debit_account_code: '110300' },
  ],
  sales_invoices: [
    { total_amount: 5000, status: 'draft' },
    { total_amount: 2000, status: 'draft' },
    { total_amount: 9999, status: 'cancelled' }, // ملغاة ⇒ خارج الإيراد
  ],
};

const valueOf = (r: Record<string, unknown>, col: string): unknown =>
  r[col.includes('.') ? col.split('.').pop()! : col];

function makeChain(table: string) {
  let rows = (tableData[table] ?? []) as Record<string, unknown>[];
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: null, count: rows.length }),
  };
  chain.select = () => chain;
  chain.eq = (col: string, v: unknown) => {
    if (col === 'org_id' || col.endsWith('.org_id')) return chain;
    rows = rows.filter((r) => {
      const embedded = col.includes('.')
        ? (r[col.split('.')[0]] as Record<string, unknown> | undefined)
        : undefined;
      const actual = embedded ? embedded[col.split('.')[1]] : r[col];
      return actual === undefined || actual === v;
    });
    return chain;
  };
  chain.neq = (col: string, v: unknown) => {
    rows = rows.filter((r) => valueOf(r, col) !== v);
    return chain;
  };
  chain.gte = () => chain;
  chain.lte = () => chain;
  chain.like = () => chain;
  chain.not = () => chain;
  chain.in = (col: string, values: string[]) => {
    rows = rows.filter((r) => values.includes(valueOf(r, col) as string));
    return chain;
  };
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => makeChain(t) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}));

import { fetchFinancialStatements, fetchProfitability } from '../financial-statements-service';

describe('fetchFinancialStatements — قوائم من GL الفعلي', () => {
  it('قائمة الدخل: إيراد − مصروف = صافي الدخل', async () => {
    const s = await fetchFinancialStatements();
    expect(s.incomeStatement.revenue).toBe(5000);
    expect(s.incomeStatement.expenses).toBe(3000);
    expect(s.incomeStatement.netIncome).toBe(2000);
  });

  it('الميزانية: أصول/خصوم/حقوق موجَّهة بالرصيد الطبيعي', async () => {
    const s = await fetchFinancialStatements();
    expect(s.balanceSheet.assets).toBe(5000);
    expect(s.balanceSheet.liabilities).toBe(2000);
    expect(s.balanceSheet.equity).toBe(1000);
  });

  it('السطور غير المطابِقة لشجرة الحسابات تُستبعَد وتُحصى بشفافية', async () => {
    const s = await fetchFinancialStatements();
    expect(s.unmatchedLinesCount).toBe(1); // كود 9999
    // 777 لم يدخل في أي تصنيف
    expect(s.incomeStatement.expenses).toBe(3000);
  });
});

describe('fetchProfitability — إيراد الفواتير مقابل COGS من الخريطة', () => {
  it('يحسب الإيراد (بلا ملغاة) وCOGS من حدث COGS_DELIVERY المرحّل ومجمل الربح والهامش', async () => {
    const p = await fetchProfitability();
    expect(p.revenue).toBe(7000);         // 5000+2000 — الفاتورة الملغاة 9999 مستبعدة
    expect(p.cogs).toBe(3000);            // حساب 544000 الحي (من خريطة COGS_DELIVERY)
    expect(p.grossProfit).toBe(4000);
    expect(p.margin).toBeCloseTo((4000 / 7000) * 100);
    expect(p.cogsAccounts).toContain('544000');
    // الخريطة المضبوطة خطأً على حساب أصول (110300) لا تدخل حسابات COGS
    expect(p.cogsAccounts).not.toContain('110300');
  });
});
