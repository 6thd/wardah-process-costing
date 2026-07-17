import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProfitabilityAnalysis } from '@/services/sales-reports-service';

interface ProfitabilityMetricsProps {
  readonly profitability: ProfitabilityAnalysis;
}

export function ProfitabilityMetrics({ profitability }: ProfitabilityMetricsProps) {
  const { t } = useTranslation();
  const metrics = [
    {
      label: t('salesReports.totalRevenue'),
      value: profitability.totalRevenue.toFixed(2),
      color: ''
    },
    {
      label: t('salesReports.totalCOGS'),
      value: profitability.totalCOGS.toFixed(2),
      color: 'text-red-600'
    },
    {
      label: t('salesReports.grossProfit'),
      value: profitability.grossProfit.toFixed(2),
      color: 'text-green-600'
    },
    {
      label: t('salesReports.grossProfitMarginPct'),
      value: `${profitability.grossProfitMargin.toFixed(2)}%`,
      color: ''
    },
    {
      label: t('salesReports.netProfit'),
      value: profitability.netProfit.toFixed(2),
      color: 'text-green-600'
    },
    {
      label: t('salesReports.netProfitMarginPct'),
      value: `${profitability.netProfitMargin.toFixed(2)}%`,
      color: ''
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {metrics.map((metric) => (
        <Card key={metric.label}>
          <CardHeader className="pb-2">
            <CardDescription>{metric.label}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={cn("text-2xl font-bold", metric.color)}>
              {metric.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

