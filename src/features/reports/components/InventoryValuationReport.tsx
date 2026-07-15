import { useQuery } from '@tanstack/react-query';
import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { ReportSkeleton } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { Package } from 'lucide-react';

interface ProductRow {
  id: string;
  code: string | null;
  name: string | null;
  stock_quantity: number | null;
  cost_price: number | null;
}

/** تقرير تقييم المخزون: قيمة كل منتج = الكمية × تكلفة الوحدة، من products (org-scoped). */
async function fetchInventoryValuation(orgId: string): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, code, name, stock_quantity, cost_price')
    .eq('org_id', orgId)
    .order('stock_quantity', { ascending: false });

  if (error) throw new Error(error.message ?? 'فشل جلب بيانات المخزون');
  return (data ?? []) as ProductRow[];
}

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export function InventoryValuationReport() {
  // هوية المؤسسة أولاً، ثم مفتاح استعلام معزول بها (لا تسرّب كاش عبر تبديل المؤسسة)
  const { data: orgId, isLoading: orgLoading } = useQuery({
    queryKey: ['effective-org-id'],
    queryFn: () => getEffectiveTenantId(),
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['inventory-valuation', orgId],
    queryFn: () => fetchInventoryValuation(orgId as string),
    enabled: !!orgId,
  });

  if (orgLoading) return <ReportSkeleton />;
  if (!orgId) {
    return <ErrorState title="تعذّر تحميل تقرير تقييم المخزون" message="تعذّر تحديد هوية المؤسسة" />;
  }
  if (isLoading) return <ReportSkeleton />;
  if (isError) {
    return (
      <ErrorState
        title="تعذّر تحميل تقرير تقييم المخزون"
        message={error instanceof Error ? error.message : String(error)}
        onRetry={() => refetch()}
      />
    );
  }

  const rows = data ?? [];
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Package className="h-10 w-10" aria-hidden="true" />}
        title="لا توجد منتجات"
        description="لم تُسجَّل منتجات في المخزون بعد."
      />
    );
  }

  const grandTotal = rows.reduce(
    (sum, r) => sum + (r.stock_quantity ?? 0) * (r.cost_price ?? 0),
    0,
  );
  const totalQty = rows.reduce((sum, r) => sum + (r.stock_quantity ?? 0), 0);

  return (
    <Card className="wardah-glass-card">
      <CardHeader>
        <CardTitle className="text-right wardah-text-gradient-google">
          تقرير تقييم المخزون
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">الرمز</TableHead>
                <TableHead className="text-right">المنتج</TableHead>
                <TableHead className="text-start">الكمية</TableHead>
                <TableHead className="text-start">تكلفة الوحدة</TableHead>
                <TableHead className="text-start">قيمة المخزون</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="text-right font-mono text-xs">{r.code ?? '—'}</TableCell>
                  <TableCell className="text-right">{r.name ?? '—'}</TableCell>
                  <TableCell className="text-start">{fmt(r.stock_quantity ?? 0)}</TableCell>
                  <TableCell className="text-start">{fmt(r.cost_price ?? 0)}</TableCell>
                  <TableCell className="text-start font-medium">
                    {fmt((r.stock_quantity ?? 0) * (r.cost_price ?? 0))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell className="text-right font-bold" colSpan={2}>
                  الإجمالي ({rows.length} منتجاً)
                </TableCell>
                <TableCell className="text-start font-bold">{fmt(totalQty)}</TableCell>
                <TableCell />
                <TableCell className="text-start font-bold">{fmt(grandTotal)} ريال</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}

export default InventoryValuationReport;
