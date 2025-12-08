import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProfitabilityAnalysis } from '@/services/sales-reports-service';

interface ProfitabilityTabProps {
  loading: boolean;
  profitability: ProfitabilityAnalysis | null;
  isRTL: boolean;
}

export function ProfitabilityTab({ loading, profitability, isRTL }: ProfitabilityTabProps) {
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

  if (!profitability) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {isRTL ? 'لا توجد بيانات' : 'No data available'}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'إجمالي الإيرادات' : 'Total Revenue'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{profitability.totalRevenue.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'إجمالي COGS' : 'Total COGS'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{profitability.totalCOGS.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'الربح الإجمالي' : 'Gross Profit'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{profitability.grossProfit.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'هامش الربح الإجمالي %' : 'Gross Profit Margin %'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{profitability.grossProfitMargin.toFixed(2)}%</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'الربح الصافي' : 'Net Profit'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{profitability.netProfit.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>{isRTL ? 'هامش الربح الصافي %' : 'Net Profit Margin %'}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{profitability.netProfitMargin.toFixed(2)}%</div>
          </CardContent>
        </Card>
      </div>

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

