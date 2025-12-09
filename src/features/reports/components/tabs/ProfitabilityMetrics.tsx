import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProfitabilityAnalysis } from '@/services/sales-reports-service';

interface ProfitabilityMetricsProps {
  readonly profitability: ProfitabilityAnalysis;
  readonly isRTL: boolean;
}

export function ProfitabilityMetrics({ profitability, isRTL }: ProfitabilityMetricsProps) {
  const metrics = [
    {
      label: isRTL ? 'إجمالي الإيرادات' : 'Total Revenue',
      value: profitability.totalRevenue.toFixed(2),
      color: ''
    },
    {
      label: isRTL ? 'إجمالي COGS' : 'Total COGS',
      value: profitability.totalCOGS.toFixed(2),
      color: 'text-red-600'
    },
    {
      label: isRTL ? 'الربح الإجمالي' : 'Gross Profit',
      value: profitability.grossProfit.toFixed(2),
      color: 'text-green-600'
    },
    {
      label: isRTL ? 'هامش الربح الإجمالي %' : 'Gross Profit Margin %',
      value: `${profitability.grossProfitMargin.toFixed(2)}%`,
      color: ''
    },
    {
      label: isRTL ? 'الربح الصافي' : 'Net Profit',
      value: profitability.netProfit.toFixed(2),
      color: 'text-green-600'
    },
    {
      label: isRTL ? 'هامش الربح الصافي %' : 'Net Profit Margin %',
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

