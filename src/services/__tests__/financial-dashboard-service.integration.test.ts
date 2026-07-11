/**
 * تغطية إصلاح P9-UI: financialDashboardService يقرأ من products/org_id (لا items/tenant_id).
 * يحاكي سلسلة supabase (thenable في أي نقطة) ويؤكّد حساب قيمة المخزون والتكاليف والمبيعات.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const tableData: Record<string, unknown[]> = {
  sales_orders: [{ id: 's1', order_number: 'SO-1', total_amount: 1000, created_at: '2026-07-01' }],
  purchase_orders: [{ total_amount: 400 }],
  products: [
    { id: 'p1', name: 'A', code: 'A1', stock_quantity: 10, cost_price: 5 }, // 50
    { id: 'p2', name: 'B', code: 'B2', stock_quantity: 20, cost_price: 3 }, // 60
  ],
};

function makeChain(table: string) {
  const result = { data: tableData[table] ?? [], error: null };
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => resolve(result),
  };
  chain.select = () => chain;
  chain.eq = () => chain;
  chain.gte = () => chain;
  chain.lte = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: (t: string) => makeChain(t) }),
  getTenantId: vi.fn(() => Promise.resolve('org-1')),
}));

import { financialDashboardService } from '../financial-dashboard-service';

describe('financialDashboardService — قراءة products/org_id (إصلاح P9-UI)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('fetchFinancialKPIs يحسب قيمة المخزون من products (10×5 + 20×3 = 110)', async () => {
    const kpis = await financialDashboardService.fetchFinancialKPIs();
    expect(kpis.inventoryValue).toBe(110);
    expect(kpis.totalCosts).toBe(400);
    expect(kpis.totalSales).toBe(1000);
  });

  it('fetchTopProducts يقرأ من products ويرجع صفوفاً', async () => {
    const top = await financialDashboardService.fetchTopProducts();
    expect(top).toHaveLength(2);
  });

  it('fetchRecentTransactions يقرأ من sales_orders', async () => {
    const txns = await financialDashboardService.fetchRecentTransactions();
    expect(txns).toHaveLength(1);
  });
});
