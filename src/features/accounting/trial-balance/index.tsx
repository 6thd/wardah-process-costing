import { useState } from 'react';
import { FileSpreadsheet, FileText, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { useTrialBalance } from './hooks/useTrialBalance';
import { calculateTotals, filterBalancesByType } from './utils/trialBalanceHelpers';
import { exportToExcel, exportToPDF } from './utils/trialBalanceExport';

const TrialBalance = () => {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [asOfDate, setAsOfDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [fromDate, setFromDate] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'));
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>('all');

  const { balances, loading, fetchTrialBalance } = useTrialBalance(fromDate, asOfDate, isRTL);
  const filteredBalances = filterBalancesByType(balances, accountTypeFilter);
  const totals = calculateTotals(filteredBalances);

  const handleExportExcel = () => {
    exportToExcel({
      balances: filteredBalances,
      totals,
      fromDate,
      asOfDate,
      isRTL
    });
  };

  const handleExportPDF = () => {
    exportToPDF({
      balances: filteredBalances,
      totals,
      fromDate,
      asOfDate,
      isRTL
    });
  };


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
              <Button onClick={handleExportExcel} variant="outline">
                <FileSpreadsheet className="h-4 w-4 ml-2" />
                {isRTL ? 'تصدير Excel' : 'Export Excel'}
              </Button>
              <Button onClick={handleExportPDF} variant="outline">
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
                {(() => {
                  if (loading) {
                    return isRTL ? 'جاري التحميل...' : 'Loading...';
                  }
                  return isRTL ? 'تحديث' : 'Refresh';
                })()}
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
                    {filteredBalances.map((row) => (
                      <TableRow key={`${row.account_code}-${row.account_name}`} className="hover:bg-gray-100 bg-white">
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
                {(() => {
                  if (isRTL) {
                    return '✓ ميزان المراجعة متوازن';
                  }
                  return '✓ Trial Balance is Balanced';
                })()}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TrialBalance;
