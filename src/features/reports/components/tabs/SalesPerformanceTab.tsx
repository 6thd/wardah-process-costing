import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import type { SalesPerformanceMetrics } from '@/services/sales-reports-service';

interface SalesPerformanceTabProps {
  readonly loading: boolean;
  readonly performance: SalesPerformanceMetrics | null;
  readonly isRTL: boolean;
}

export function SalesPerformanceTab({ loading, performance, isRTL }: SalesPerformanceTabProps) {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">{isRTL ? 'جاري التحميل...' : 'Loading...'}</p>
        </CardContent>
      </Card>
    );
  }

  if (!performance) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {isRTL ? 'لا توجد بيانات' : 'No data available'}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{isRTL ? 'إجمالي المبيعات' : 'Total Sales'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.totalSales.toFixed(2)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{isRTL ? 'عدد الفواتير' : 'Total Invoices'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.totalInvoices}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{isRTL ? 'متوسط قيمة الطلب' : 'Average Order Value'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.averageOrderValue.toFixed(2)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{isRTL ? 'معدل التحصيل' : 'Collection Rate'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.collectionRate.toFixed(2)}%</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{isRTL ? 'إجمالي التحصيلات' : 'Total Collections'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.totalCollections.toFixed(2)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{isRTL ? 'المبلغ المعلق' : 'Outstanding Amount'}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">{performance.outstandingAmount.toFixed(2)}</div>
        </CardContent>
      </Card>
    </div>
  );
}

