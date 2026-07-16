import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { JournalService } from '@/services/accounting/journal-service';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Download, FileText, Search, Calendar as CalendarIcon, X, Eye } from 'lucide-react';
// P4-D2: xlsx/jspdf تُحمَّلان كسولاً عند التصدير فقط
import { loadXLSX, loadJsPDF } from '@/lib/export-libs';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface AccountStatementLine {
  entry_date: string;
  entry_number: string;
  description: string;
  description_ar?: string;
  debit: number;
  credit: number;
  balance: number;
  running_balance: number;
  reference_type?: string;
  reference_number?: string;
}

interface GLAccount {
  id: string;
  code: string;
  name: string;
  name_ar?: string; // Optional - may not exist in all schemas
  category: string;
}

export function AccountStatement() {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [accounts, setAccounts] = useState<GLAccount[]>([]);
  const [filteredAccounts, setFilteredAccounts] = useState<GLAccount[]>([]);
  const [accountSearchTerm, setAccountSearchTerm] = useState<string>('');
  const [selectedAccount, setSelectedAccount] = useState<string>('');
  const [fromDate, setFromDate] = useState<Date | undefined>(undefined);
  const [toDate, setToDate] = useState<Date>(new Date());
  const [isAccountSelectOpen, setIsAccountSelectOpen] = useState(false);
  const [statementLines, setStatementLines] = useState<AccountStatementLine[]>([]);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<any>(null);
  const [entryDialogOpen, setEntryDialogOpen] = useState(false);
  const [loadingEntry, setLoadingEntry] = useState(false);

  useEffect(() => {
    fetchAccounts();
  }, []);

  // Filter accounts based on search term
  useEffect(() => {
    if (!accountSearchTerm.trim()) {
      setFilteredAccounts(accounts);
    } else {
      const searchLower = accountSearchTerm.toLowerCase();
      const filtered = accounts.filter(account =>
        account.code.toLowerCase().includes(searchLower) ||
        account.name.toLowerCase().includes(searchLower) ||
        (account.name_ar && account.name_ar.toLowerCase().includes(searchLower))
      );
      setFilteredAccounts(filtered);
    }
  }, [accountSearchTerm, accounts]);

  const fetchAccounts = async () => {
    try {
      // Try gl_accounts first (current table) - select only existing columns
      let { data, error } = await supabase
        .from('gl_accounts')
        .select('id, code, name, category')
        .eq('is_active', true)
        .eq('allow_posting', true) // Only posting accounts
        .order('code');

      // If error, try with name_ar if it exists, or without it
      if (error && error.message?.includes('name_ar')) {
        // Try without name_ar
        const { data: dataWithoutAr, error: errorWithoutAr } = await supabase
          .from('gl_accounts')
          .select('id, code, name, category')
          .eq('is_active', true)
          .eq('allow_posting', true)
          .order('code');

        if (!errorWithoutAr) {
          data = dataWithoutAr;
          error = null;
        }
      }

      // If still no data, try accounts table as fallback
      if (error || !data || data.length === 0) {
        try {
          const { data: accountsData, error: accountsError } = await supabase
            .from('accounts')
            .select('id, code, name, name_ar, account_type')
            .eq('is_active', true)
            .eq('is_leaf', true) // Only leaf accounts
            .order('code');

          if (!accountsError && accountsData) {
            // Map account_type to category
            data = accountsData.map((acc: any) => ({
              ...acc,
              category: acc.account_type
            }));
            error = null;
          }
        } catch (fallbackError) {
          // Ignore fallback errors
          console.warn('Fallback to accounts table failed:', fallbackError);
        }
      }

      if (error) {
        console.error('Error fetching accounts:', error);
        toast.error(t('accounting.accountStatement.errorFetchAccounts'));
      } else {
        // Map data to include name_ar as optional (may not exist)
        const mappedData = (data || []).map((account: any) => ({
          ...account,
          name_ar: account.name_ar || account.name // Use name_ar if exists, otherwise use name
        }));
        setAccounts(mappedData);
        setFilteredAccounts(mappedData); // Initialize filtered accounts
        if (mappedData.length === 0) {
          console.warn('No accounts found');
        }
      }
    } catch (error: any) {
      console.error('Error fetching accounts:', error);
      toast.error(t('accounting.accountStatement.errorFetchAccounts2'));
    }
  };

  const fetchStatement = async () => {
    if (!selectedAccount) {
      toast.warning(t('accounting.accountStatement.pleaseSelectAccount'));
      return;
    }

    setLoading(true);
    try {
      // Format dates for API
      const fromDateStr = fromDate ? format(fromDate, 'yyyy-MM-dd') : null;
      const toDateStr = format(toDate, 'yyyy-MM-dd');

      // Get account code first
      const account = accounts.find(a => a.id === selectedAccount);
      if (!account) {
        throw new Error(t('accounting.accountStatement.accountNotFound'));
      }

      // Try the RPC function first (using account code, not ID)
      let { data, error } = await supabase.rpc('get_account_statement', {
        p_account_code: account.code,
        p_from_date: fromDateStr,
        p_to_date: toDateStr
      });

      // If RPC fails, fall back to direct gl_entry_lines query
      if (error) {
        console.warn('RPC function failed, trying direct query:', error);

        let fallbackQuery = supabase
          .from('gl_entry_lines')
          .select(`
            *,
            entry:gl_entries!inner (
              entry_date,
              entry_number,
              description,
              description_ar,
              reference_type,
              reference_number,
              status
            )
          `)
          .eq('account_id', selectedAccount)
          .eq('entry.status', 'posted');

        if (fromDateStr) {
          fallbackQuery = fallbackQuery.gte('entry.entry_date', fromDateStr);
        }
        fallbackQuery = fallbackQuery.lte('entry.entry_date', toDateStr);

        const { data: linesData, error: linesError } = await fallbackQuery;
        if (linesError) throw linesError;

        const sortedLines = (linesData || []).sort((a: any, b: any) => {
          const dateA = new Date(a.entry.entry_date);
          const dateB = new Date(b.entry.entry_date);
          if (dateA.getTime() !== dateB.getTime()) return dateA.getTime() - dateB.getTime();
          return (a.line_number || 0) - (b.line_number || 0);
        });

        let runningBalance = 0;
        const transformedLines = sortedLines.map((line: any) => {
          const entry = line.entry;
          const balance = (line.debit || 0) - (line.credit || 0);
          runningBalance += balance;
          return {
            entry_date: entry.entry_date,
            entry_number: entry.entry_number,
            description: line.description || entry.description,
            description_ar: line.description_ar || entry.description_ar,
            debit: line.debit || 0,
            credit: line.credit || 0,
            balance,
            running_balance: runningBalance,
            reference_type: entry.reference_type,
            reference_number: entry.reference_number
          };
        });

        data = transformedLines;
        error = null;
      }

      if (error) throw error;

      const lines = (data || []) as AccountStatementLine[];
      setStatementLines(lines);

      // Calculate opening balance (first running balance - first balance)
      if (lines.length > 0) {
        setOpeningBalance(lines[0].running_balance - lines[0].balance);
      } else {
        setOpeningBalance(0);
      }
    } catch (error: any) {
      console.error('Error fetching statement:', error);
      toast.error(error.message || t('accounting.accountStatement.errorFetchStatement'));
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = async () => {
    const XLSX = await loadXLSX();
    if (statementLines.length === 0) return;

    const selectedAccountData = accounts.find(a => a.id === selectedAccount);
    const accountName = isRTL
      ? (selectedAccountData?.name_ar || selectedAccountData?.name)
      : selectedAccountData?.name;

    const wsData = [
      [t('accounting.accountStatement.title')],
      [t('accounting.account'), `${selectedAccountData?.code} - ${accountName}`],
      [t('accounting.accountStatement.fromDate'), fromDate ? format(fromDate, 'dd/MM/yyyy') : t('accounting.accountStatement.beginning')],
      [t('accounting.accountStatement.toDate'), format(toDate, 'dd/MM/yyyy')],
      [],
      [
        t('common.date'),
        t('accounting.entryNumber'),
        t('common.description'),
        t('accounting.debit'),
        t('accounting.credit'),
        t('accounting.balance'),
        t('accounting.runningBalance')
      ],
      ...statementLines.map(line => [
        format(new Date(line.entry_date), 'dd/MM/yyyy'),
        line.entry_number,
        isRTL ? (line.description_ar || line.description) : line.description,
        line.debit,
        line.credit,
        line.balance,
        line.running_balance
      ])
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    XLSX.utils.book_append_sheet(wb, ws, t('accounting.accountStatement.title'));
    XLSX.writeFile(wb, `AccountStatement_${selectedAccountData?.code}_${format(toDate, 'yyyy-MM-dd')}.xlsx`);
  };

  const exportToPDF = async () => {
    const jsPDF = await loadJsPDF();
    if (statementLines.length === 0) return;

    const selectedAccountData = accounts.find(a => a.id === selectedAccount);
    const accountName = isRTL
      ? (selectedAccountData?.name_ar || selectedAccountData?.name)
      : selectedAccountData?.name;

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(t('accounting.accountStatement.title'), 14, 15);

    doc.setFontSize(10);
    doc.text(`${t('accounting.account')}: ${selectedAccountData?.code} - ${accountName}`, 14, 25);
    doc.text(`${t('accounting.accountStatement.fromDate')}: ${fromDate ? format(fromDate, 'dd/MM/yyyy') : t('accounting.accountStatement.beginning')}`, 14, 30);
    doc.text(`${t('accounting.accountStatement.toDate')}: ${format(toDate, 'dd/MM/yyyy')}`, 14, 35);

    const tableData = statementLines.map(line => [
      format(new Date(line.entry_date), 'dd/MM/yyyy'),
      line.entry_number,
      (isRTL ? (line.description_ar || line.description) : line.description).substring(0, 30),
      line.debit.toFixed(2),
      line.credit.toFixed(2),
      line.balance.toFixed(2),
      line.running_balance.toFixed(2)
    ]);

    (doc as any).autoTable({
      head: [[
        t('common.date'),
        t('accounting.entryNumber'),
        t('common.description'),
        t('accounting.debit'),
        t('accounting.credit'),
        t('accounting.balance'),
        t('accounting.runningBalance')
      ]],
      body: tableData,
      startY: 40,
      styles: { fontSize: 8 }
    });

    doc.save(`AccountStatement_${selectedAccountData?.code}_${format(toDate, 'yyyy-MM-dd')}.pdf`);
  };

  const handleViewEntry = async (entryNumber: string) => {
    setLoadingEntry(true);
    try {
      // Find entry by entry_number
      const { data: entries, error } = await supabase
        .from('gl_entries')
        .select('id')
        .eq('entry_number', entryNumber)
        .limit(1);

      if (error) throw error;

      if (!entries || entries.length === 0) {
        toast.error(t('accounting.accountStatement.entryNotFound'));
        return;
      }

      // Get full entry details
      const entryDetails = await JournalService.getEntryWithDetails(entries[0].id);

      if (entryDetails) {
        setViewingEntry(entryDetails);
        setEntryDialogOpen(true);
      } else {
        toast.error(t('accounting.accountStatement.failedFetchEntry'));
      }
    } catch (error: any) {
      console.error('Error fetching entry:', error);
      toast.error(error.message || t('accounting.accountStatement.errorOccurred'));
    } finally {
      setLoadingEntry(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
      draft: 'secondary',
      posted: 'default',
      reversed: 'outline'
    };
    const variant = variants[status] || 'secondary';
    return <Badge variant={variant}>{t(`accounting.status.${status}`)}</Badge>;
  };

  const selectedAccountData = accounts.find(a => a.id === selectedAccount);
  const closingBalance = statementLines.length > 0
    ? statementLines[statementLines.length - 1].running_balance
    : openingBalance;

  return (
    <div className="container mx-auto p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {t('accounting.accountStatement.title')}
          </CardTitle>
          <CardDescription>
            {t('accounting.accountStatement.subtitle')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Account Select with Search */}
              <div className="space-y-2">
                <Label>{t('accounting.account')}</Label>
                <Popover open={isAccountSelectOpen} onOpenChange={setIsAccountSelectOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      className={cn(
                        "w-full justify-between",
                        !selectedAccount && "text-muted-foreground"
                      )}
                    >
                      {selectedAccount
                        ? (() => {
                            const account = accounts.find(a => a.id === selectedAccount);
                            return account
                              ? `${account.code} - ${isRTL ? (account.name_ar || account.name) : account.name}`
                              : t('accounting.accountStatement.selectAccount');
                          })()
                        : t('accounting.accountStatement.selectAccount')}
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <div className="p-2 border-b">
                      <div className="relative">
                        <Search className={`absolute ${isRTL ? 'right-2' : 'left-2'} top-2.5 h-4 w-4 text-muted-foreground`} />
                        <Input
                          type="text"
                          placeholder={t('accounting.accountStatement.searchByCodeOrName')}
                          value={accountSearchTerm}
                          onChange={(e) => setAccountSearchTerm(e.target.value)}
                          className={isRTL ? 'pr-8' : 'pl-8'}
                        />
                        {accountSearchTerm && (
                          <button
                            onClick={() => setAccountSearchTerm('')}
                            className={`absolute ${isRTL ? 'left-2' : 'right-2'} top-2.5 text-muted-foreground hover:text-foreground`}
                          >
                            <X className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="max-h-[300px] overflow-auto">
                      {filteredAccounts.length === 0 ? (
                        <div className="p-4 text-sm text-muted-foreground text-center">
                          {t('accounting.accountStatement.noAccounts')}
                        </div>
                      ) : (
                        <div className="p-1">
                          {filteredAccounts.map((account) => (
                            <button
                              key={account.id}
                              onClick={() => {
                                setSelectedAccount(account.id);
                                setIsAccountSelectOpen(false);
                                setAccountSearchTerm('');
                              }}
                              className={cn(
                                "w-full text-right px-3 py-2 text-sm rounded-md hover:bg-accent hover:text-accent-foreground transition-colors",
                                selectedAccount === account.id && "bg-accent"
                              )}
                            >
                              <div className="font-medium">{account.code}</div>
                              <div className="text-xs text-muted-foreground">
                                {isRTL ? (account.name_ar || account.name) : account.name}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {accountSearchTerm && filteredAccounts.length > 0 && (
                      <div className="p-2 border-t text-xs text-muted-foreground text-center">
                        {t('accounting.accountStatement.xOfY', { count: filteredAccounts.length, total: accounts.length })}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              {/* From Date Picker */}
              <div className="space-y-2">
                <Label>{t('accounting.accountStatement.fromDate')}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-start font-normal",
                        !fromDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {fromDate ? (
                        format(fromDate, 'dd/MM/yyyy', { locale: isRTL ? ar : undefined })
                      ) : (
                        <span>{t('accounting.accountStatement.optional')}</span>
                      )}
                      {fromDate && (
                        <X
                          className="ml-auto h-4 w-4 opacity-50 hover:opacity-100"
                          onClick={(e) => {
                            e.stopPropagation();
                            setFromDate(undefined);
                          }}
                        />
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={fromDate}
                      onSelect={setFromDate}
                      initialFocus
                      locale={isRTL ? ar : undefined}
                      dir={isRTL ? 'rtl' : 'ltr'}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              {/* To Date Picker */}
              <div className="space-y-2">
                <Label>{t('accounting.accountStatement.toDate')}</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-start font-normal",
                        !toDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {toDate ? (
                        format(toDate, 'dd/MM/yyyy', { locale: isRTL ? ar : undefined })
                      ) : (
                        <span>{t('accounting.accountStatement.selectDate')}</span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={toDate}
                      onSelect={(date) => date && setToDate(date)}
                      initialFocus
                      locale={isRTL ? ar : undefined}
                      dir={isRTL ? 'rtl' : 'ltr'}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="flex items-end">
                <Button onClick={fetchStatement} disabled={loading || !selectedAccount} className="w-full">
                  <Search className="h-4 w-4 mr-2" />
                  {loading ? t('accounting.accountStatement.loadingShort') : t('accounting.accountStatement.view')}
                </Button>
              </div>
            </div>

            {/* Summary */}
            {statementLines.length > 0 && (
              <div className="grid grid-cols-3 gap-4 p-4 bg-muted/50 rounded-lg">
                <div>
                  <p className="text-sm text-muted-foreground">{t('accounting.openingBalance')}</p>
                  <p className="text-lg font-bold">{openingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('accounting.periodMovement')}</p>
                  <p className="text-lg font-bold">
                    {(closingBalance - openingBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('accounting.closingBalance')}</p>
                  <p className="text-lg font-bold">{closingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
              </div>
            )}

            {/* Statement Table */}
            {statementLines.length > 0 && (
              <>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={exportToExcel}>
                    <Download className="h-4 w-4 mr-2" />
                    Excel
                  </Button>
                  <Button variant="outline" onClick={exportToPDF}>
                    <FileText className="h-4 w-4 mr-2" />
                    PDF
                  </Button>
                </div>

                <div className="border rounded-lg">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('common.date')}</TableHead>
                        <TableHead>{t('accounting.entryNumber')}</TableHead>
                        <TableHead>{t('common.description')}</TableHead>
                        <TableHead className="text-right">{t('accounting.debit')}</TableHead>
                        <TableHead className="text-right">{t('accounting.credit')}</TableHead>
                        <TableHead className="text-right">{t('accounting.balance')}</TableHead>
                        <TableHead className="text-right">{t('accounting.runningBalance')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {statementLines.map((line, index) => (
                        <TableRow key={index} className="hover:bg-accent/50">
                          <TableCell>{format(new Date(line.entry_date), 'dd/MM/yyyy')}</TableCell>
                          <TableCell>
                            <button
                              onClick={() => handleViewEntry(line.entry_number)}
                              className="font-mono text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline flex items-center gap-1 transition-colors"
                              title={t('accounting.accountStatement.viewEntryDetails')}
                            >
                              {line.entry_number}
                              <Eye className="h-3 w-3 inline opacity-70" />
                            </button>
                          </TableCell>
                          <TableCell>{isRTL ? (line.description_ar || line.description) : line.description}</TableCell>
                          <TableCell className="text-right font-mono">
                            {line.debit > 0 ? line.debit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {line.credit > 0 ? line.credit.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {line.balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </TableCell>
                          <TableCell className="text-right font-mono font-bold">
                            {line.running_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {!loading && statementLines.length === 0 && selectedAccount && (
              <EmptyState
                title={t('accounting.accountStatement.noTransactions')}
                description={t('accounting.accountStatement.noTransactionsDesc')}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Entry Details Dialog */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {t('accounting.entryDetails')} - {viewingEntry?.entry_number}
            </DialogTitle>
            <DialogDescription>
              {t('accounting.accountStatement.viewCompleteEntry')}
            </DialogDescription>
          </DialogHeader>

          {loadingEntry ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : viewingEntry ? (
            <div className="space-y-4">
              {/* Entry Header Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 dark:bg-gray-900 rounded-lg">
                <div>
                  <Label className="text-xs text-muted-foreground">{t('common.date')}</Label>
                  <p className="font-medium">
                    {format(new Date(viewingEntry.entry_date), 'dd/MM/yyyy', { locale: isRTL ? ar : undefined })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('common.status')}</Label>
                  <div className="mt-1">{getStatusBadge(viewingEntry.status)}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('accounting.accountStatement.totalDebit')}</Label>
                  <p className="font-mono font-medium">
                    {Number(viewingEntry.total_debit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('accounting.accountStatement.totalCredit')}</Label>
                  <p className="font-mono font-medium">
                    {Number(viewingEntry.total_credit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Description */}
              {(viewingEntry.description || viewingEntry.description_ar) && (
                <div>
                  <Label>{t('common.description')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {isRTL ? (viewingEntry.description_ar || viewingEntry.description) : viewingEntry.description}
                  </p>
                </div>
              )}

              {/* Entry Lines */}
              {viewingEntry.lines && viewingEntry.lines.length > 0 && (
                <div className="border rounded-lg">
                  <div className="p-3 border-b bg-muted/50 dark:bg-gray-900">
                    <h3 className="font-semibold">{t('accounting.entryLines')}</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>{t('accounting.account')}</TableHead>
                        <TableHead className="text-right">{t('accounting.debit')}</TableHead>
                        <TableHead className="text-right">{t('accounting.credit')}</TableHead>
                        <TableHead>{t('common.description')}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {viewingEntry.lines.map((line: any, index: number) => (
                        <TableRow key={line.id || index}>
                          <TableCell className="font-mono text-xs">{line.line_number || index + 1}</TableCell>
                          <TableCell>
                            {line.account_code || 'N/A'} - {isRTL
                              ? (line.account_name_ar || line.account_name || 'N/A')
                              : (line.account_name || 'N/A')}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(line.debit || 0) > 0
                              ? Number(line.debit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })
                              : '-'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {Number(line.credit || 0) > 0
                              ? Number(line.credit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })
                              : '-'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {isRTL ? (line.description_ar || line.description || '-') : (line.description || '-')}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totals Row */}
                      <TableRow className="font-bold bg-muted/50 dark:bg-gray-900">
                        <TableCell colSpan={2} className="text-right">
                          {t('common.total')}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(viewingEntry.total_debit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {Number(viewingEntry.total_credit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell></TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}

              {/* Reference Info */}
              {(viewingEntry.reference_type || viewingEntry.reference_number) && (
                <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
                  <Label className="text-xs text-muted-foreground">{t('accounting.accountStatement.reference')}</Label>
                  <p className="text-sm">
                    {viewingEntry.reference_type && (
                      <span className="font-medium">{viewingEntry.reference_type}: </span>
                    )}
                    {viewingEntry.reference_number || '-'}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              {t('accounting.accountStatement.noData')}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
