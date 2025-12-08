import { format } from 'date-fns';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type {
  SalesPerformanceMetrics,
  CustomerSalesAnalysis,
  ProductSalesAnalysis,
  ProfitabilityAnalysis
} from '@/services/sales-reports-service';

interface ExportData {
  activeTab: string;
  isRTL: boolean;
  performance?: SalesPerformanceMetrics | null;
  customerAnalysis?: CustomerSalesAnalysis[];
  productAnalysis?: ProductSalesAnalysis[];
  profitability?: ProfitabilityAnalysis | null;
}

function preparePerformanceData(performance: SalesPerformanceMetrics, isRTL: boolean): { data: any[]; filename: string } {
  return {
    data: [{
      [isRTL ? 'إجمالي المبيعات' : 'Total Sales']: performance.totalSales,
      [isRTL ? 'عدد الفواتير' : 'Total Invoices']: performance.totalInvoices,
      [isRTL ? 'عدد الطلبات' : 'Total Orders']: performance.totalOrders,
      [isRTL ? 'متوسط قيمة الطلب' : 'Average Order Value']: performance.averageOrderValue,
      [isRTL ? 'إجمالي التحصيلات' : 'Total Collections']: performance.totalCollections,
      [isRTL ? 'المبلغ المعلق' : 'Outstanding Amount']: performance.outstandingAmount,
      [isRTL ? 'معدل التحصيل %' : 'Collection Rate %']: performance.collectionRate
    }],
    filename: 'sales_performance'
  };
}

function prepareCustomerData(customerAnalysis: CustomerSalesAnalysis[], isRTL: boolean): { data: any[]; filename: string } {
  return {
    data: customerAnalysis.map(c => ({
      [isRTL ? 'كود العميل' : 'Customer Code']: c.customerCode,
      [isRTL ? 'اسم العميل' : 'Customer Name']: isRTL ? (c.customerNameAr || c.customerName) : c.customerName,
      [isRTL ? 'إجمالي المبيعات' : 'Total Sales']: c.totalSales,
      [isRTL ? 'عدد الفواتير' : 'Total Invoices']: c.totalInvoices,
      [isRTL ? 'متوسط قيمة الفاتورة' : 'Average Invoice Value']: c.averageInvoiceValue,
      [isRTL ? 'إجمالي التحصيلات' : 'Total Collections']: c.totalCollections,
      [isRTL ? 'المبلغ المعلق' : 'Outstanding Amount']: c.outstandingAmount,
      [isRTL ? 'معدل التحصيل %' : 'Collection Rate %']: c.collectionRate
    })),
    filename: 'customer_analysis'
  };
}

function prepareProductData(productAnalysis: ProductSalesAnalysis[], isRTL: boolean): { data: any[]; filename: string } {
  return {
    data: productAnalysis.map(p => ({
      [isRTL ? 'كود المنتج' : 'Product Code']: p.productCode,
      [isRTL ? 'اسم المنتج' : 'Product Name']: isRTL ? (p.productNameAr || p.productName) : p.productName,
      [isRTL ? 'الكمية المباعة' : 'Quantity Sold']: p.totalQuantitySold,
      [isRTL ? 'إجمالي الإيرادات' : 'Total Revenue']: p.totalRevenue,
      [isRTL ? 'إجمالي COGS' : 'Total COGS']: p.totalCOGS,
      [isRTL ? 'إجمالي الربح' : 'Total Profit']: p.totalProfit,
      [isRTL ? 'هامش الربح %' : 'Profit Margin %']: p.profitMargin,
      [isRTL ? 'متوسط سعر الوحدة' : 'Average Unit Price']: p.averageUnitPrice,
      [isRTL ? 'متوسط تكلفة الوحدة' : 'Average Unit Cost']: p.averageUnitCost
    })),
    filename: 'product_analysis'
  };
}

function prepareProfitabilityData(profitability: ProfitabilityAnalysis, isRTL: boolean): { data: any[]; filename: string } {
  return {
    data: [{
      [isRTL ? 'إجمالي الإيرادات' : 'Total Revenue']: profitability.totalRevenue,
      [isRTL ? 'إجمالي COGS' : 'Total COGS']: profitability.totalCOGS,
      [isRTL ? 'إجمالي الربح الإجمالي' : 'Gross Profit']: profitability.grossProfit,
      [isRTL ? 'هامش الربح الإجمالي %' : 'Gross Profit Margin %']: profitability.grossProfitMargin,
      [isRTL ? 'إجمالي الربح الصافي' : 'Net Profit']: profitability.netProfit,
      [isRTL ? 'هامش الربح الصافي %' : 'Net Profit Margin %']: profitability.netProfitMargin
    }],
    filename: 'profitability_analysis'
  };
}

function getExportData({ activeTab, isRTL, performance, customerAnalysis, productAnalysis, profitability }: ExportData): { data: any[]; filename: string } | null {
  if (activeTab === 'performance' && performance) {
    return preparePerformanceData(performance, isRTL);
  }
  if (activeTab === 'customers' && customerAnalysis && customerAnalysis.length > 0) {
    return prepareCustomerData(customerAnalysis, isRTL);
  }
  if (activeTab === 'products' && productAnalysis && productAnalysis.length > 0) {
    return prepareProductData(productAnalysis, isRTL);
  }
  if (activeTab === 'profitability' && profitability) {
    return prepareProfitabilityData(profitability, isRTL);
  }
  return null;
}

export function exportToExcel(exportData: ExportData) {
  try {
    const result = getExportData(exportData);
    
    if (!result || result.data.length === 0) {
      toast.error(exportData.isRTL ? 'لا توجد بيانات للتصدير' : 'No data to export');
      return;
    }

    const ws = XLSX.utils.json_to_sheet(result.data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `${result.filename}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success(exportData.isRTL ? 'تم التصدير بنجاح' : 'Exported successfully');
  } catch (error: any) {
    console.error('Error exporting to Excel:', error);
    toast.error(exportData.isRTL ? 'حدث خطأ في التصدير' : 'Error exporting');
  }
}

function addPerformanceToPDF(doc: jsPDF, performance: SalesPerformanceMetrics, isRTL: boolean): void {
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
}

function addCustomerAnalysisToPDF(doc: jsPDF, customerAnalysis: CustomerSalesAnalysis[], isRTL: boolean): void {
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
}

function addProductAnalysisToPDF(doc: jsPDF, productAnalysis: ProductSalesAnalysis[], isRTL: boolean): void {
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
}

function addProfitabilityToPDF(doc: jsPDF, profitability: ProfitabilityAnalysis, isRTL: boolean): void {
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

export function exportToPDF(exportData: ExportData) {
  try {
    const doc = new jsPDF();
    const { activeTab, isRTL, performance, customerAnalysis, productAnalysis, profitability } = exportData;

    if (activeTab === 'performance' && performance) {
      addPerformanceToPDF(doc, performance, isRTL);
    } else if (activeTab === 'customers' && customerAnalysis && customerAnalysis.length > 0) {
      addCustomerAnalysisToPDF(doc, customerAnalysis, isRTL);
    } else if (activeTab === 'products' && productAnalysis && productAnalysis.length > 0) {
      addProductAnalysisToPDF(doc, productAnalysis, isRTL);
    } else if (activeTab === 'profitability' && profitability) {
      addProfitabilityToPDF(doc, profitability, isRTL);
    }

    doc.save(`${activeTab}_report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success(isRTL ? 'تم التصدير بنجاح' : 'Exported successfully');
  } catch (error: any) {
    console.error('Error exporting to PDF:', error);
    toast.error(exportData.isRTL ? 'حدث خطأ في التصدير' : 'Error exporting');
  }
}

