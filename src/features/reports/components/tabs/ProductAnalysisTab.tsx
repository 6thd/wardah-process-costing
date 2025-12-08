import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { ProductSalesAnalysis } from '@/services/sales-reports-service';
import { renderLoadingState, renderEmptyState } from '../utils/renderHelpers';

interface ProductAnalysisTabProps {
  loading: boolean;
  productAnalysis: ProductSalesAnalysis[];
  isRTL: boolean;
}

export function ProductAnalysisTab({ loading, productAnalysis, isRTL }: ProductAnalysisTabProps) {
  if (loading) {
    return renderLoadingState(isRTL);
  }

  if (productAnalysis.length === 0) {
    return renderEmptyState(isRTL);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isRTL ? 'تحليل المنتجات' : 'Product Analysis'}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'كود' : 'Code'}</th>
                <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'اسم المنتج' : 'Product Name'}</th>
                <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'الكمية المباعة' : 'Qty Sold'}</th>
                <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'الإيرادات' : 'Revenue'}</th>
                <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'COGS' : 'COGS'}</th>
                <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'الربح' : 'Profit'}</th>
                <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'هامش الربح %' : 'Profit Margin %'}</th>
              </tr>
            </thead>
            <tbody>
              {productAnalysis.map((product) => (
                <tr key={product.productId} className="border-b hover:bg-muted/50">
                  <td className="p-2">{product.productCode}</td>
                  <td className="p-2">{isRTL ? (product.productNameAr || product.productName) : product.productName}</td>
                  <td className="p-2">{product.totalQuantitySold}</td>
                  <td className="p-2">{product.totalRevenue.toFixed(2)}</td>
                  <td className="p-2">{product.totalCOGS.toFixed(2)}</td>
                  <td className="p-2 text-green-600">{product.totalProfit.toFixed(2)}</td>
                  <td className="p-2">{product.profitMargin.toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

