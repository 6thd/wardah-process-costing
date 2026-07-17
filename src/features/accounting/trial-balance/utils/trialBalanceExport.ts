import { format } from 'date-fns';
import i18next from 'i18next';
// P4-D2: xlsx/jspdf تُحمَّلان كسولاً عند التصدير فقط — لا تُشحنان بالحزمة الأولى
import { loadXLSX, loadJsPDF } from '@/lib/export-libs';
import type { TrialBalanceRow, TrialBalanceTotals } from '../types';

const t = (key: string) => i18next.t(key);

interface ExportData {
  balances: TrialBalanceRow[];
  totals: TrialBalanceTotals;
  fromDate: string;
  asOfDate: string;
  isRTL: boolean;
}

export async function exportToExcel({ balances, totals, fromDate, asOfDate, isRTL }: ExportData) {
  const XLSX = await loadXLSX();
  const excelData = balances.map(row => ({
    [t('tbExport.accountCode')]: row.account_code,
    [t('tbExport.accountName')]: isRTL ? (row.account_name_ar || row.account_name) : row.account_name,
    [t('tbExport.accountType')]: row.account_type,
    [t('tbExport.openDebit')]: row.opening_debit.toFixed(2),
    [t('tbExport.openCredit')]: row.opening_credit.toFixed(2),
    [t('tbExport.periodDebit')]: row.period_debit.toFixed(2),
    [t('tbExport.periodCredit')]: row.period_credit.toFixed(2),
    [t('tbExport.closeDebit')]: row.closing_debit.toFixed(2),
    [t('tbExport.closeCredit')]: row.closing_credit.toFixed(2)
  }));

  excelData.push({
    [t('tbExport.accountCode')]: '',
    [t('tbExport.accountName')]: t('tbExport.totals'),
    [t('tbExport.accountType')]: '',
    [t('tbExport.openDebit')]: totals.opening_debit.toFixed(2),
    [t('tbExport.openCredit')]: totals.opening_credit.toFixed(2),
    [t('tbExport.periodDebit')]: totals.period_debit.toFixed(2),
    [t('tbExport.periodCredit')]: totals.period_credit.toFixed(2),
    [t('tbExport.closeDebit')]: totals.closing_debit.toFixed(2),
    [t('tbExport.closeCredit')]: totals.closing_credit.toFixed(2)
  });

  const worksheet = XLSX.utils.json_to_sheet(excelData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, t('tbExport.sheetName'));
  XLSX.writeFile(workbook, `trial-balance-${asOfDate}.xlsx`);
}

export async function exportToPDF({ balances, totals, fromDate, asOfDate, isRTL }: ExportData) {
  const jsPDF = await loadJsPDF();
  const doc = new jsPDF('l', 'mm', 'a4');

  if (isRTL) {
    doc.setLanguage('ar');
  }

  doc.setFontSize(16);
  doc.text(t('tbExport.sheetName'), doc.internal.pageSize.width / 2, 15, { align: 'center' });

  doc.setFontSize(10);
  doc.text(
    `${t('tbExport.from')}: ${format(new Date(fromDate), 'dd/MM/yyyy')} ${t('tbExport.to')}: ${format(new Date(asOfDate), 'dd/MM/yyyy')}`,
    doc.internal.pageSize.width / 2,
    22,
    { align: 'center' }
  );

  const tableData = balances.map(row => [
    row.account_code,
    isRTL ? (row.account_name_ar || row.account_name) : row.account_name,
    row.opening_debit.toFixed(2),
    row.opening_credit.toFixed(2),
    row.period_debit.toFixed(2),
    row.period_credit.toFixed(2),
    row.closing_debit.toFixed(2),
    row.closing_credit.toFixed(2)
  ]);

  tableData.push([
    '',
    t('tbExport.totals'),
    totals.opening_debit.toFixed(2),
    totals.opening_credit.toFixed(2),
    totals.period_debit.toFixed(2),
    totals.period_credit.toFixed(2),
    totals.closing_debit.toFixed(2),
    totals.closing_credit.toFixed(2)
  ]);

  (doc as any).autoTable({
    startY: 30,
    head: [[
      t('tbExport.accountCodeShort'),
      t('tbExport.accountName'),
      t('tbExport.openDebitShort'),
      t('tbExport.openCreditShort'),
      t('tbExport.periodDebitShort'),
      t('tbExport.periodCreditShort'),
      t('tbExport.closeDebitShort'),
      t('tbExport.closeCreditShort')
    ]],
    body: tableData,
    theme: 'grid',
    styles: {
      font: 'helvetica',
      fontSize: 8,
      halign: 'center'
    },
    headStyles: {
      fillColor: [66, 139, 202],
      fontStyle: 'bold'
    },
    footStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: 'bold'
    }
  });

  doc.save(`trial-balance-${asOfDate}.pdf`);
}
