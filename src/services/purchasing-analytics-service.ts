/**
 * خدمة تحليلات المشتريات — إنفاق حسب المورد، اتجاه شهري، وأداء الاستلام
 * من الجداول الفعلية (purchase_orders / goods_receipts / vendors). org-scoped،
 * وبلا تلفيق: غياب البيانات يظهر صفراً/فراغاً صادقاً.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase';

export interface VendorSpend {
  vendorId: string;
  vendorName: string;
  ordersCount: number;
  totalSpend: number;
}

export interface MonthlyPurchases {
  key: string;   // YYYY-MM
  label: string; // اسم الشهر
  ordersCount: number;
  totalValue: number;
}

export interface PurchasingAnalytics {
  totalSpend: number;
  totalOrders: number;
  receivedOrders: number;      // fully_received
  receiptRate: number | null;  // نسبة الاستلام % — null عند غياب أوامر (لا تلفيق)
  vendorSpend: VendorSpend[];  // مرتّبة تنازلياً بالإنفاق
  monthly: MonthlyPurchases[]; // آخر 6 أشهر تصاعدياً
  receiptsCount: number;       // سندات استلام مسجَّلة
}

interface PORow {
  vendor_id: string | null;
  total_amount: number | null;
  status: string | null;
  created_at: string | null;
  vendor?: { name?: string | null } | null;
}

const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
  'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** آخر n أشهر {key, label} تصاعدياً. */
export function lastMonthKeys(n: number, now = new Date()): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: AR_MONTHS[d.getMonth()],
    });
  }
  return out;
}

/** تجميع أوامر الشراء حسب المورد — تنازلياً بالإنفاق. */
export function aggregateVendorSpend(orders: PORow[]): VendorSpend[] {
  const byVendor = new Map<string, VendorSpend>();
  for (const o of orders) {
    const id = o.vendor_id ?? 'unknown';
    const existing = byVendor.get(id) ?? {
      vendorId: id,
      vendorName: o.vendor?.name || 'مورد غير محدد',
      ordersCount: 0,
      totalSpend: 0,
    };
    existing.ordersCount += 1;
    existing.totalSpend += o.total_amount || 0;
    byVendor.set(id, existing);
  }
  return [...byVendor.values()].sort((a, b) => b.totalSpend - a.totalSpend);
}

/** تجميع شهري لآخر 6 أشهر. */
export function aggregateMonthly(orders: PORow[], now = new Date()): MonthlyPurchases[] {
  const months = lastMonthKeys(6, now);
  const byKey = new Map<string, { count: number; value: number }>();
  for (const o of orders) {
    const key = o.created_at ? o.created_at.slice(0, 7) : '';
    const agg = byKey.get(key) ?? { count: 0, value: 0 };
    agg.count += 1;
    agg.value += o.total_amount || 0;
    byKey.set(key, agg);
  }
  return months.map((m) => ({
    key: m.key,
    label: m.label,
    ordersCount: byKey.get(m.key)?.count ?? 0,
    totalValue: byKey.get(m.key)?.value ?? 0,
  }));
}

/** تحليلات المشتريات الكاملة (org-scoped). */
export async function fetchPurchasingAnalytics(): Promise<PurchasingAnalytics> {
  const orgId = await getEffectiveTenantId();
  if (!orgId) throw new Error('تعذّر تحديد هوية المؤسسة');

  const [poRes, receiptsRes] = await Promise.all([
    supabase.from('purchase_orders')
      .select('vendor_id, total_amount, status, created_at, vendor:vendors(name)')
      .eq('org_id', orgId),
    supabase.from('goods_receipts')
      .select('id', { count: 'exact', head: true })
      .eq('org_id', orgId),
  ]);

  const orders = (poRes.data ?? []) as PORow[];
  const totalOrders = orders.length;
  const receivedOrders = orders.filter((o) => o.status === 'fully_received').length;

  return {
    totalSpend: orders.reduce((s, o) => s + (o.total_amount || 0), 0),
    totalOrders,
    receivedOrders,
    receiptRate: totalOrders > 0 ? (receivedOrders / totalOrders) * 100 : null,
    vendorSpend: aggregateVendorSpend(orders),
    monthly: aggregateMonthly(orders),
    receiptsCount: receiptsRes.count ?? 0,
  };
}
