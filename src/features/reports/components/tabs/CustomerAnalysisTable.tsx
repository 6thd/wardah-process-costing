import { cn } from '@/lib/utils';
import type { CustomerSalesAnalysis } from '@/services/sales-reports-service';

interface CustomerAnalysisTableProps {
  customerAnalysis: CustomerSalesAnalysis[];
  isRTL: boolean;
}

export function CustomerAnalysisTable({ customerAnalysis, isRTL }: CustomerAnalysisTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b">
            <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'كود' : 'Code'}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'اسم العميل' : 'Customer Name'}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'إجمالي المبيعات' : 'Total Sales'}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'عدد الفواتير' : 'Invoices'}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'متوسط الفاتورة' : 'Avg Invoice'}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'المعلق' : 'Outstanding'}</th>
            <th className={cn("text-left p-2", isRTL && "text-right")}>{isRTL ? 'معدل التحصيل %' : 'Collection Rate %'}</th>
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

