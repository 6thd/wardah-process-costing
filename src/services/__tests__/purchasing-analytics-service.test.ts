/**
 * اختبارات خدمة تحليلات المشتريات — تجميع حسب المورد/الشهر ونسبة الاستلام
 * من بيانات فعلية، وبلا تلفيق (لا أوامر ⇒ نسبة null).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const tableData: Record<string, unknown[]> = {
  purchase_orders: [
    { vendor_id: 'v1', total_amount: 1000, status: 'fully_received', created_at: '2026-07-01T00:00:00Z', vendor: { name: 'مورد أ' } },
    { vendor_id: 'v1', total_amount: 500, status: 'draft', created_at: '2026-07-05T00:00:00Z', vendor: { name: 'مورد أ' } },
    { vendor_id: 'v2', total_amount: 2000, status: 'draft', created_at: '2026-06-15T00:00:00Z', vendor: { name: 'مورد ب' } },
  ],
  goods_receipts: [{ id: 'r1' }, { id: 'r2' }],
};

function makeChain(table: string) {
  const rows = tableData[table] ?? [];
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) =>
      resolve({ data: rows, error: null, count: rows.length }),
  };
  chain.select = () => chain;
  chain.eq = () => chain;
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (t: string) => makeChain(t) },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}));

import {
  fetchPurchasingAnalytics,
  aggregateVendorSpend,
  aggregateMonthly,
} from '../purchasing-analytics-service';

describe('fetchPurchasingAnalytics — بيانات فعلية', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('يجمع الإنفاق والأوامر ونسبة الاستلام وسندات الاستلام', async () => {
    const a = await fetchPurchasingAnalytics();
    expect(a.totalSpend).toBe(3500);
    expect(a.totalOrders).toBe(3);
    expect(a.receivedOrders).toBe(1);
    expect(a.receiptRate).toBeCloseTo((1 / 3) * 100);
    expect(a.receiptsCount).toBe(2);
  });

  it('إنفاق الموردين مرتّب تنازلياً', async () => {
    const a = await fetchPurchasingAnalytics();
    expect(a.vendorSpend[0]).toMatchObject({ vendorName: 'مورد ب', totalSpend: 2000, ordersCount: 1 });
    expect(a.vendorSpend[1]).toMatchObject({ vendorName: 'مورد أ', totalSpend: 1500, ordersCount: 2 });
  });

  it('التجميع الشهري يوزّع القيم على أشهرها', async () => {
    const a = await fetchPurchasingAnalytics();
    expect(a.monthly).toHaveLength(6);
    const july = a.monthly.find((m) => m.key === '2026-07');
    const june = a.monthly.find((m) => m.key === '2026-06');
    expect(july).toMatchObject({ ordersCount: 2, totalValue: 1500 });
    expect(june).toMatchObject({ ordersCount: 1, totalValue: 2000 });
  });
});

describe('الدوال الصافية', () => {
  it('aggregateVendorSpend: مورد مجهول يُجمَّع تحت «مورد غير محدد»', () => {
    const rows = aggregateVendorSpend([
      { vendor_id: null, total_amount: 100, status: 'draft', created_at: null, vendor: null },
    ]);
    expect(rows[0].vendorName).toBe('مورد غير محدد');
    expect(rows[0].totalSpend).toBe(100);
  });

  it('aggregateMonthly: أشهر بلا أوامر تظهر بصفر صادق', () => {
    const months = aggregateMonthly([], new Date('2026-07-15T00:00:00Z'));
    expect(months).toHaveLength(6);
    expect(months.every((m) => m.ordersCount === 0 && m.totalValue === 0)).toBe(true);
  });
});
