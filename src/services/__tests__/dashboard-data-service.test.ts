/**
 * اختبار خدمة بيانات لوحة التحكم الحقيقية — تتحقّق أن المؤشرات تُحسب من مصادر
 * Supabase الفعلية (فواتير/مشتريات/منتجات/GL) لا من بيانات وهمية.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tableData: Record<string, unknown[]> = {
  sales_invoices: [
    { id: 'i1', invoice_number: 'INV-1', total_amount: 1000, invoice_date: '2026-07-01' },
  ],
  purchase_orders: [{ total_amount: 400, created_at: '2026-07-01' }],
  products: [{ stock_quantity: 10, cost_price: 5 }], // 50
  gl_accounts: [
    { code: '4000', category: 'REVENUE', normal_balance: 'CREDIT' },
    { code: '5000', category: 'EXPENSE', normal_balance: 'DEBIT' },
    { code: '1000', category: 'ASSET', normal_balance: 'DEBIT' },
  ],
  gl_entry_lines: [
    { account_code: '4000', credit_amount: 1000, debit_amount: 0 },
    { account_code: '5000', debit_amount: 600, credit_amount: 0 },
    { account_code: '1000', debit_amount: 2500, credit_amount: 0 },
    { account_code: 'ZZZZ', debit_amount: 999, credit_amount: 0 }, // لا يطابق COA ⇒ يُستبعَد
  ],
};

function makeChain(table: string) {
  const result = { data: tableData[table] ?? [], error: null };
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => makeChain(t) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}));

import { fetchRealDashboardData } from '../dashboard-data-service';

describe('fetchRealDashboardData — بيانات حقيقية', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z')); // ثبات الرسم الشهري
  });
  afterEach(() => vi.useRealTimers());

  it('يحسب المبيعات والتكاليف والمخزون ومجمل الربح من المصادر الفعلية', async () => {
    const d = await fetchRealDashboardData();
    expect(d.kpis.totalSales).toBe(1000);
    expect(d.kpis.totalCosts).toBe(400);
    expect(d.kpis.inventoryValue).toBe(50);
    expect(d.kpis.grossProfit).toBe(600);
  });

  it('يشتقّ مؤشرات GL حسب التصنيف (يتجاهل الأكواد غير المطابِقة لشجرة الحسابات)', async () => {
    const d = await fetchRealDashboardData();
    expect(d.kpis.totalAssets).toBe(2500);      // من حساب ASSET
    expect(d.kpis.netProfit).toBe(400);         // REVENUE 1000 − EXPENSE 600 (من GL)
    // كود ZZZZ غير المطابِق لم يُحتسب في أي تصنيف (لا تلفيق)
  });

  it('يبني رسماً شهرياً حقيقياً (لا أرقام مولّدة)', async () => {
    const d = await fetchRealDashboardData();
    expect(d.charts.months).toHaveLength(6);
    expect(d.charts.revenue).toHaveLength(6);
    // إجمالي إيراد الرسم = إجمالي الفواتير (1000) موزَّعاً على الأشهر
    expect(d.charts.revenue.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('أحدث المعاملات من الفواتير الفعلية', async () => {
    const d = await fetchRealDashboardData();
    expect(d.recentTransactions).toHaveLength(1);
  });
});
