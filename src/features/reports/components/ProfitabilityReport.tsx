import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ReportSkeleton } from '@/components/ui/loading-state';
import { ErrorState } from '@/components/ui/error-state';
import { EmptyState } from '@/components/ui/empty-state';
import { TrendingUp } from 'lucide-react';
import { getGlassClasses } from '@/lib/wardah-ui-utils';
import { fetchProfitability } from '@/services/financial-statements-service';

const fmt = (n: number) =>
  new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

/** تحليل الربحية الحقيقي: إيراد الفواتير مقابل COGS من قيود GL (خريطة sale_delivery). */
export const ProfitabilityReport: React.FC = () => {
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['profitability'],
    queryFn: fetchProfitability,
  });

  if (isLoading) return <ReportSkeleton />;
  if (isError || !data) {
    return (
      <ErrorState
        title="تعذّر تحميل تحليل الربحية"
        message={error instanceof Error ? error.message : String(error ?? 'لا توجد بيانات')}
        onRetry={() => refetch()}
      />
    );
  }

  if (data.revenue === 0 && data.cogs === 0) {
    return (
      <EmptyState
        icon={<TrendingUp className="h-10 w-10" aria-hidden="true" />}
        title="لا توجد بيانات ربحية بعد"
        description="يظهر التحليل بعد تسجيل فواتير مبيعات وقيود تكلفة بضاعة مباعة (تسليم)."
      />
    );
  }

  return (
    <Card className={getGlassClasses()}>
      <CardHeader>
        <CardTitle className="text-right">تحليل الربحية</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={getGlassClasses()}>
              <div className="text-2xl font-bold text-green-600 p-4">{fmt(data.revenue)} ر.س</div>
              <div className="text-sm text-muted-foreground px-4 pb-4">إجمالي الإيرادات (فواتير المبيعات)</div>
            </div>
            <div className={getGlassClasses()}>
              <div className="text-2xl font-bold text-red-600 p-4">{fmt(data.cogs)} ر.س</div>
              <div className="text-sm text-muted-foreground px-4 pb-4">تكلفة البضاعة المباعة (قيود GL)</div>
            </div>
            <div className={getGlassClasses()}>
              <div className={`text-2xl font-bold p-4 ${data.grossProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                {fmt(data.grossProfit)} ر.س
              </div>
              <div className="text-sm text-muted-foreground px-4 pb-4">مجمل الربح</div>
            </div>
          </div>

          <div className={getGlassClasses()}>
            <h3 className="font-medium mb-2 p-4 pb-0 text-right">معدل الربحية</h3>
            <div className="text-3xl font-bold text-center py-4">
              {data.margin === null ? '—' : `${data.margin.toFixed(2)}%`}
            </div>
          </div>

          {data.cogs === 0 && data.revenue > 0 && (
            <p className="text-xs text-muted-foreground text-right">
              ملاحظة شفافية: لا توجد قيود COGS مرحَّلة بعد (تُنشأ تلقائياً عند تسليم
              البضاعة) — مجمل الربح الحالي = الإيراد.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
