/**
 * اختبار خدمة بيانات لوحة التحكم الحقيقية — تتحقّق أن المؤشرات تُحسب من مصادر
 * Supabase الفعلية (فواتير غير ملغاة/COGS من GL المرحّل/منتجات) لا من بيانات
 * وهمية — «التكاليف» لم تعد أوامر الشراء بل COGS الفعلي بتاريخ القيد.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tableData: Record<string, unknown[]> = {
  sales_invoices: [
    { id: 'i1', invoice_number: 'INV-1', total_amount: 1000, invoice_date: '2026-07-01', status: 'draft' },
    { id: 'i2', invoice_number: 'INV-2', total_amount: 5555, invoice_date: '2026-07-02', status: 'cancelled' },
  ],
  products: [{ stock_quantity: 10, cost_price: 5 }], // 50
  gl_accounts: [
    { code: '4000', category: 'REVENUE', normal_balance: 'CREDIT' },
    { code: '544000', category: 'EXPENSE', normal_balance: 'DEBIT' },
    { code: '1000', category: 'ASSET', normal_balance: 'DEBIT' },
  ],
  gl_event_mappings: [{ event_code: 'COGS_DELIVERY', debit_account_code: '544000', is_active: true }],
  gl_entry_lines: [
    { account_code: '4000', credit_amount: 1000, debit_amount: 0 },
    // سطر COGS مرحّل — هو «التكاليف» في اللوحة الآن (كانت أوامر الشراء 400)
    { account_code: '544000', debit_amount: 600, credit_amount: 0, gl_entries: { entry_date: '2026-07-03', status: 'posted' } },
    { account_code: '1000', debit_amount: 2500, credit_amount: 0 },
    { account_code: 'ZZZZ', debit_amount: 999, credit_amount: 0 }, // لا يطابق COA ⇒ يُستبعَد
  ],
  manufacturing_orders: [{ id: 'mo1' }, { id: 'mo2' }],
  purchase_orders: [{ id: 'po1' }],
  customers: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }],
  vendors: [{ id: 'v1' }],
};

const valueOf = (r: Record<string, unknown>, col: string): unknown => {
  if (col.includes('.')) {
    const [emb, field] = col.split('.');
    return (r[emb] as Record<string, unknown> | undefined)?.[field];
  }
  return r[col];
};

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
      const actual = valueOf(r, col);
      return actual === undefined || actual === v;
    });
    return chain;
  };
  chain.neq = (col: string, v: unknown) => {
    rows = rows.filter((r) => valueOf(r, col) !== v);
    return chain;
  };
  chain.in = (col: string, values: string[]) => {
    rows = rows.filter((r) => values.includes(valueOf(r, col) as string));
    return chain;
  };
  chain.not = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => makeChain(t) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}));

import { fetchRealDashboardData, fetchOperationalCounts } from '../dashboard-data-service';

describe('fetchRealDashboardData — بيانات حقيقية', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z')); // ثبات الرسم الشهري
  });
  afterEach(() => vi.useRealTimers());

  it('يحسب المبيعات (بلا ملغاة) وCOGS من GL والمخزون ومجمل الربح', async () => {
    const d = await fetchRealDashboardData();
    expect(d.kpis.totalSales).toBe(1000);   // الفاتورة الملغاة 5555 مستبعدة
    expect(d.kpis.totalCosts).toBe(600);    // COGS من GL المرحّل — لم يعد أوامر الشراء
    expect(d.kpis.inventoryValue).toBe(50);
    expect(d.kpis.grossProfit).toBe(400);   // 1000 − 600
  });

  it('يشتقّ مؤشرات GL حسب التصنيف (يتجاهل الأكواد غير المطابِقة لشجرة الحسابات)', async () => {
    const d = await fetchRealDashboardData();
    expect(d.kpis.totalAssets).toBe(2500);      // من حساب ASSET
    expect(d.kpis.netProfit).toBe(400);         // REVENUE 1000 − EXPENSE 600 (من GL)
    // كود ZZZZ غير المطابِق لم يُحتسب في أي تصنيف (لا تلفيق)
  });

  it('يبني رسماً شهرياً حقيقياً (لا أرقام مولّدة) — مبيعات بتاريخ الفاتورة وCOGS بتاريخ القيد', async () => {
    const d = await fetchRealDashboardData();
    expect(d.charts.months).toHaveLength(6);
    expect(d.charts.revenue).toHaveLength(6);
    // إجمالي إيراد الرسم = إجمالي الفواتير غير الملغاة (1000)
    expect(d.charts.revenue.reduce((a, b) => a + b, 0)).toBe(1000);
    // إجمالي تكاليف الرسم = COGS المرحّل (600) بتاريخ entry_date
    expect(d.charts.costs.reduce((a, b) => a + b, 0)).toBe(600);
  });

  it('أحدث المعاملات من الفواتير الفعلية', async () => {
    const d = await fetchRealDashboardData();
    expect(d.recentTransactions).toHaveLength(1);
  });
});

describe('fetchOperationalCounts — عدّادات تشغيلية حقيقية', () => {
  it('يعيد عدّادات من الجداول الفعلية (count فقط)', async () => {
    const c = await fetchOperationalCounts();
    expect(c.activeManufacturingOrders).toBe(2); // من manufacturing_orders
    expect(c.pendingPurchaseOrders).toBe(1);     // من purchase_orders
    expect(c.totalCustomers).toBe(3);
    expect(c.totalVendors).toBe(1);
  });
});
