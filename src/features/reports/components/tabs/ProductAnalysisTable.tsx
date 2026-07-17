import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { ProductSalesAnalysis } from '@/services/sales-reports-service';

interface ProductAnalysisTableProps {
  readonly productAnalysis: ReadonlyArray<ProductSalesAnalysis>;
  readonly isRTL: boolean;
}

export function ProductAnalysisTable({ productAnalysis, isRTL }: ProductAnalysisTableProps) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.code')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.productName')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.qtySold')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.revenue')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>COGS</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.profit')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.profitMarginPct')}</th>
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
  );
}

