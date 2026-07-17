import { format } from 'date-fns';
import { toast } from 'sonner';
import i18next from 'i18next';
// P4-D2: xlsx/jspdf تُحمَّلان كسولاً عند التصدير فقط
import { loadXLSX, loadJsPDF } from '@/lib/export-libs';
import type jsPDF from 'jspdf'; // نوع فقط — يُحذف عند البناء
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

const t = (key: string) => i18next.t(key);

function preparePerformanceData(performance: SalesPerformanceMetrics, isRTL: boolean): { data: any[]; filename: string } {
  return {
    data: [{
      [t('export.sales.totalSales')]: performance.totalSales,
      [t('export.sales.totalInvoices')]: performance.totalInvoices,
      [t('export.sales.totalOrders')]: performance.totalOrders,
      [t('export.sales.averageOrderValue')]: performance.averageOrderValue,
      [t('export.sales.totalCollections')]: performance.totalCollections,
      [t('export.sales.outstandingAmount')]: performance.outstandingAmount,
      [t('export.sales.collectionRate')]: performance.collectionRate
    }],
    filename: 'sales_performance'
  };
}

function prepareCustomerData(customerAnalysis: CustomerSalesAnalysis[], isRTL: boolean): { data: any[]; filename: string } {
  return {
    data: customerAnalysis.map(c => ({
      [t('export.sales.customerCode')]: c.customerCode,
      [t('export.sales.customerName')]: isRTL ? (c.customerNameAr || c.customerName) : c.customerName,
      [t('export.sales.totalSales')]: c.totalSales,
      [t('export.sales.totalInvoices')]: c.totalInvoices,
      [t('export.sales.averageInvoiceValue')]: c.averageInvoiceValue,
      [t('export.sales.totalCollections')]: c.totalCollections,
      [t('export.sales.outstandingAmount')]: c.outstandingAmount,
      [t('export.sales.collectionRate')]: c.collectionRate
    })),
    filename: 'customer_analysis'
  };
}

function prepareProductData(productAnalysis: ProductSalesAnalysis[], isRTL: boolean): { data: any[]; filename: string } {
  return {
    data: productAnalysis.map(p => ({
      [t('export.sales.productCode')]: p.productCode,
      [t('export.sales.productName')]: isRTL ? (p.productNameAr || p.productName) : p.productName,
      [t('export.sales.quantitySold')]: p.totalQuantitySold,
      [t('export.sales.totalRevenue')]: p.totalRevenue,
      [t('export.sales.totalCOGS')]: p.totalCOGS,
      [t('export.sales.totalProfit')]: p.totalProfit,
      [t('export.sales.profitMargin')]: p.profitMargin,
      [t('export.sales.averageUnitPrice')]: p.averageUnitPrice,
      [t('export.sales.averageUnitCost')]: p.averageUnitCost
    })),
    filename: 'product_analysis'
  };
}

function prepareProfitabilityData(profitability: ProfitabilityAnalysis, isRTL: boolean): { data: any[]; filename: string } {
  return {
    data: [{
      [t('export.sales.totalRevenue')]: profitability.totalRevenue,
      [t('export.sales.totalCOGS')]: profitability.totalCOGS,
      [t('export.sales.grossProfit')]: profitability.grossProfit,
      [t('export.sales.grossProfitMargin')]: profitability.grossProfitMargin,
      [t('export.sales.netProfit')]: profitability.netProfit,
      [t('export.sales.netProfitMargin')]: profitability.netProfitMargin
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

export async function exportToExcel(exportData: ExportData) {
  const XLSX = await loadXLSX();
  try {
    const result = getExportData(exportData);

    if (!result || result.data.length === 0) {
      toast.error(t('export.sales.noData'));
      return;
    }

    const ws = XLSX.utils.json_to_sheet(result.data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
    XLSX.writeFile(wb, `${result.filename}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success(t('export.sales.success'));
  } catch (error: any) {
    console.error('Error exporting to Excel:', error);
    toast.error(t('export.sales.error'));
  }
}

function addPerformanceToPDF(doc: jsPDF, performance: SalesPerformanceMetrics): void {
  doc.setFontSize(16);
  doc.text(t('export.sales.performanceReport'), 14, 20);
  doc.setFontSize(10);
  let y = 35;
  doc.text(`${t('export.sales.totalSales')}: ${performance.totalSales.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.totalInvoices')}: ${performance.totalInvoices}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.totalOrders')}: ${performance.totalOrders}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.averageOrderValue')}: ${performance.averageOrderValue.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.totalCollections')}: ${performance.totalCollections.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.outstandingAmount')}: ${performance.outstandingAmount.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.collectionRate')}: ${performance.collectionRate.toFixed(2)}`, 14, y);
}

function addCustomerAnalysisToPDF(doc: jsPDF, customerAnalysis: CustomerSalesAnalysis[], isRTL: boolean): void {
  doc.setFontSize(16);
  doc.text(t('export.sales.customerAnalysis'), 14, 20);
  doc.setFontSize(10);
  const tableData = customerAnalysis.slice(0, 20).map(c => [
    c.customerCode,
    isRTL ? (c.customerNameAr || c.customerName) : c.customerName,
    c.totalSales.toFixed(2),
    c.totalInvoices.toString(),
    c.collectionRate.toFixed(2) + '%'
  ]);
  (doc as any).autoTable({
    head: [[t('export.sales.code'), t('export.sales.customerName'), t('export.sales.sales'), t('export.sales.invoices'), t('export.sales.collectionRateShort')]],
    body: tableData,
    startY: 30
  });
}

function addProductAnalysisToPDF(doc: jsPDF, productAnalysis: ProductSalesAnalysis[], isRTL: boolean): void {
  doc.setFontSize(16);
  doc.text(t('export.sales.productAnalysis'), 14, 20);
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
    head: [[t('export.sales.code'), t('export.sales.productName'), t('export.sales.qty'), t('export.sales.revenue'), t('export.sales.profit'), t('export.sales.marginPct')]],
    body: tableData,
    startY: 30
  });
}

function addProfitabilityToPDF(doc: jsPDF, profitability: ProfitabilityAnalysis): void {
  doc.setFontSize(16);
  doc.text(t('export.sales.profitabilityAnalysis'), 14, 20);
  doc.setFontSize(10);
  let y = 35;
  doc.text(`${t('export.sales.totalRevenue')}: ${profitability.totalRevenue.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.totalCOGS')}: ${profitability.totalCOGS.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.grossProfit')}: ${profitability.grossProfit.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.grossProfitMargin')}: ${profitability.grossProfitMargin.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.netProfit')}: ${profitability.netProfit.toFixed(2)}`, 14, y);
  y += 10;
  doc.text(`${t('export.sales.netProfitMargin')}: ${profitability.netProfitMargin.toFixed(2)}`, 14, y);
}

export async function exportToPDF(exportData: ExportData) {
  const jsPDF = await loadJsPDF();
  try {
    const doc = new jsPDF();
    const { activeTab, isRTL, performance, customerAnalysis, productAnalysis, profitability } = exportData;

    if (activeTab === 'performance' && performance) {
      addPerformanceToPDF(doc, performance);
    } else if (activeTab === 'customers' && customerAnalysis && customerAnalysis.length > 0) {
      addCustomerAnalysisToPDF(doc, customerAnalysis, isRTL);
    } else if (activeTab === 'products' && productAnalysis && productAnalysis.length > 0) {
      addProductAnalysisToPDF(doc, productAnalysis, isRTL);
    } else if (activeTab === 'profitability' && profitability) {
      addProfitabilityToPDF(doc, profitability);
    }

    doc.save(`${activeTab}_report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success(t('export.sales.success'));
  } catch (error: any) {
    console.error('Error exporting to PDF:', error);
    toast.error(t('export.sales.error'));
  }
}
