import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import type { SalesPerformanceMetrics } from '@/services/sales-reports-service';

interface SalesPerformanceTabProps {
  readonly loading: boolean;
  readonly performance: SalesPerformanceMetrics | null;
}

export function SalesPerformanceTab({ loading, performance }: SalesPerformanceTabProps) {
  const { t } = useTranslation();
  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-muted-foreground">{t('salesReports.loading')}</p>
        </CardContent>
      </Card>
    );
  }

  if (!performance) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {t('salesReports.noData')}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{t('salesReports.totalSales')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.totalSales.toFixed(2)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{t('salesReports.totalInvoices')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.totalInvoices}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{t('salesReports.avgOrderValue')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.averageOrderValue.toFixed(2)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{t('salesReports.collectionRate')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.collectionRate.toFixed(2)}%</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{t('salesReports.totalCollections')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{performance.totalCollections.toFixed(2)}</div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{t('salesReports.outstandingAmount')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold text-orange-600">{performance.outstandingAmount.toFixed(2)}</div>
        </CardContent>
      </Card>
    </div>
  );
}

