import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { JournalService } from '@/services/accounting/journal-service';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { Download, FileText, Search, Calendar as CalendarIcon, X, Eye } from 'lucide-react';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
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
  const { i18n } = useTranslation();
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
        // Show user-friendly error
        alert(isRTL ? 'خطأ في جلب الحسابات. تأكد من وجود بيانات.' : 'Error fetching accounts. Please ensure data exists.');
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
      alert(isRTL ? 'حدث خطأ في جلب الحسابات' : 'An error occurred while fetching accounts');
    }
  };

  const fetchStatement = async () => {
    if (!selectedAccount) {
      alert(isRTL ? 'يرجى اختيار حساب' : 'Please select an account');
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
        throw new Error(isRTL ? 'الحساب غير موجود' : 'Account not found');
      }

      // Try the RPC function first (using account code, not ID)
      let { data, error } = await supabase.rpc('get_account_statement', {
        p_account_code: account.code,
        p_from_date: fromDateStr,
        p_to_date: toDateStr
      });

      // If RPC fails, try manual query
      if (error) {
        console.warn('RPC function failed, trying manual query:', error);

        // Build query with date filters
        let query = supabase
          .from('journal_lines')
          .select(`
            *,
            journal_entries!inner (
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
          .eq('journal_entries.status', 'posted');

        // Add date filters
        if (fromDateStr) {
          query = query.gte('journal_entries.entry_date', fromDateStr);
        }
        query = query.lte('journal_entries.entry_date', toDateStr);

        // Order by entry_date and line_number - fix the order syntax
        const { data: linesData, error: linesError } = await query;

        if (linesError) throw linesError;

        // Sort manually since order with nested relation doesn't work well
        const sortedLines = (linesData || []).sort((a: any, b: any) => {
          const dateA = new Date(a.journal_entries.entry_date);
          const dateB = new Date(b.journal_entries.entry_date);
          if (dateA.getTime() !== dateB.getTime()) {
            return dateA.getTime() - dateB.getTime();
          }
          return (a.line_number || 0) - (b.line_number || 0);
        });

        // Transform data to match expected format
        let runningBalance = 0;
        const transformedLines = sortedLines.map((line: any) => {
          const entry = line.journal_entries;
          const balance = (line.debit || 0) - (line.credit || 0);
          runningBalance += balance;
          
          return {
            entry_date: entry.entry_date,
            entry_number: entry.entry_number,
            description: line.description || entry.description,
            description_ar: line.description_ar || entry.description_ar,
            debit: line.debit || 0,
            credit: line.credit || 0,
            balance: balance,
            running_balance: runningBalance,
            reference_type: entry.reference_type,
            reference_number: entry.reference_number
          };
        });

        data = transformedLines;
        error = null;
      }

      if (error) throw error;

      const lines = data || [];
      setStatementLines(lines);
      
      // Calculate opening balance (first running balance - first balance)
      if (lines.length > 0) {
        setOpeningBalance(lines[0].running_balance - lines[0].balance);
      } else {
        setOpeningBalance(0);
      }
    } catch (error: any) {
      console.error('Error fetching statement:', error);
      alert(error.message || (isRTL ? 'حدث خطأ في جلب كشف الحساب' : 'An error occurred while fetching statement'));
    } finally {
      setLoading(false);
    }
  };

  const exportToExcel = () => {
    if (statementLines.length === 0) return;

    const selectedAccountData = accounts.find(a => a.id === selectedAccount);
    const accountName = isRTL 
      ? (selectedAccountData?.name_ar || selectedAccountData?.name)
      : selectedAccountData?.name;

    const wsData = [
      [isRTL ? 'كشف حساب' : 'Account Statement'],
      [isRTL ? 'الحساب' : 'Account', `${selectedAccountData?.code} - ${accountName}`],
      [isRTL ? 'من تاريخ' : 'From Date', fromDate ? format(fromDate, 'dd/MM/yyyy') : (isRTL ? 'البداية' : 'Beginning')],
      [isRTL ? 'إلى تاريخ' : 'To Date', format(toDate, 'dd/MM/yyyy')],
      [],
      [
        isRTL ? 'التاريخ' : 'Date',
        isRTL ? 'رقم القيد' : 'Entry Number',
        isRTL ? 'الوصف' : 'Description',
        isRTL ? 'مدين' : 'Debit',
        isRTL ? 'دائن' : 'Credit',
        isRTL ? 'الرصيد' : 'Balance',
        isRTL ? 'الرصيد المتحرك' : 'Running Balance'
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
    XLSX.utils.book_append_sheet(wb, ws, isRTL ? 'كشف حساب' : 'Statement');
    XLSX.writeFile(wb, `AccountStatement_${selectedAccountData?.code}_${format(toDate, 'yyyy-MM-dd')}.xlsx`);
  };

  const exportToPDF = () => {
    if (statementLines.length === 0) return;

    const selectedAccountData = accounts.find(a => a.id === selectedAccount);
    const accountName = isRTL 
      ? (selectedAccountData?.name_ar || selectedAccountData?.name)
      : selectedAccountData?.name;

    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(isRTL ? 'كشف حساب' : 'Account Statement', 14, 15);
    
    doc.setFontSize(10);
    doc.text(`${isRTL ? 'الحساب' : 'Account'}: ${selectedAccountData?.code} - ${accountName}`, 14, 25);
    doc.text(`${isRTL ? 'من تاريخ' : 'From Date'}: ${fromDate ? format(fromDate, 'dd/MM/yyyy') : (isRTL ? 'البداية' : 'Beginning')}`, 14, 30);
    doc.text(`${isRTL ? 'إلى تاريخ' : 'To Date'}: ${format(toDate, 'dd/MM/yyyy')}`, 14, 35);

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
        isRTL ? 'التاريخ' : 'Date',
        isRTL ? 'رقم القيد' : 'Entry',
        isRTL ? 'الوصف' : 'Description',
        isRTL ? 'مدين' : 'Debit',
        isRTL ? 'دائن' : 'Credit',
        isRTL ? 'الرصيد' : 'Balance',
        isRTL ? 'المتحرك' : 'Running'
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
        .from('journal_entries')
        .select('id')
        .eq('entry_number', entryNumber)
        .limit(1);

      if (error) throw error;

      if (!entries || entries.length === 0) {
        toast.error(isRTL ? 'القيد غير موجود' : 'Entry not found');
        return;
      }

      // Get full entry details
      const entryDetails = await JournalService.getEntryWithDetails(entries[0].id);
      
      if (entryDetails) {
        setViewingEntry(entryDetails);
        setEntryDialogOpen(true);
      } else {
        toast.error(isRTL ? 'فشل جلب تفاصيل القيد' : 'Failed to fetch entry details');
      }
    } catch (error: any) {
      console.error('Error fetching entry:', error);
      toast.error(error.message || (isRTL ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      setLoadingEntry(false);
    }
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
      draft: { label: isRTL ? 'مسودة' : 'Draft', variant: 'secondary' },
      posted: { label: isRTL ? 'مرحّل' : 'Posted', variant: 'default' },
      reversed: { label: isRTL ? 'معكوس' : 'Reversed', variant: 'outline' }
    };
    const statusInfo = statusMap[status] || { label: status, variant: 'secondary' };
    return <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>;
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
            {isRTL ? 'كشف حساب' : 'Account Statement'}
          </CardTitle>
          <CardDescription>
            {isRTL ? 'عرض تفاصيل حركة حساب معين' : 'View detailed account movement'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {/* Filters */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {/* Account Select with Search */}
              <div className="space-y-2">
                <Label>{isRTL ? 'الحساب' : 'Account'}</Label>
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
                              : (isRTL ? 'اختر الحساب' : 'Select account');
                          })()
                        : (isRTL ? 'اختر الحساب' : 'Select account')}
                      <Search className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[400px] p-0" align="start">
                    <div className="p-2 border-b">
                      <div className="relative">
                        <Search className={`absolute ${isRTL ? 'right-2' : 'left-2'} top-2.5 h-4 w-4 text-muted-foreground`} />
                        <Input
                          type="text"
                          placeholder={isRTL ? 'ابحث بالكود أو الاسم...' : 'Search by code or name...'}
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
                          {isRTL ? 'لا توجد حسابات' : 'No accounts found'}
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
                        {isRTL 
                          ? `${filteredAccounts.length} من ${accounts.length} حساب`
                          : `${filteredAccounts.length} of ${accounts.length} accounts`}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              </div>

              {/* From Date Picker */}
              <div className="space-y-2">
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
                      {fromDate ? (
                        format(fromDate, 'dd/MM/yyyy', { locale: isRTL ? ar : undefined })
                      ) : (
                        <span>{isRTL ? 'اختياري' : 'Optional'}</span>
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
                      {toDate ? (
                        format(toDate, 'dd/MM/yyyy', { locale: isRTL ? ar : undefined })
                      ) : (
                        <span>{isRTL ? 'اختر التاريخ' : 'Select date'}</span>
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
                  {loading ? (isRTL ? 'جاري...' : 'Loading...') : (isRTL ? 'عرض' : 'View')}
                </Button>
              </div>
            </div>

            {/* Summary */}
            {statementLines.length > 0 && (
              <div className="grid grid-cols-3 gap-4 p-4 bg-gray-50 rounded-lg">
                <div>
                  <p className="text-sm text-gray-600">{isRTL ? 'الرصيد الافتتاحي' : 'Opening Balance'}</p>
                  <p className="text-lg font-bold">{openingBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">{isRTL ? 'حركة الفترة' : 'Period Movement'}</p>
                  <p className="text-lg font-bold">
                    {(closingBalance - openingBalance).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-gray-600">{isRTL ? 'الرصيد الختامي' : 'Closing Balance'}</p>
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
                        <TableHead>{isRTL ? 'التاريخ' : 'Date'}</TableHead>
                        <TableHead>{isRTL ? 'رقم القيد' : 'Entry Number'}</TableHead>
                        <TableHead>{isRTL ? 'الوصف' : 'Description'}</TableHead>
                        <TableHead className="text-right">{isRTL ? 'مدين' : 'Debit'}</TableHead>
                        <TableHead className="text-right">{isRTL ? 'دائن' : 'Credit'}</TableHead>
                        <TableHead className="text-right">{isRTL ? 'الرصيد' : 'Balance'}</TableHead>
                        <TableHead className="text-right">{isRTL ? 'الرصيد المتحرك' : 'Running Balance'}</TableHead>
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
                              title={isRTL ? 'عرض تفاصيل القيد' : 'View entry details'}
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
              <div className="text-center py-8 text-gray-500">
                {isRTL ? 'لا توجد حركات' : 'No transactions found'}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Entry Details Dialog */}
      <Dialog open={entryDialogOpen} onOpenChange={setEntryDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {isRTL ? 'تفاصيل القيد' : 'Entry Details'} - {viewingEntry?.entry_number}
            </DialogTitle>
            <DialogDescription>
              {isRTL ? 'عرض تفاصيل القيد الكاملة' : 'View complete entry details'}
            </DialogDescription>
          </DialogHeader>

          {loadingEntry ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            </div>
          ) : viewingEntry ? (
            <div className="space-y-4">
              {/* Entry Header Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg">
                <div>
                  <Label className="text-xs text-muted-foreground">{isRTL ? 'التاريخ' : 'Date'}</Label>
                  <p className="font-medium">
                    {format(new Date(viewingEntry.entry_date), 'dd/MM/yyyy', { locale: isRTL ? ar : undefined })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{isRTL ? 'الحالة' : 'Status'}</Label>
                  <div className="mt-1">{getStatusBadge(viewingEntry.status)}</div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{isRTL ? 'المدين' : 'Total Debit'}</Label>
                  <p className="font-mono font-medium">
                    {Number(viewingEntry.total_debit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{isRTL ? 'الدائن' : 'Total Credit'}</Label>
                  <p className="font-mono font-medium">
                    {Number(viewingEntry.total_credit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              </div>

              {/* Description */}
              {(viewingEntry.description || viewingEntry.description_ar) && (
                <div>
                  <Label>{isRTL ? 'الوصف' : 'Description'}</Label>
                  <p className="text-sm text-muted-foreground">
                    {isRTL ? (viewingEntry.description_ar || viewingEntry.description) : viewingEntry.description}
                  </p>
                </div>
              )}

              {/* Entry Lines */}
              {viewingEntry.lines && viewingEntry.lines.length > 0 && (
                <div className="border rounded-lg">
                  <div className="p-3 border-b bg-gray-50 dark:bg-gray-900">
                    <h3 className="font-semibold">{isRTL ? 'بنود القيد' : 'Entry Lines'}</h3>
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>{isRTL ? 'الحساب' : 'Account'}</TableHead>
                        <TableHead className="text-right">{isRTL ? 'مدين' : 'Debit'}</TableHead>
                        <TableHead className="text-right">{isRTL ? 'دائن' : 'Credit'}</TableHead>
                        <TableHead>{isRTL ? 'الوصف' : 'Description'}</TableHead>
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
                      <TableRow className="font-bold bg-gray-50 dark:bg-gray-900">
                        <TableCell colSpan={2} className="text-right">
                          {isRTL ? 'الإجمالي' : 'Total'}
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
                  <Label className="text-xs text-muted-foreground">{isRTL ? 'المرجع' : 'Reference'}</Label>
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
              {isRTL ? 'لا توجد بيانات' : 'No data available'}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

