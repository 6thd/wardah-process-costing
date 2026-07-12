import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { ReportSkeleton } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { ShoppingCart } from 'lucide-react';
import { toast } from 'sonner';
import { fetchPurchasingAnalytics } from '@/services/purchasing-analytics-service';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** تحليلات المشتريات: إنفاق حسب المورد + اتجاه شهري + أداء الاستلام. */
export function PurchasingAnalyticsReport() {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['purchasing-analytics'],
    queryFn: fetchPurchasingAnalytics,
  });

  if (isLoading) return <ReportSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="تعذّر تحميل تحليلات المشتريات"
        message={error instanceof Error ? error.message : String(error ?? 'لا توجد بيانات')}
        onRetry={() => refetch()}
      />
    );
  }

  if (data.totalOrders === 0) {
    return (
      <EmptyState
        icon={<ShoppingCart className="h-10 w-10" aria-hidden="true" />}
        title="لا توجد أوامر شراء"
        description="تظهر التحليلات بعد تسجيل أوامر شراء."
      />
    );
  }

  const exportVendorsCSV = () => {
    const csv = [
      ['المورد', 'عدد الأوامر', 'إجمالي الإنفاق'],
      ...data.vendorSpend.map((v) => [v.vendorName, v.ordersCount, v.totalSpend]),
    ].map((row) => row.join(',')).join('\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `vendor_spend_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    toast.success('تم تصدير البيانات');
  };

  return (
    <div className="space-y-6">
      {/* مؤشرات علوية */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">إجمالي الإنفاق</p>
            <p className="text-2xl font-bold">{fmt(data.totalSpend)}</p>
          </CardContent>
        </Card>
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">أوامر الشراء</p>
            <p className="text-2xl font-bold">{data.totalOrders}</p>
          </CardContent>
        </Card>
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">نسبة الاستلام الكامل</p>
            <p className="text-2xl font-bold">
              {data.receiptRate === null ? '—' : `${data.receiptRate.toFixed(1)}%`}
            </p>
          </CardContent>
        </Card>
        <Card className="wardah-glass-card">
          <CardContent className="p-6 text-right">
            <p className="text-sm text-muted-foreground">سندات الاستلام</p>
            <p className="text-2xl font-bold">{data.receiptsCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* إنفاق حسب المورد */}
      <Card className="wardah-glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <Button variant="outline" size="sm" onClick={exportVendorsCSV}>📥 تصدير CSV</Button>
          <CardTitle className="text-right">الإنفاق حسب المورد</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">المورد</TableHead>
                  <TableHead className="text-left">عدد الأوامر</TableHead>
                  <TableHead className="text-left">إجمالي الإنفاق</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.vendorSpend.map((v) => (
                  <TableRow key={v.vendorId}>
                    <TableCell className="text-right">{v.vendorName}</TableCell>
                    <TableCell className="text-left">{v.ordersCount}</TableCell>
                    <TableCell className="text-left font-medium">{fmt(v.totalSpend)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* اتجاه شهري */}
      <Card className="wardah-glass-card">
        <CardHeader>
          <CardTitle className="text-right">المشتريات الشهرية (آخر 6 أشهر)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-right">الشهر</TableHead>
                  <TableHead className="text-left">عدد الأوامر</TableHead>
                  <TableHead className="text-left">القيمة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.monthly.map((m) => (
                  <TableRow key={m.key}>
                    <TableCell className="text-right">{m.label}</TableCell>
                    <TableCell className="text-left">{m.ordersCount}</TableCell>
                    <TableCell className="text-left">{fmt(m.totalValue)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default PurchasingAnalyticsReport;
