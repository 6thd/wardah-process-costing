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
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [asOfDate, setAsOfDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [fromDate, setFromDate] = useState(format(new Date(new Date().getFullYear(), 0, 1), 'yyyy-MM-dd'));
  const [accountTypeFilter, setAccountTypeFilter] = useState<string>('all');

  const { balances, loading, fetchTrialBalance } = useTrialBalance(fromDate, asOfDate);
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
                {t('accounting.trialBalance.title')}
              </CardTitle>
              <CardDescription>
                {t('accounting.trialBalance.subtitle')}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleExportExcel} variant="outline">
                <FileSpreadsheet className="h-4 w-4 me-2" />
                {t('accounting.trialBalance.exportExcel')}
              </Button>
              <Button onClick={handleExportPDF} variant="outline">
                <FileText className="h-4 w-4 me-2" />
                {t('accounting.trialBalance.exportPDF')}
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div>
              <Label htmlFor="from_date">{t('accounting.trialBalance.fromDate')}</Label>
              <Input
                type="date"
                id="from_date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="as_of_date">{t('accounting.trialBalance.asOfDate')}</Label>
              <Input
                type="date"
                id="as_of_date"
                value={asOfDate}
                onChange={(e) => setAsOfDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="account_type">{t('accounting.trialBalance.accountType')}</Label>
              <select
                id="account_type"
                value={accountTypeFilter}
                onChange={(e) => setAccountTypeFilter(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
              >
                <option value="all">{t('accounting.trialBalance.all')}</option>
                <option value="asset">{t('accounting.trialBalance.assets')}</option>
                <option value="liability">{t('accounting.trialBalance.liabilities')}</option>
                <option value="equity">{t('accounting.trialBalance.equity')}</option>
                <option value="revenue">{t('accounting.trialBalance.revenue')}</option>
                <option value="expense">{t('accounting.trialBalance.expenses')}</option>
              </select>
            </div>

            <div className="flex items-end">
              <Button onClick={fetchTrialBalance} disabled={loading} className="w-full">
                <RefreshCw className={`h-4 w-4 me-2 ${loading ? 'animate-spin' : ''}`} />
                {loading ? t('common.loading') : t('common.refresh')}
              </Button>
            </div>
          </div>

          {!isBalanced && balances.length > 0 && (
            <div className="mb-4 p-4 bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-900 rounded-lg">
              <p className="text-red-800 dark:text-red-300 font-semibold">
                {t('accounting.trialBalance.warning')}
              </p>
            </div>
          )}

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead rowSpan={2} className="border-e">{t('accounting.trialBalance.accountCode')}</TableHead>
                  <TableHead rowSpan={2} className="border-e">{t('accounting.trialBalance.accountName')}</TableHead>
                  <TableHead colSpan={2} className="text-center border-e">{t('accounting.openingBalance')}</TableHead>
                  <TableHead colSpan={2} className="text-center border-e">{t('accounting.periodMovement')}</TableHead>
                  <TableHead colSpan={2} className="text-center">{t('accounting.closingBalance')}</TableHead>
                </TableRow>
                <TableRow className="bg-muted/50">
                  <TableHead className="text-right">{t('accounting.debit')}</TableHead>
                  <TableHead className="text-right border-e">{t('accounting.credit')}</TableHead>
                  <TableHead className="text-right">{t('accounting.debit')}</TableHead>
                  <TableHead className="text-right border-e">{t('accounting.credit')}</TableHead>
                  <TableHead className="text-right">{t('accounting.debit')}</TableHead>
                  <TableHead className="text-right">{t('accounting.credit')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      {t('common.loading')}
                    </TableCell>
                  </TableRow>
                ) : filteredBalances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">
                      {t('accounting.trialBalance.noData')}
                    </TableCell>
                  </TableRow>
                ) : (
                  <>
                    {filteredBalances.map((row) => (
                      <TableRow key={`${row.account_code}-${row.account_name}`} className="hover:bg-muted/50">
                        <TableCell className="font-mono font-medium border-e">{row.account_code}</TableCell>
                        <TableCell className="border-e">
                          {isRTL ? (row.account_name_ar || row.account_name) : row.account_name}
                        </TableCell>
                        <TableCell className="text-right font-mono" dir="ltr">
                          {row.opening_debit > 0 ? row.opening_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono border-e" dir="ltr">
                          {row.opening_credit > 0 ? row.opening_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono" dir="ltr">
                          {row.period_debit > 0 ? row.period_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono border-e" dir="ltr">
                          {row.period_credit > 0 ? row.period_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono" dir="ltr">
                          {row.closing_debit > 0 ? row.closing_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                        <TableCell className="text-right font-mono" dir="ltr">
                          {row.closing_credit > 0 ? row.closing_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </TableCell>
                      </TableRow>
                    ))}

                    {/* صف الإجماليات */}
                    <TableRow className="bg-blue-100 dark:bg-blue-950/60 font-bold border-t-2 border-blue-200 dark:border-blue-800">
                      <TableCell colSpan={2} className="text-center border-e">
                        {t('accounting.trialBalance.totals')}
                      </TableCell>
                      <TableCell className="text-right font-mono" dir="ltr">
                        {totals.opening_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono border-e" dir="ltr">
                        {totals.opening_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono" dir="ltr">
                        {totals.period_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono border-e" dir="ltr">
                        {totals.period_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono" dir="ltr">
                        {totals.closing_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono" dir="ltr">
                        {totals.closing_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>

                    {/* صف الفروقات */}
                    <TableRow className={`font-bold ${isBalanced ? 'bg-green-50 dark:bg-green-950/50' : 'bg-red-50 dark:bg-red-950/50'}`}>
                      <TableCell colSpan={2} className="text-center border-e">
                        {t('accounting.trialBalance.difference')}
                      </TableCell>
                      <TableCell colSpan={2} className="text-center font-mono border-e" dir="ltr">
                        {Math.abs(totals.opening_debit - totals.opening_credit).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell colSpan={2} className="text-center font-mono border-e" dir="ltr">
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
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-900 rounded-lg">
              <p className="text-green-800 dark:text-green-300 font-semibold text-center">
                {t('accounting.trialBalance.balanced')}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default TrialBalance;
