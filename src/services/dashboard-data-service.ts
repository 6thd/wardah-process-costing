/**
 * Dashboard Data Service — بيانات لوحة التحكم المالية من مصادر حقيقية (Supabase).
 * يحلّ محلّ الـ mock proxy (/api/data/financial/dashboard) الذي كان يُرجع بيانات وهمية
 * ولا يعمل في الإنتاج. كل الأرقام محسوبة من بيانات المؤسسة الفعلية — بلا تقديرات
 * مفبركة. مؤشرات الميزانية (أصول/خصوم/حقوق) تُشتقّ من أرصدة GL حسب التصنيف عندما
 * تتطابق شجرة الحسابات؛ وإلا تظهر 0 (لا رقم مفبرك).
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export interface FinancialKPIs {
  totalSales: number;
  totalCosts: number;
  netProfit: number;
  grossProfit: number;
  inventoryValue: number;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  profitMargin: number;
  revenueGrowth: number;
  operationalEfficiency: number;
}

export interface ChartData {
  revenue: number[];
  costs: number[];
  profit: number[];
  months: string[];
}

export interface DashboardData {
  kpis: FinancialKPIs;
  charts: ChartData;
  recentTransactions: unknown[];
  topProducts: unknown[];
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const sum = <T>(rows: T[] | null | undefined, pick: (r: T) => number): number =>
  (rows ?? []).reduce((s, r) => s + (pick(r) || 0), 0);

/** أرصدة GL مجمّعة حسب تصنيف الحساب (تحترم اتجاه الرصيد الطبيعي). */
async function fetchCategoryBalances(orgId: string): Promise<Record<string, number>> {
  const [{ data: accounts }, { data: lines }] = await Promise.all([
    supabase.from('gl_accounts').select('code, category, normal_balance').eq('org_id', orgId),
    supabase.from('gl_entry_lines').select('account_code, debit_amount, credit_amount, debit, credit').eq('org_id', orgId),
  ]);

  const meta = new Map<string, { category: string; normal: string }>();
  for (const a of accounts ?? []) {
    meta.set((a as { code: string }).code, {
      category: (a as { category: string }).category,
      normal: (a as { normal_balance: string }).normal_balance,
    });
  }

  const balances: Record<string, number> = {};
  for (const l of lines ?? []) {
    const line = l as { account_code: string; debit_amount?: number; credit_amount?: number; debit?: number; credit?: number };
    const m = meta.get(line.account_code);
    if (!m) continue; // لا يطابق شجرة الحسابات ⇒ يُستبعَد (لا تلفيق)
    const debit = line.debit_amount ?? line.debit ?? 0;
    const credit = line.credit_amount ?? line.credit ?? 0;
    const signed = m.normal === 'DEBIT' ? debit - credit : credit - debit;
    balances[m.category] = (balances[m.category] ?? 0) + signed;
  }
  return balances;
}

/** آخر N شهراً بصيغة {key:'YYYY-MM', label:'اسم الشهر'} تصاعدياً. */
function lastMonths(n: number): { key: string; label: string; start: Date }[] {
  const out: { key: string; label: string; start: Date }[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: AR_MONTHS[d.getMonth()],
      start: d,
    });
  }
  return out;
}

const monthKey = (iso: string | null | undefined): string => (iso ? iso.slice(0, 7) : '');

interface DatedAmount { total_amount: number; date: string }

/** يجمّع المبالغ حسب الشهر ويعيد مصفوفة بطول أشهر الرسم. */
function sumByMonth(items: DatedAmount[], months: { key: string }[]): number[] {
  const byMonth = new Map<string, number>();
  for (const it of items) {
    const k = monthKey(it.date);
    byMonth.set(k, (byMonth.get(k) ?? 0) + (it.total_amount || 0));
  }
  return months.map((m) => byMonth.get(m.key) ?? 0);
}

/** يبني مؤشرات KPI من الإجماليات وأرصدة GL (بلا تلفيق). */
function buildKpis(
  totalSales: number, totalCosts: number, inventoryValue: number,
  balances: Record<string, number>,
): FinancialKPIs {
  const grossProfit = totalSales - totalCosts;
  const totalAssets = balances.ASSET ?? 0;
  const totalLiabilities = balances.LIABILITY ?? 0;
  const revenueGL = balances.REVENUE ?? 0;
  const expenseGL = balances.EXPENSE ?? 0;
  const equity = balances.EQUITY ?? (totalAssets - totalLiabilities);
  const netProfit = (revenueGL !== 0 || expenseGL !== 0) ? revenueGL - expenseGL : grossProfit;
  return {
    totalSales, totalCosts, netProfit, grossProfit, inventoryValue,
    totalAssets, totalLiabilities, equity,
    profitMargin: totalSales > 0 ? (netProfit / totalSales) * 100 : 0,
    revenueGrowth: 0,          // نمو الإيراد: يتطلب فترة مقارنة — 0 (لا تلفيق)
    operationalEfficiency: totalSales > 0 ? (grossProfit / totalSales) * 100 : 0,
  };
}

export interface OperationalCounts {
  activeManufacturingOrders: number;
  pendingPurchaseOrders: number;
  totalCustomers: number;
  totalVendors: number;
}

/** عدّادات تشغيلية حقيقية (org-scoped) للوحة التحكم — count فقط بلا جلب صفوف. */
export async function fetchOperationalCounts(): Promise<OperationalCounts> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  const countRows = async (table: string, notInStatuses?: string[]): Promise<number> => {
    let q = supabase.from(table).select('id', { count: 'exact', head: true }).eq('org_id', orgId);
    if (notInStatuses?.length) {
      q = q.not('status', 'in', `(${notInStatuses.join(',')})`);
    }
    const { count } = await q;
    return count ?? 0;
  };

  const [activeManufacturingOrders, pendingPurchaseOrders, totalCustomers, totalVendors] =
    await Promise.all([
      countRows('manufacturing_orders', ['cancelled', 'completed', 'done']),
      countRows('purchase_orders', ['fully_received', 'cancelled', 'closed']),
      countRows('customers'),
      countRows('vendors'),
    ]);

  return { activeManufacturingOrders, pendingPurchaseOrders, totalCustomers, totalVendors };
}

/** بيانات لوحة التحكم المالية الكاملة من مصادر حقيقية (org-scoped). */
export async function fetchRealDashboardData(): Promise<DashboardData> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  const [invoicesRes, poRes, productsRes, recentRes, balances] = await Promise.all([
    supabase.from('sales_invoices').select('total_amount, invoice_date').eq('org_id', orgId),
    supabase.from('purchase_orders').select('total_amount, created_at').eq('org_id', orgId),
    supabase.from('products').select('stock_quantity, cost_price').eq('org_id', orgId),
    supabase.from('sales_invoices')
      .select('id, invoice_number, total_amount, invoice_date, customer:customers(name)')
      .eq('org_id', orgId).order('invoice_date', { ascending: false }).limit(5),
    fetchCategoryBalances(orgId),
  ]);

  const invoices = (invoicesRes.data ?? []) as { total_amount: number; invoice_date: string }[];
  const purchases = (poRes.data ?? []) as { total_amount: number; created_at: string }[];

  const totalSales = sum(invoices, (r) => r.total_amount);
  const totalCosts = sum(purchases, (r) => r.total_amount);
  const inventoryValue = sum(
    (productsRes.data ?? []) as { stock_quantity: number; cost_price: number }[],
    (r) => (r.stock_quantity || 0) * (r.cost_price || 0),
  );

  // رسم شهري حقيقي (آخر 6 أشهر) من الفواتير والمشتريات
  const months = lastMonths(6);
  const revenue = sumByMonth(invoices.map((i) => ({ total_amount: i.total_amount, date: i.invoice_date })), months);
  const costs = sumByMonth(purchases.map((p) => ({ total_amount: p.total_amount, date: p.created_at })), months);

  return {
    kpis: buildKpis(totalSales, totalCosts, inventoryValue, balances),
    charts: {
      revenue, costs,
      profit: revenue.map((r, i) => r - costs[i]),
      months: months.map((m) => m.label),
    },
    recentTransactions: recentRes.data ?? [],
    topProducts: [],
  };
}
