import { useState, useEffect } from 'react';
import { Download, FileSpreadsheet, FileText, Calendar, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/lib/supabase';
import { trialBalanceService } from '@/services/supabase-service';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { PerformanceMonitor } from '@/lib/performance-monitor';

interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_name_ar?: string;
  account_type: string;
  opening_debit: number;
  opening_credit: number;
  period_debit: number;
  period_credit: number;
  closing_debit: number;
  closing_credit: number;
}

const TrialBalance = () => {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [balances, setBalances] = useState<TrialBalanceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [asOfDate, setAsOfDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [fromDate, setFromDate] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'));
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>('all');

  useEffect(() => {
    fetchTrialBalance();
  }, []);

  const fetchTrialBalance = async () => {
    await PerformanceMonitor.measure('Trial Balance Page Load', async () => {
      setLoading(true);
      try {
        console.log('🔍 Fetching trial balance from:', fromDate, 'to:', asOfDate);

        // Try new trialBalanceService first
        try {
          console.log('📊 Calling trialBalanceService.get()...');
          const data = await trialBalanceService.get(fromDate, asOfDate);
          console.log('✅ Loaded from trialBalanceService:', data?.length, 'accounts');
          console.log('📝 Sample:', data?.[0]);

          if (!data || data.length === 0) {
            console.warn('⚠️ No data returned from trialBalanceService');
            throw new Error('No data');
          }

          // Convert to expected format
          const formattedData = data.map((account: any) => ({
            account_code: account.account_code,
            account_name: account.account_name || account.account_code,
            account_name_ar: account.account_name_ar || account.account_name || account.account_code,
            account_type: 'ASSET', // Default, could be enhanced
            opening_debit: 0,
            opening_credit: 0,
            period_debit: account.debit,
            period_credit: account.credit,
            closing_debit: account.debit - account.credit > 0 ? account.debit - account.credit : 0,
            closing_credit: account.credit - account.debit > 0 ? account.credit - account.debit : 0
          }));

          console.log('✅ Formatted data ready:', formattedData.length, 'accounts');
          setBalances(formattedData);
          return;
        } catch (newError: any) {
          console.warn('⚠️ New service error:', newError?.message || newError);
          console.warn('Trying RPC fallback...');
        }

        // Fallback to RPC
        const { data, error } = await supabase
          .rpc('rpc_get_trial_balance', {
            p_tenant: '00000000-0000-0000-0000-000000000001',
            p_as_of_date: asOfDate
          });

        if (error) {
          console.error('❌ RPC Error, falling back to manual:', error);
          await fetchTrialBalanceManual();
        } else {
          console.log('✅ RPC Data received:', data?.length, 'rows');
          setBalances(data || []);
        }
      } catch (error) {
        console.error('❌ Exception, falling back to manual:', error);
        await fetchTrialBalanceManual();
      } finally {
        setLoading(false);
      }
    });
  };

  const fetchTrialBalanceManual = async () => {
    try {
      console.log('📊 Fetching manual trial balance...');

      // جلب جميع الحسابات
      const { data: accounts, error: accountsError } = await supabase
        .from('gl_accounts')
        .select('*')
        .eq('allow_posting', true)
        .eq('is_active', true)
        .order('code');

      if (accountsError) throw accountsError;
      console.log('✅ Accounts fetched:', accounts?.length);

      // جلب جميع بنود القيود المرحلة - Try new table first
      let lines: any[] = [];

      try {
        const { data: newLines, error: newError } = await supabase
          .from('gl_entry_lines')
          .select(`
            *,
            entry:gl_entries!inner (
              status,
              entry_date
            )
          `)
          .eq('entry.status', 'POSTED');

        if (!newError && newLines) {
          console.log('✅ Posted lines from gl_entry_lines:', newLines?.length);
          lines = newLines;
        } else {
          throw newError;
        }
      } catch (newError) {
        console.warn('Trying old journal_lines table:', newError);
        const { data: oldLines, error: linesError } = await supabase
          .from('journal_lines')
          .select(`
            *,
            journal_entries!inner (
              status,
              entry_date,
              posting_date
            )
          `)
          .eq('journal_entries.status', 'posted');

        if (linesError) throw linesError;
        console.log('✅ Posted lines fetched from journal_lines:', oldLines?.length);
        lines = oldLines || [];
      }

      console.log('📝 Sample line:', lines?.[0]);

      // حساب الأرصدة لكل حساب
      const balanceMap = new Map<string, TrialBalanceRow>();

      accounts.forEach(account => {
        balanceMap.set(account.id, {
          account_code: account.code,
          account_name: account.name,
          account_name_ar: account.name_ar,
          account_type: account.account_type,
          opening_debit: 0,
          opening_credit: 0,
          period_debit: 0,
          period_credit: 0,
          closing_debit: 0,
          closing_credit: 0
        });
      });

      // حساب الحركات
      lines.forEach((line: any) => {
        const balance = balanceMap.get(line.account_id);
        if (!balance) return;

        const entryDate = line.journal_entries.posting_date || line.journal_entries.entry_date;

        if (entryDate <= asOfDate) {
          // الحركة ضمن الفترة
          if (entryDate >= fromDate) {
            balance.period_debit += Number(line.debit) || 0;
            balance.period_credit += Number(line.credit) || 0;
          } else {
            // رصيد افتتاحي
            balance.opening_debit += Number(line.debit) || 0;
            balance.opening_credit += Number(line.credit) || 0;
          }
        }
      });

      // حساب الأرصدة الختامية
      balanceMap.forEach(balance => {
        const totalDebit = balance.opening_debit + balance.period_debit;
        const totalCredit = balance.opening_credit + balance.period_credit;

        if (totalDebit > totalCredit) {
          balance.closing_debit = totalDebit - totalCredit;
          balance.closing_credit = 0;
        } else if (totalCredit > totalDebit) {
          balance.closing_debit = 0;
          balance.closing_credit = totalCredit - totalDebit;
        } else {
          balance.closing_debit = 0;
          balance.closing_credit = 0;
        }
      });

      // تحويل إلى مصفوفة وفلترة الحسابات بدون حركة
      const balanceArray = Array.from(balanceMap.values())
        .filter(b =>
          b.opening_debit !== 0 ||
          b.opening_credit !== 0 ||
          b.period_debit !== 0 ||
          b.period_credit !== 0
        );

      console.log('✅ Balance array generated:', balanceArray.length, 'accounts with movement');
      console.log('📊 Sample balances:', balanceArray.slice(0, 3));

      setBalances(balanceArray);
    } catch (error) {
      console.error('❌ Error fetching manual trial balance:', error);
      alert(isRTL ? 'حدث خطأ في جلب البيانات' : 'Error fetching data');
    }
  };

  const calculateTotals = () => {
    return balances.reduce(
      (acc, row) => ({
        opening_debit: acc.opening_debit + row.opening_debit,
        opening_credit: acc.opening_credit + row.opening_credit,
        period_debit: acc.period_debit + row.period_debit,
        period_credit: acc.period_credit + row.period_credit,
        closing_debit: acc.closing_debit + row.closing_debit,
        closing_credit: acc.closing_credit + row.closing_credit
      }),
      {
        opening_debit: 0,
        opening_credit: 0,
        period_debit: 0,
        period_credit: 0,
        closing_debit: 0,
        closing_credit: 0
      }
    );
  };

  const exportToExcel = () => {
    const totals = calculateTotals();

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

    // إضافة صف الإجماليات
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
  };

  const exportToPDF = () => {
    const doc = new jsPDF('l', 'mm', 'a4');
    const totals = calculateTotals();

    // إعداد الخط العربي إذا كان RTL
    if (isRTL) {
      doc.setLanguage('ar');
    }

    // العنوان
    doc.setFontSize(16);
    doc.text(isRTL ? 'ميزان المراجعة' : 'Trial Balance', doc.internal.pageSize.width / 2, 15, { align: 'center' });

    doc.setFontSize(10);
    doc.text(
      `${isRTL ? 'من تاريخ' : 'From'}: ${format(new Date(fromDate), 'dd/MM/yyyy')} ${isRTL ? 'إلى' : 'To'}: ${format(new Date(asOfDate), 'dd/MM/yyyy')}`,
      doc.internal.pageSize.width / 2,
      22,
      { align: 'center' }
    );

    // البيانات
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

    // إضافة صف الإجماليات
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
  };

  const filteredBalances = accountTypeFilter === 'all'
    ? balances
    : balances.filter(b => b.account_type === accountTypeFilter);

  const totals = calculateTotals();

  // التحقق من التوازن
  const isBalanced =
    Math.abs(totals.opening_debit - totals.opening_credit) < 0.01 &&
    Math.abs(totals.period_debit - totals.period_credit) < 0.01 &&
    Math.abs(totals.closing_debit - totals.closing_credit) < 0.01;

  return (
    <div className="container mx-auto p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-2xl">
                {isRTL ? 'ميزان المراجعة' : 'Trial Balance'}
              </CardTitle>
              <CardDescription>
                {isRTL ? 'عرض أرصدة الحسابات وحركاتها' : 'Display account balances and movements'}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={exportToExcel} variant="outline">
                <FileSpreadsheet className="h-4 w-4 ml-2" />
                {isRTL ? 'تصدير Excel' : 'Export Excel'}
              </Button>
              <Button onClick={exportToPDF} variant="outline">
                <FileText className="h-4 w-4 ml-2" />
                {isRTL ? 'تصدير PDF' : 'Export PDF'}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div>
              <Label htmlFor="from_date">{isRTL ? 'من تاريخ' : 'From Date'}</Label>
              <Input
                type="date"
                id="from_date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="as_of_date">{isRTL ? 'إلى تاريخ' : 'As Of Date'}</Label>
              <Input
                type="date"
                id="as_of_date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="account_type">{isRTL ? 'نوع الحساب' : 'Account Type'}</Label>
              <select
                id="account_type"
                value={accountTypeFilter}
                onChange={(e) => setAccountTypeFilter(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                <option value="all">{isRTL ? 'الكل' : 'All'}</option>
                <option value="asset">{isRTL ? 'أصول' : 'Assets'}</option>
                <option value="liability">{isRTL ? 'التزامات' : 'Liabilities'}</option>
                <option value="equity">{isRTL ? 'حقوق ملكية' : 'Equity'}</option>
                <option value="revenue">{isRTL ? 'إيرادات' : 'Revenue'}</option>
                <option value="expense">{isRTL ? 'مصروفات' : 'Expenses'}</option>
              </select>
            </div>

            <div className="flex items-end">
              <Button onClick={fetchTrialBalance} disabled={loading} className="w-full">
                <RefreshCw className={`h-4 w-4 ml-2 ${loading ? 'animate-spin' : ''}`} />
                {loading
                  ? (isRTL ? 'جاري التحميل...' : 'Loading...')
                  : (isRTL ? 'تحديث' : 'Refresh')}
              </Button>
            </div>
          </div>

          {!isBalanced && balances.length > 0 && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-800 font-semibold">
                {isRTL
                  ? '⚠️ تحذير: ميزان المراجعة غير متوازن! يرجى مراجعة القيود المحاسبية'
                  : '⚠️ Warning: Trial Balance is not balanced! Please review journal entries'}
              </p>
            </div>
          )}

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-gray-50">
                  <TableHead rowSpan={2} className="border-r">{isRTL ? 'كود الحساب' : 'Account Code'}</TableHead>
                  <TableHead rowSpan={2} className="border-r">{isRTL ? 'اسم الحساب' : 'Account Name'}</TableHead>
                  <TableHead colSpan={2} className="text-center border-r">{isRTL ? 'الرصيد الافتتاحي' : 'Opening Balance'}</TableHead>
                  <TableHead colSpan={2} className="text-center border-r">{isRTL ? 'حركة الفترة' : 'Period Movement'}</TableHead>
                  <TableHead colSpan={2} className="text-center">{isRTL ? 'الرصيد الختامي' : 'Closing Balance'}</TableHead>
                </TableRow>
                <TableRow className="bg-gray-50">
                  <TableHead className="text-right">{isRTL ? 'مدين' : 'Debit'}</TableHead>
                  <TableHead className="text-right border-r">{isRTL ? 'دائن' : 'Credit'}</TableHead>
                  <TableHead className="text-right">{isRTL ? 'مدين' : 'Debit'}</TableHead>
                  <TableHead className="text-right border-r">{isRTL ? 'دائن' : 'Credit'}</TableHead>
                  <TableHead className="text-right">{isRTL ? 'مدين' : 'Debit'}</TableHead>
                  <TableHead className="text-right">{isRTL ? 'دائن' : 'Credit'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      {isRTL ? 'جاري التحميل...' : 'Loading...'}
                    </TableCell>
                  </TableRow>
                ) : filteredBalances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      {isRTL ? 'لا توجد بيانات' : 'No data found'}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {filteredBalances.map((row, index) => (
                      <TableRow key={index} className="hover:bg-gray-100 bg-white">
                        <TableCell className="font-mono font-medium border-r text-gray-900 bg-white">{row.account_code}</TableCell>
                        <TableCell className="border-r text-gray-900 bg-white">
                          {isRTL ? (row.account_name_ar || row.account_name) : row.account_name}
                        </TableCell>
                        <TableCell className="text-right font-mono text-gray-900 bg-white" dir="ltr">
                          {row.opening_debit > 0 ? row.opening_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono border-r text-gray-900 bg-white" dir="ltr">
                          {row.opening_credit > 0 ? row.opening_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-gray-900 bg-white" dir="ltr">
                          {row.period_debit > 0 ? row.period_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono border-r text-gray-900 bg-white" dir="ltr">
                          {row.period_credit > 0 ? row.period_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-gray-900 bg-white" dir="ltr">
                          {row.closing_debit > 0 ? row.closing_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono text-gray-900 bg-white" dir="ltr">
                          {row.closing_credit > 0 ? row.closing_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* صف الإجماليات */}
                    <TableRow className="bg-blue-100 font-bold border-t-2 border-blue-200">
                      <TableCell colSpan={2} className="text-center border-r text-gray-900 bg-blue-100">
                        {isRTL ? 'الإجماليات' : 'TOTALS'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-gray-900 bg-blue-100" dir="ltr">
                        {totals.opening_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono border-r text-gray-900 bg-blue-100" dir="ltr">
                        {totals.opening_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-gray-900 bg-blue-100" dir="ltr">
                        {totals.period_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono border-r text-gray-900 bg-blue-100" dir="ltr">
                        {totals.period_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-gray-900 bg-blue-100" dir="ltr">
                        {totals.closing_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono text-gray-900 bg-blue-100" dir="ltr">
                        {totals.closing_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>

                    {/* صف الفروقات */}
                    <TableRow className={`font-bold ${isBalanced ? 'bg-green-50' : 'bg-red-50'}`}>
                      <TableCell colSpan={2} className="text-center border-r">
                        {isRTL ? 'الفرق' : 'Difference'}
                      </TableCell>
                      <TableCell colSpan={2} className="text-center font-mono border-r" dir="ltr">
                        {Math.abs(totals.opening_debit - totals.opening_credit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell colSpan={2} className="text-center font-mono border-r" dir="ltr">
                        {Math.abs(totals.period_debit - totals.period_credit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell colSpan={2} className="text-center font-mono" dir="ltr">
                        {Math.abs(totals.closing_debit - totals.closing_credit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  </>
                )}
              </TableBody>
            </Table>
          </div>

          {isBalanced && balances.length > 0 && (
            <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-green-800 font-semibold text-center">
                {isRTL
                  ? '✓ ميزان المراجعة متوازن'
                  : '✓ Trial Balance is Balanced'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TrialBalance;
