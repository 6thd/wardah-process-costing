/**
 * Sales Reports Component
 * مكون تقارير المبيعات
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, Download, TrendingUp, Users, Package, DollarSign, BarChart3 } from 'lucide-react';
import { format } from 'date-fns';
import { arSA, enUS } from 'date-fns/locale';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import {
  getSalesPerformance,
  getCustomerSalesAnalysis,
  getProductSalesAnalysis,
  getProfitabilityAnalysis,
  type SalesPerformanceMetrics,
  type CustomerSalesAnalysis,
  type ProductSalesAnalysis,
  type ProfitabilityAnalysis
} from '@/services/sales-reports-service';

export function SalesReports() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const locale = isRTL ? arSA : enUS;

  const [fromDate, setFromDate] = useState<Date | undefined>(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 1);
    return date;
  });
  const [toDate, setToDate] = useState<Date | undefined>(new Date());
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('performance');

  // Performance metrics
  const [performance, setPerformance] = useState<SalesPerformanceMetrics | null>(null);
  const [customerAnalysis, setCustomerAnalysis] = useState<CustomerSalesAnalysis[]>([]);
  const [productAnalysis, setProductAnalysis] = useState<ProductSalesAnalysis[]>([]);
  const [profitability, setProfitability] = useState<ProfitabilityAnalysis | null>(null);

  const fetchData = async () => {
    if (!fromDate || !toDate) {
      toast.error(isRTL ? 'يرجى اختيار تاريخ البداية والنهاية' : 'Please select start and end dates');
      return;
    }

    setLoading(true);
    try {
      const startDateStr = format(fromDate, 'yyyy-MM-dd');
      const endDateStr = format(toDate, 'yyyy-MM-dd');

      if (activeTab === 'performance') {
        const perf = await getSalesPerformance(startDateStr, endDateStr);
        setPerformance(perf);
      } else if (activeTab === 'customers') {
        const customers = await getCustomerSalesAnalysis(startDateStr, endDateStr);
        setCustomerAnalysis(customers);
      } else if (activeTab === 'products') {
        const products = await getProductSalesAnalysis(startDateStr, endDateStr);
        setProductAnalysis(products);
      } else if (activeTab === 'profitability') {
        const profit = await getProfitabilityAnalysis(startDateStr, endDateStr);
        setProfitability(profit);
      }
    } catch (error: any) {
      console.error('Error fetching sales reports:', error);
      toast.error(error.message || (isRTL ? 'حدث خطأ في جلب البيانات' : 'Error fetching data'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (fromDate && toDate) {
      fetchData();
    }
  }, [activeTab]);

  const handleExportExcel = () => {
    try {
      let data: any[] = [];
      let filename = '';

      if (activeTab === 'performance' && performance) {
        data = [{
          [isRTL ? 'إجمالي المبيعات' : 'Total Sales']: performance.totalSales,
          [isRTL ? 'عدد الفواتير' : 'Total Invoices']: performance.totalInvoices,
          [isRTL ? 'عدد الطلبات' : 'Total Orders']: performance.totalOrders,
          [isRTL ? 'متوسط قيمة الطلب' : 'Average Order Value']: performance.averageOrderValue,
          [isRTL ? 'إجمالي التحصيلات' : 'Total Collections']: performance.totalCollections,
          [isRTL ? 'المبلغ المعلق' : 'Outstanding Amount']: performance.outstandingAmount,
          [isRTL ? 'معدل التحصيل %' : 'Collection Rate %']: performance.collectionRate
        }];
        filename = 'sales_performance';
      } else if (activeTab === 'customers' && customerAnalysis.length > 0) {
        data = customerAnalysis.map(c => ({
          [isRTL ? 'كود العميل' : 'Customer Code']: c.customerCode,
          [isRTL ? 'اسم العميل' : 'Customer Name']: isRTL ? (c.customerNameAr || c.customerName) : c.customerName,
          [isRTL ? 'إجمالي المبيعات' : 'Total Sales']: c.totalSales,
          [isRTL ? 'عدد الفواتير' : 'Total Invoices']: c.totalInvoices,
          [isRTL ? 'متوسط قيمة الفاتورة' : 'Average Invoice Value']: c.averageInvoiceValue,
          [isRTL ? 'إجمالي التحصيلات' : 'Total Collections']: c.totalCollections,
          [isRTL ? 'المبلغ المعلق' : 'Outstanding Amount']: c.outstandingAmount,
          [isRTL ? 'معدل التحصيل %' : 'Collection Rate %']: c.collectionRate
        }));
        filename = 'customer_analysis';
      } else if (activeTab === 'products' && productAnalysis.length > 0) {
        data = productAnalysis.map(p => ({
          [isRTL ? 'كود المنتج' : 'Product Code']: p.productCode,
          [isRTL ? 'اسم المنتج' : 'Product Name']: isRTL ? (p.productNameAr || p.productName) : p.productName,
          [isRTL ? 'الكمية المباعة' : 'Quantity Sold']: p.totalQuantitySold,
          [isRTL ? 'إجمالي الإيرادات' : 'Total Revenue']: p.totalRevenue,
          [isRTL ? 'إجمالي COGS' : 'Total COGS']: p.totalCOGS,
          [isRTL ? 'إجمالي الربح' : 'Total Profit']: p.totalProfit,
          [isRTL ? 'هامش الربح %' : 'Profit Margin %']: p.profitMargin,
          [isRTL ? 'متوسط سعر الوحدة' : 'Average Unit Price']: p.averageUnitPrice,
          [isRTL ? 'متوسط تكلفة الوحدة' : 'Average Unit Cost']: p.averageUnitCost
        }));
        filename = 'product_analysis';
      } else if (activeTab === 'profitability' && profitability) {
        data = [{
          [isRTL ? 'إجمالي الإيرادات' : 'Total Revenue']: profitability.totalRevenue,
          [isRTL ? 'إجمالي COGS' : 'Total COGS']: profitability.totalCOGS,
          [isRTL ? 'إجمالي الربح الإجمالي' : 'Gross Profit']: profitability.grossProfit,
          [isRTL ? 'هامش الربح الإجمالي %' : 'Gross Profit Margin %']: profitability.grossProfitMargin,
          [isRTL ? 'إجمالي الربح الصافي' : 'Net Profit']: profitability.netProfit,
          [isRTL ? 'هامش الربح الصافي %' : 'Net Profit Margin %']: profitability.netProfitMargin
        }];
        filename = 'profitability_analysis';
      }

      if (data.length === 0) {
        toast.error(isRTL ? 'لا توجد بيانات للتصدير' : 'No data to export');
        return;
      }

      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
      XLSX.writeFile(wb, `${filename}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
      toast.success(isRTL ? 'تم التصدير بنجاح' : 'Exported successfully');
    } catch (error: any) {
      console.error('Error exporting to Excel:', error);
      toast.error(isRTL ? 'حدث خطأ في التصدير' : 'Error exporting');
    }
  };

  const handleExportPDF = () => {
    try {
      const doc = new jsPDF();
      const isArabic = isRTL;

      if (activeTab === 'performance' && performance) {
        doc.setFontSize(16);
        doc.text(isRTL ? 'تقرير أداء المبيعات' : 'Sales Performance Report', 14, 20);
        doc.setFontSize(10);
        let y = 35;
        doc.text(`${isRTL ? 'إجمالي المبيعات' : 'Total Sales'}: ${performance.totalSales.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'عدد الفواتير' : 'Total Invoices'}: ${performance.totalInvoices}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'عدد الطلبات' : 'Total Orders'}: ${performance.totalOrders}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'متوسط قيمة الطلب' : 'Average Order Value'}: ${performance.averageOrderValue.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'إجمالي التحصيلات' : 'Total Collections'}: ${performance.totalCollections.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'المبلغ المعلق' : 'Outstanding Amount'}: ${performance.outstandingAmount.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'معدل التحصيل %' : 'Collection Rate %'}: ${performance.collectionRate.toFixed(2)}`, 14, y);
      } else if (activeTab === 'customers' && customerAnalysis.length > 0) {
        doc.setFontSize(16);
        doc.text(isRTL ? 'تحليل العملاء' : 'Customer Analysis', 14, 20);
        doc.setFontSize(10);
        const tableData = customerAnalysis.slice(0, 20).map(c => [
          c.customerCode,
          isRTL ? (c.customerNameAr || c.customerName) : c.customerName,
          c.totalSales.toFixed(2),
          c.totalInvoices.toString(),
          c.collectionRate.toFixed(2) + '%'
        ]);
        (doc as any).autoTable({
          head: [[isRTL ? 'كود' : 'Code', isRTL ? 'اسم العميل' : 'Customer Name', isRTL ? 'المبيعات' : 'Sales', isRTL ? 'الفواتير' : 'Invoices', isRTL ? 'معدل التحصيل' : 'Collection Rate']],
          body: tableData,
          startY: 30
        });
      } else if (activeTab === 'products' && productAnalysis.length > 0) {
        doc.setFontSize(16);
        doc.text(isRTL ? 'تحليل المنتجات' : 'Product Analysis', 14, 20);
        doc.setFontSize(10);
        const tableData = productAnalysis.slice(0, 20).map(p => [
          p.productCode,
          isRTL ? (p.productNameAr || p.productName) : p.productName,
          p.totalQuantitySold.toString(),
          p.totalRevenue.toFixed(2),
          p.totalProfit.toFixed(2),
          p.profitMargin.toFixed(2) + '%'
        ]);
        (doc as any).autoTable({
          head: [[isRTL ? 'كود' : 'Code', isRTL ? 'اسم المنتج' : 'Product Name', isRTL ? 'الكمية' : 'Qty', isRTL ? 'الإيرادات' : 'Revenue', isRTL ? 'الربح' : 'Profit', isRTL ? 'الهامش %' : 'Margin %']],
          body: tableData,
          startY: 30
        });
      } else if (activeTab === 'profitability' && profitability) {
        doc.setFontSize(16);
        doc.text(isRTL ? 'تحليل الربحية' : 'Profitability Analysis', 14, 20);
        doc.setFontSize(10);
        let y = 35;
        doc.text(`${isRTL ? 'إجمالي الإيرادات' : 'Total Revenue'}: ${profitability.totalRevenue.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'إجمالي COGS' : 'Total COGS'}: ${profitability.totalCOGS.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'الربح الإجمالي' : 'Gross Profit'}: ${profitability.grossProfit.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'هامش الربح الإجمالي %' : 'Gross Profit Margin %'}: ${profitability.grossProfitMargin.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'الربح الصافي' : 'Net Profit'}: ${profitability.netProfit.toFixed(2)}`, 14, y);
        y += 10;
        doc.text(`${isRTL ? 'هامش الربح الصافي %' : 'Net Profit Margin %'}: ${profitability.netProfitMargin.toFixed(2)}`, 14, y);
      }

      doc.save(`${activeTab}_report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
      toast.success(isRTL ? 'تم التصدير بنجاح' : 'Exported successfully');
    } catch (error: any) {
      console.error('Error exporting to PDF:', error);
      toast.error(isRTL ? 'حدث خطأ في التصدير' : 'Error exporting');
    }
  };

  return (
    <div className="space-y-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className={cn("flex items-center justify-between", isRTL ? "flex-row-reverse" : "")}>
        <div>
          <h1 className="text-3xl font-bold">
            {isRTL ? 'تقارير المبيعات' : 'Sales Reports'}
          </h1>
          <p className="text-muted-foreground mt-2">
            {isRTL ? 'أداء المبيعات وتحليل العملاء والمنتجات' : 'Sales performance, customer and product analysis'}
          </p>
        </div>
      </div>

      {/* Date Filters */}
      <Card>
        <CardHeader>
          <CardTitle>{isRTL ? 'فلترة التاريخ' : 'Date Filter'}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className={cn("flex gap-4 items-end", isRTL ? "flex-row-reverse" : "")}>
            <div className="flex-1">
              <Label>{isRTL ? 'من تاريخ' : 'From Date'}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !fromDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {fromDate ? format(fromDate, 'PPP', { locale }) : <span>{isRTL ? 'اختر التاريخ' : 'Pick a date'}</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align={isRTL ? 'end' : 'start'}>
                  <Calendar
                    mode="single"
                    selected={fromDate}
                    onSelect={setFromDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <div className="flex-1">
              <Label>{isRTL ? 'إلى تاريخ' : 'To Date'}</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !toDate && "text-muted-foreground"
                    )}
                  >
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {toDate ? format(toDate, 'PPP', { locale }) : <span>{isRTL ? 'اختر التاريخ' : 'Pick a date'}</span>}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align={isRTL ? 'end' : 'start'}>
                  <Calendar
                    mode="single"
                    selected={toDate}
                    onSelect={setToDate}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>
            </div>
            <Button onClick={fetchData} disabled={loading || !fromDate || !toDate}>
              {isRTL ? 'عرض' : 'View'}
            </Button>
            <Button variant="outline" onClick={handleExportExcel} disabled={loading}>
              <Download className="h-4 w-4 mr-2" />
              Excel
            </Button>
            <Button variant="outline" onClick={handleExportPDF} disabled={loading}>
              <Download className="h-4 w-4 mr-2" />
              PDF
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reports Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="performance">
            <TrendingUp className="h-4 w-4 mr-2" />
            {isRTL ? 'أداء المبيعات' : 'Performance'}
          </TabsTrigger>
          <TabsTrigger value="customers">
            <Users className="h-4 w-4 mr-2" />
            {isRTL ? 'تحليل العملاء' : 'Customers'}
          </TabsTrigger>
          <TabsTrigger value="products">
            <Package className="h-4 w-4 mr-2" />
            {isRTL ? 'تحليل المنتجات' : 'Products'}
          </TabsTrigger>
          <TabsTrigger value="profitability">
            <DollarSign className="h-4 w-4 mr-2" />
            {isRTL ? 'الربحية' : 'Profitability'}
          </TabsTrigger>
        </TabsList>

        {/* Performance Tab */}
        <TabsContent value="performance">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-4 text-muted-foreground">{isRTL ? 'جاري التحميل...' : 'Loading...'}</p>
              </CardContent>
            </Card>
          ) : performance ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{isRTL ? 'إجمالي المبيعات' : 'Total Sales'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{performance.totalSales.toFixed(2)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{isRTL ? 'عدد الفواتير' : 'Total Invoices'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{performance.totalInvoices}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{isRTL ? 'متوسط قيمة الطلب' : 'Average Order Value'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{performance.averageOrderValue.toFixed(2)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{isRTL ? 'معدل التحصيل' : 'Collection Rate'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{performance.collectionRate.toFixed(2)}%</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{isRTL ? 'إجمالي التحصيلات' : 'Total Collections'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{performance.totalCollections.toFixed(2)}</div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>{isRTL ? 'المبلغ المعلق' : 'Outstanding Amount'}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-orange-600">{performance.outstandingAmount.toFixed(2)}</div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {isRTL ? 'لا توجد بيانات' : 'No data available'}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Customers Tab */}
        <TabsContent value="customers">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-4 text-muted-foreground">{isRTL ? 'جاري التحميل...' : 'Loading...'}</p>
              </CardContent>
            </Card>
          ) : customerAnalysis.length > 0 ? (
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
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {isRTL ? 'لا توجد بيانات' : 'No data available'}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Products Tab */}
        <TabsContent value="products">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-4 text-muted-foreground">{isRTL ? 'جاري التحميل...' : 'Loading...'}</p>
              </CardContent>
            </Card>
          ) : productAnalysis.length > 0 ? (
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
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {isRTL ? 'لا توجد بيانات' : 'No data available'}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Profitability Tab */}
        <TabsContent value="profitability">
          {loading ? (
            <Card>
              <CardContent className="py-8 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                <p className="mt-4 text-muted-foreground">{isRTL ? 'جاري التحميل...' : 'Loading...'}</p>
              </CardContent>
            </Card>
          ) : profitability ? (
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

              {/* Top Customers by Profit */}
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

              {/* Top Products by Profit */}
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
          ) : (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {isRTL ? 'لا توجد بيانات' : 'No data available'}
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

