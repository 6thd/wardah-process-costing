import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { CustomerSalesAnalysis } from '@/services/sales-reports-service';

interface CustomerAnalysisTabProps {
  loading: boolean;
  customerAnalysis: CustomerSalesAnalysis[];
  isRTL: boolean;
}

export function CustomerAnalysisTab({ loading, customerAnalysis, isRTL }: CustomerAnalysisTabProps) {
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

  if (customerAnalysis.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          {isRTL ? 'لا توجد بيانات' : 'No data available'}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{isRTL ? 'تحليل العملاء' : 'Customer Analysis'}</CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}

