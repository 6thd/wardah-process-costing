import { format } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import type { TrialBalanceRow, TrialBalanceTotals } from '../types';

interface ExportData {
  balances: TrialBalanceRow[];
  totals: TrialBalanceTotals;
  fromDate: string;
  asOfDate: string;
  isRTL: boolean;
}

export function exportToExcel({ balances, totals, fromDate, asOfDate, isRTL }: ExportData) {
  const excelData = balances.map(row => ({
    [isRTL ? 'كود الحساب' : 'Account Code']: row.account_code,
    [isRTL ? 'اسم الحساب' : 'Account Name']: isRTL ? (row.account_name_ar || row.account_name) : row.account_name,
    [isRTL ? 'نوع الحساب' : 'Account Type']: row.account_type,
    [isRTL ? 'رصيد افتتاحي - مدين' : 'Opening Balance - Debit']: row.opening_debit.toFixed(2),
    [isRTL ? 'رصيد افتتاحي - دائن' : 'Opening Balance - Credit']: row.opening_credit.toFixed(2),
    [isRTL ? 'حركة الفترة - مدين' : 'Period Movement - Debit']: row.period_debit.toFixed(2),
    [isRTL ? 'حركة الفترة - دائن' : 'Period Movement - Credit']: row.period_credit.toFixed(2),
    [isRTL ? 'رصيد ختامي - مدين' : 'Closing Balance - Debit']: row.closing_debit.toFixed(2),
    [isRTL ? 'رصيد ختامي - دائن' : 'Closing Balance - Credit']: row.closing_credit.toFixed(2)
  }));

  excelData.push({
    [isRTL ? 'كود الحساب' : 'Account Code']: '',
    [isRTL ? 'اسم الحساب' : 'Account Name']: isRTL ? 'الإجماليات' : 'TOTALS',
    [isRTL ? 'نوع الحساب' : 'Account Type']: '',
    [isRTL ? 'رصيد افتتاحي - مدين' : 'Opening Balance - Debit']: totals.opening_debit.toFixed(2),
    [isRTL ? 'رصيد افتتاحي - دائن' : 'Opening Balance - Credit']: totals.opening_credit.toFixed(2),
    [isRTL ? 'حركة الفترة - مدين' : 'Period Movement - Debit']: totals.period_debit.toFixed(2),
    [isRTL ? 'حركة الفترة - دائن' : 'Period Movement - Credit']: totals.period_credit.toFixed(2),
    [isRTL ? 'رصيد ختامي - مدين' : 'Closing Balance - Debit']: totals.closing_debit.toFixed(2),
    [isRTL ? 'رصيد ختامي - دائن' : 'Closing Balance - Credit']: totals.closing_credit.toFixed(2)
  });

  const worksheet = XLSX.utils.json_to_sheet(excelData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, isRTL ? 'ميزان المراجعة' : 'Trial Balance');
  XLSX.writeFile(workbook, `trial-balance-${asOfDate}.xlsx`);
}

export function exportToPDF({ balances, totals, fromDate, asOfDate, isRTL }: ExportData) {
  const doc = new jsPDF('l', 'mm', 'a4');

  if (isRTL) {
    doc.setLanguage('ar');
  }

  doc.setFontSize(16);
  doc.text(isRTL ? 'ميزان المراجعة' : 'Trial Balance', doc.internal.pageSize.width / 2, 15, { align: 'center' });

  doc.setFontSize(10);
  doc.text(
    `${isRTL ? 'من تاريخ' : 'From'}: ${format(new Date(fromDate), 'dd/MM/yyyy')} ${isRTL ? 'إلى' : 'To'}: ${format(new Date(asOfDate), 'dd/MM/yyyy')}`,
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
    isRTL ? 'الإجماليات' : 'TOTALS',
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
      isRTL ? 'كود الحساب' : 'Code',
      isRTL ? 'اسم الحساب' : 'Account Name',
      isRTL ? 'افتتاحي مدين' : 'Open. Debit',
      isRTL ? 'افتتاحي دائن' : 'Open. Credit',
      isRTL ? 'فترة مدين' : 'Per. Debit',
      isRTL ? 'فترة دائن' : 'Per. Credit',
      isRTL ? 'ختامي مدين' : 'Clos. Debit',
      isRTL ? 'ختامي دائن' : 'Clos. Credit'
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

