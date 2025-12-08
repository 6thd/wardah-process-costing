import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProfitabilityAnalysis } from '@/services/sales-reports-service';
import { renderLoadingState, renderEmptyState } from '../utils/renderHelpers';
import { ProfitabilityMetrics } from './ProfitabilityMetrics';

interface ProfitabilityTabProps {
  loading: boolean;
  profitability: ProfitabilityAnalysis | null;
  isRTL: boolean;
}

export function ProfitabilityTab({ loading, profitability, isRTL }: ProfitabilityTabProps) {
  if (loading) {
    return renderLoadingState(isRTL);
  }

  if (!profitability) {
    return renderEmptyState(isRTL);
  }

  return (
    <div className="space-y-4">
      <ProfitabilityMetrics profitability={profitability} isRTL={isRTL} />

      {profitability.byCustomer.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{isRTL ? 'أفضل العملاء حسب الربحية' : 'Top Customers by Profitability'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'اسم العميل' : 'Customer Name'}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'المبيعات' : 'Sales'}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'معدل التحصيل %' : 'Collection Rate %'}</th>
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
            <CardTitle>{isRTL ? 'أفضل المنتجات حسب الربحية' : 'Top Products by Profitability'}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'اسم المنتج' : 'Product Name'}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'الإيرادات' : 'Revenue'}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'الربح' : 'Profit'}</th>
                    <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'هامش الربح %' : 'Profit Margin %'}</th>
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
    </div>
  );
}

