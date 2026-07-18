import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import type { CustomerSalesAnalysis } from '@/services/sales-reports-service';

interface CustomerAnalysisTableProps {
  readonly customerAnalysis: CustomerSalesAnalysis[];
  readonly isRTL: boolean;
}

export function CustomerAnalysisTable({ customerAnalysis, isRTL }: CustomerAnalysisTableProps) {
  const { t } = useTranslation();
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.code')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.customerName')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.totalSales')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.invoices')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.avgInvoice')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.outstanding')}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{t('salesReports.collectionRatePct')}</th>
          </tr>
        </thead>
        <tbody>
          {customerAnalysis.map((customer) => (
            <tr key={customer.customerId} className="border-b hover:bg-muted/50">
              <td className="p-2">{customer.customerCode}</td>
              <td className="p-2">{isRTL ? (customer.customerNameAr || customer.customerName) : customer.customerName}</td>
              <td className="p-2">{customer.totalSales.toFixed(2)}</td>
              <td className="p-2">{customer.totalInvoices}</td>
              <td className="p-2">{customer.averageInvoiceValue.toFixed(2)}</td>
              <td className="p-2 text-orange-600">{customer.outstandingAmount.toFixed(2)}</td>
              <td className="p-2">{customer.collectionRate.toFixed(2)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

