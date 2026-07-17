import { useTranslation } from 'react-i18next';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProfitabilityAnalysis } from '@/services/sales-reports-service';

interface ProfitabilityTablesProps {
  readonly profitability: ProfitabilityAnalysis;
  readonly isRTL: boolean;
}

// eslint-disable-next-line complexity
export function ProfitabilityTables({ profitability, isRTL }: ProfitabilityTablesProps) {
  const { t } = useTranslation();
  return (
    <>
      {profitability.byCustomer.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('salesReports.topCustomers')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.customerName')}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.sales')}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.collectionRatePct')}</th>
                  </tr>
                </thead>
                <tbody>
                  {profitability.byCustomer.slice(0, 10).map((customer) => (
                    <tr key={customer.customerId} className="border-b hover:bg-muted/50">
                      <td className="p-2">{isRTL ? (customer.customerNameAr || customer.customerName) : customer.customerName}</td>
                      <td className="p-2">{customer.totalSales.toFixed(2)}</td>
                      <td className="p-2">{customer.collectionRate.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {profitability.byProduct.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('salesReports.topProducts')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.productName')}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.revenue')}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.profit')}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.profitMarginPct')}</th>
                  </tr>
                </thead>
                <tbody>
                  {profitability.byProduct.slice(0, 10).map((product) => (
                    <tr key={product.productId} className="border-b hover:bg-muted/50">
                      <td className="p-2">{isRTL ? (product.productNameAr || product.productName) : product.productName}</td>
                      <td className="p-2">{product.totalRevenue.toFixed(2)}</td>
                      <td className="p-2 text-green-600">{product.totalProfit.toFixed(2)}</td>
                      <td className="p-2">{product.profitMargin.toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

