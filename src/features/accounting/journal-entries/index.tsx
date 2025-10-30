import { useState, useEffect } from 'react';
import { Plus, Edit, Trash2, CheckCircle, XCircle, FileText, Calendar, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/lib/supabase';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';

interface JournalEntry {
  id: string;
  org_id: string;
  journal_id: string;
  entry_number: string;
  entry_date: string;
  posting_date?: string;
  period_id?: string;
  reference_type?: string;
  reference_id?: string;
  reference_number?: string;
  description?: string;
  description_ar?: string;
  status: 'draft' | 'posted' | 'reversed';
  posted_at?: string;
  posted_by?: string;
  reversed_by_entry_id?: string;
  reversal_reason?: string;
  total_debit: number;
  total_credit: number;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
  journal_name?: string;
  journal_name_ar?: string;
  lines?: JournalLine[];
}

interface JournalLine {
  id?: string;
  entry_id?: string;
  line_number: number;
  account_id: string;
  account_code?: string;
  account_name?: string;
  account_name_ar?: string;
  cost_center_id?: string;
  partner_id?: string;
  product_id?: string;
  project_id?: string;
  debit?: number | string;
  credit?: number | string;
  currency_code: string;
  description?: string;
  description_ar?: string;
  reconciled?: boolean;
  reconciled_at?: string;
  reconciled_by?: string;
  created_at?: string;
}

interface Journal {
  id: string;
  code: string;
  name: string;
  name_ar?: string;
  journal_type: string;
  sequence_prefix: string;
  is_active: boolean;
}

interface Account {
  id: string;
  code: string;
  name: string;
  name_ar?: string;
  name_en?: string;
  category?: string;
  allow_posting?: boolean;
  is_active: boolean;
}

const JournalEntries = () => {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [journals, setJournals] = useState<Journal[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');

  // Form state
  const [formData, setFormData] = useState({
    journal_id: '',
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    description_ar: '',
    reference_type: '',
    reference_number: '',
    lines: [] as Partial<JournalLine>[]
  });

  useEffect(() => {
    fetchJournals();
    fetchAccounts();
    fetchEntries();
  }, []);

  const fetchJournals = async () => {
    try {
      const { data, error } = await supabase
        .from('journals')
        .select('*')
        .eq('is_active', true)
        .order('code');

      if (error) throw error;
      setJournals(data || []);
    } catch (error) {
      console.error('Error fetching journals:', error);
    }
  };

  const fetchAccounts = async () => {
    try {
      const { data, error } = await supabase
        .from('gl_accounts')
        .select('*')
        .eq('allow_posting', true)
        .eq('is_active', true)
        .order('code');

      if (error) throw error;
      setAccounts(data || []);
    } catch (error) {
      console.error('Error fetching accounts:', error);
    }
  };

  const fetchEntries = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('journal_entries')
        .select(`
          *,
          journals (
            name,
            name_ar
          )
        `)
        .order('entry_date', { ascending: false })
        .order('entry_number', { ascending: false });

      if (statusFilter !== 'all') {
        query = query.eq('status', statusFilter);
      }

      if (dateFilter) {
        query = query.gte('entry_date', dateFilter);
      }

      const { data, error } = await query;

      if (error) throw error;
      
      const entriesWithJournalNames = (data || []).map(entry => ({
        ...entry,
        journal_name: entry.journals?.name,
        journal_name_ar: entry.journals?.name_ar
      }));

      setEntries(entriesWithJournalNames);
    } catch (error) {
      console.error('Error fetching entries:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchEntryLines = async (entryId: string) => {
    try {
      const { data, error } = await supabase
        .from('journal_lines')
        .select(`
          *,
          gl_accounts (
            code,
            name,
            name_ar,
            name_en
          )
        `)
        .eq('entry_id', entryId)
        .order('line_number');

      if (error) throw error;

      return (data || []).map(line => ({
        ...line,
        account_code: line.gl_accounts?.code,
        account_name: line.gl_accounts?.name,
        account_name_ar: line.gl_accounts?.name_ar
      }));
    } catch (error) {
      console.error('Error fetching entry lines:', error);
      return [];
    }
  };

  const addLine = () => {
    setFormData({
      ...formData,
      lines: [
        ...formData.lines,
        {
          line_number: formData.lines.length + 1,
          account_id: '',
          debit: '',
          credit: '',
          currency_code: 'SAR',
          description: '',
          description_ar: ''
        }
      ]
    });
  };

  const updateLine = (index: number, field: string, value: any) => {
    setFormData(prev => {
      const newLines = [...prev.lines];
      newLines[index] = { ...newLines[index], [field]: value };
      return { ...prev, lines: newLines };
    });
  };

  const removeLine = (index: number) => {
    const newLines = formData.lines.filter((_, i) => i !== index);
    setFormData({ ...formData, lines: newLines });
  };

  const calculateTotals = () => {
    const totalDebit = formData.lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
    const totalCredit = formData.lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
    return { totalDebit, totalCredit, balanced: totalDebit === totalCredit && totalDebit > 0 };
  };

  const handleSubmit = async () => {
    try {
      setLoading(true);
      const { totalDebit, totalCredit, balanced } = calculateTotals();

      // Validation: Journal type is required
      if (!formData.journal_id) {
        alert(isRTL ? 'يجب اختيار نوع القيد' : 'Please select a journal type');
        setLoading(false);
        return;
      }

      if (!balanced) {
        alert(isRTL ? 'القيد غير متوازن! يجب تساوي المدين والدائن' : 'Entry not balanced! Debit and Credit must be equal');
        setLoading(false);
        return;
      }

      if (formData.lines.length === 0) {
        alert(isRTL ? 'يجب إضافة بنود للقيد' : 'Please add lines to the entry');
        setLoading(false);
        return;
      }

      // Create journal entry
      const entryData = {
        journal_id: formData.journal_id, // Required field, validated above
        entry_date: formData.entry_date,
        description: formData.description || null,
        description_ar: formData.description_ar || null,
        reference_type: formData.reference_type || null,
        reference_number: formData.reference_number || null,
        status: 'draft',
        total_debit: totalDebit,
        total_credit: totalCredit,
        org_id: '00000000-0000-0000-0000-000000000001'
      };

      console.log('💾 Saving entry:', entryData);

      if (editingEntry) {
        // Update existing entry
        const { error: entryError } = await supabase
          .from('journal_entries')
          .update(entryData)
          .eq('id', editingEntry.id);

        if (entryError) throw entryError;

        // Delete old lines
        await supabase
          .from('journal_lines')
          .delete()
          .eq('entry_id', editingEntry.id);

        // Insert new lines
        const lines = formData.lines.map((line, index) => ({
          entry_id: editingEntry.id,
          line_number: index + 1,
          account_id: line.account_id,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          currency_code: line.currency_code || 'SAR',
          description: line.description,
          description_ar: line.description_ar,
          org_id: '00000000-0000-0000-0000-000000000001'
        }));

        const { error: linesError } = await supabase
          .from('journal_lines')
          .insert(lines);

        if (linesError) throw linesError;
      } else {
        // Generate entry number first
        const { data: entryNumber, error: numberError } = await supabase
          .rpc('generate_entry_number', { p_journal_id: formData.journal_id });

        if (numberError) throw numberError;

        // Create new entry with generated number
        const entryDataWithNumber = {
          ...entryData,
          entry_number: entryNumber
        };

        const { data: newEntry, error: entryError } = await supabase
          .from('journal_entries')
          .insert([entryDataWithNumber])
          .select()
          .single();

        if (entryError) throw entryError;

        // Insert lines
        const lines = formData.lines.map((line, index) => ({
          entry_id: newEntry.id,
          line_number: index + 1,
          account_id: line.account_id,
          debit: Number(line.debit) || 0,
          credit: Number(line.credit) || 0,
          currency_code: line.currency_code || 'SAR',
          description: line.description,
          description_ar: line.description_ar,
          org_id: '00000000-0000-0000-0000-000000000001'
        }));

        const { error: linesError } = await supabase
          .from('journal_lines')
          .insert(lines);

        if (linesError) throw linesError;
      }

      setIsDialogOpen(false);
      resetForm();
      fetchEntries();
      alert(isRTL ? 'تم حفظ القيد بنجاح' : 'Entry saved successfully');
    } catch (error) {
      console.error('Error saving entry:', error);
      alert(isRTL ? 'حدث خطأ أثناء حفظ القيد' : 'Error saving entry');
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async (entry: JournalEntry) => {
    if (!window.confirm(isRTL ? `هل تريد ترحيل القيد ${entry.entry_number}؟` : `Post entry ${entry.entry_number}?`)) {
      return;
    }

    try {
      setLoading(true);
      const { data, error } = await supabase
        .rpc('post_journal_entry', { p_entry_id: entry.id });

      if (error) throw error;

      const result = typeof data === 'string' ? JSON.parse(data) : data;

      if (result.success) {
        alert(isRTL ? 'تم ترحيل القيد بنجاح' : 'Entry posted successfully');
        fetchEntries();
      } else {
        alert(result.error || (isRTL ? 'فشل الترحيل' : 'Posting failed'));
      }
    } catch (error) {
      console.error('Error posting entry:', error);
      alert(isRTL ? 'حدث خطأ أثناء الترحيل' : 'Error posting entry');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (entry: JournalEntry) => {
    if (entry.status === 'posted') {
      alert(isRTL ? 'لا يمكن حذف قيد مرحّل' : 'Cannot delete a posted entry');
      return;
    }

    if (!window.confirm(isRTL ? `هل تريد حذف القيد ${entry.entry_number}؟` : `Delete entry ${entry.entry_number}?`)) {
      return;
    }

    try {
      setLoading(true);
      const { error } = await supabase
        .from('journal_entries')
        .delete()
        .eq('id', entry.id);

      if (error) throw error;

      fetchEntries();
      alert(isRTL ? 'تم حذف القيد' : 'Entry deleted');
    } catch (error) {
      console.error('Error deleting entry:', error);
      alert(isRTL ? 'حدث خطأ أثناء الحذف' : 'Error deleting entry');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = async (entry: JournalEntry) => {
    if (entry.status === 'posted') {
      alert(isRTL ? 'لا يمكن تعديل قيد مرحّل' : 'Cannot edit a posted entry');
      return;
    }

    const lines = await fetchEntryLines(entry.id);
    
    setEditingEntry(entry);
    setFormData({
      journal_id: entry.journal_id,
      entry_date: entry.entry_date,
      description: entry.description || '',
      description_ar: entry.description_ar || '',
      reference_type: entry.reference_type || '',
      reference_number: entry.reference_number || '',
      lines: lines
    });
    setIsDialogOpen(true);
  };

  const resetForm = () => {
    setFormData({
      journal_id: '',
      entry_date: format(new Date(), 'yyyy-MM-dd'),
      description: '',
      description_ar: '',
      reference_type: '',
      reference_number: '',
      lines: []
    });
    setEditingEntry(null);
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      draft: 'secondary',
      posted: 'default',
      reversed: 'destructive'
    };
    
    const labels: Record<string, { ar: string; en: string }> = {
      draft: { ar: 'مسودة', en: 'Draft' },
      posted: { ar: 'مرحّل', en: 'Posted' },
      reversed: { ar: 'معكوس', en: 'Reversed' }
    };

    return (
      <Badge variant={variants[status]}>
        {isRTL ? labels[status]?.ar : labels[status]?.en}
      </Badge>
    );
  };

  const filteredEntries = entries.filter(entry => {
    const matchesSearch = searchTerm === '' ||
      entry.entry_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.description_ar?.includes(searchTerm);
    
    return matchesSearch;
  });

  const { totalDebit, totalCredit, balanced } = calculateTotals();

  return (
    <div className="container mx-auto p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-2xl">
                {isRTL ? 'قيود اليومية' : 'Journal Entries'}
              </CardTitle>
              <CardDescription>
                {isRTL ? 'إدارة القيود المحاسبية' : 'Manage accounting journal entries'}
              </CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) resetForm();
            }}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 ml-2" />
                  {isRTL ? 'قيد جديد' : 'New Entry'}
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {editingEntry 
                      ? (isRTL ? 'تعديل القيد' : 'Edit Entry')
                      : (isRTL ? 'قيد جديد' : 'New Entry')}
                  </DialogTitle>
                  <DialogDescription>
                    {isRTL ? 'أدخل تفاصيل القيد' : 'Enter entry details'}
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="journal_id">{isRTL ? 'نوع القيد' : 'Journal Type'}</Label>
                      <Select
                        value={formData.journal_id}
                        onValueChange={(value) => setFormData({ ...formData, journal_id: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={isRTL ? 'اختر نوع القيد' : 'Select journal type'} />
                        </SelectTrigger>
                        <SelectContent>
                          {journals.map((journal) => (
                            <SelectItem key={journal.id} value={journal.id}>
                              {isRTL ? (journal.name_ar || journal.name) : journal.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label htmlFor="entry_date">{isRTL ? 'التاريخ' : 'Date'}</Label>
                      <Input
                        type="date"
                        id="entry_date"
                        value={formData.entry_date}
                        onChange={(e) => setFormData({ ...formData, entry_date: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="description_ar">{isRTL ? 'الوصف بالعربية' : 'Description (Arabic)'}</Label>
                      <textarea
                        id="description_ar"
                        value={formData.description_ar}
                        onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })}
                        rows={2}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>

                    <div>
                      <Label htmlFor="description">{isRTL ? 'الوصف بالإنجليزية' : 'Description (English)'}</Label>
                      <textarea
                        id="description"
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        rows={2}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="reference_type">{isRTL ? 'نوع المرجع' : 'Reference Type'}</Label>
                      <Input
                        id="reference_type"
                        value={formData.reference_type}
                        onChange={(e) => setFormData({ ...formData, reference_type: e.target.value })}
                        placeholder={isRTL ? 'مثال: فاتورة، سند صرف' : 'e.g., Invoice, Payment'}
                      />
                    </div>

                    <div>
                      <Label htmlFor="reference_number">{isRTL ? 'رقم المرجع' : 'Reference Number'}</Label>
                      <Input
                        id="reference_number"
                        value={formData.reference_number}
                        onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="border-t pt-4">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-semibold">
                        {isRTL ? 'بنود القيد' : 'Entry Lines'}
                      </h3>
                      <Button type="button" onClick={addLine} size="sm">
                        <Plus className="h-4 w-4 ml-1" />
                        {isRTL ? 'إضافة بند' : 'Add Line'}
                      </Button>
                    </div>

                    <div className="space-y-2">
                      {formData.lines.map((line, index) => (
                        <Card key={index} className="p-4">
                          <div className="grid grid-cols-12 gap-2 items-end">
                            <div className="col-span-5">
                              <Label>{isRTL ? 'الحساب' : 'Account'}</Label>
                              <Select
                                value={line.account_id}
                                onValueChange={(value) => updateLine(index, 'account_id', value)}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder={isRTL ? 'اختر الحساب' : 'Select account'} />
                                </SelectTrigger>
                                <SelectContent>
                                  {accounts.map((account) => (
                                    <SelectItem key={account.id} value={account.id}>
                                      {account.code} - {isRTL ? (account.name_ar || account.name) : account.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div className="col-span-2">
                              <Label>{isRTL ? 'مدين' : 'Debit'}</Label>
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={line.debit || ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // السماح فقط بالأرقام والنقطة العشرية
                                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                    updateLine(index, 'debit', value);
                                    // إذا أدخل مبلغ في المدين، اجعل الدائن فارغ
                                    if (value && Number(value) > 0) {
                                      updateLine(index, 'credit', '');
                                    }
                                  }
                                }}
                                onFocus={(e) => e.target.select()}
                                placeholder="0.00"
                                className="text-right"
                              />
                            </div>

                            <div className="col-span-2">
                              <Label>{isRTL ? 'دائن' : 'Credit'}</Label>
                              <Input
                                type="text"
                                inputMode="decimal"
                                value={line.credit || ''}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  // السماح فقط بالأرقام والنقطة العشرية
                                  if (value === '' || /^\d*\.?\d*$/.test(value)) {
                                    updateLine(index, 'credit', value);
                                    // إذا أدخل مبلغ في الدائن، اجعل المدين فارغ
                                    if (value && Number(value) > 0) {
                                      updateLine(index, 'debit', '');
                                    }
                                  }
                                }}
                                onFocus={(e) => e.target.select()}
                                placeholder="0.00"
                                className="text-right"
                              />
                            </div>

                            <div className="col-span-2">
                              <Label>{isRTL ? 'الوصف' : 'Description'}</Label>
                              <Input
                                value={line.description || ''}
                                onChange={(e) => updateLine(index, 'description', e.target.value)}
                                placeholder={isRTL ? 'وصف البند' : 'Line description'}
                              />
                            </div>

                            <div className="col-span-1">
                              <Button
                                type="button"
                                variant="destructive"
                                size="icon"
                                onClick={() => removeLine(index)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </div>
                        </Card>
                      ))}
                    </div>

                    {formData.lines.length > 0 && (
                      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
                        <div className="grid grid-cols-3 gap-4 text-center">
                          <div>
                            <p className="text-sm text-gray-600">{isRTL ? 'إجمالي المدين' : 'Total Debit'}</p>
                            <p className="text-lg font-bold">{totalDebit.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">{isRTL ? 'إجمالي الدائن' : 'Total Credit'}</p>
                            <p className="text-lg font-bold">{totalCredit.toFixed(2)}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-600">{isRTL ? 'الحالة' : 'Status'}</p>
                            <p className={`text-lg font-bold ${balanced ? 'text-green-600' : 'text-red-600'}`}>
                              {balanced 
                                ? (isRTL ? '✓ متوازن' : '✓ Balanced')
                                : (isRTL ? '✗ غير متوازن' : '✗ Not Balanced')}
                            </p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex justify-end gap-2 pt-4 border-t">
                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                      {isRTL ? 'إلغاء' : 'Cancel'}
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading || !balanced}>
                      {loading 
                        ? (isRTL ? 'جاري الحفظ...' : 'Saving...')
                        : (isRTL ? 'حفظ' : 'Save')}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
          <div className="flex gap-4 mb-6">
            <div className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  placeholder={isRTL ? 'بحث برقم القيد أو الوصف...' : 'Search by entry number or description...'}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{isRTL ? 'جميع الحالات' : 'All Statuses'}</SelectItem>
                <SelectItem value="draft">{isRTL ? 'مسودة' : 'Draft'}</SelectItem>
                <SelectItem value="posted">{isRTL ? 'مرحّل' : 'Posted'}</SelectItem>
                <SelectItem value="reversed">{isRTL ? 'معكوس' : 'Reversed'}</SelectItem>
              </SelectContent>
            </Select>

            <Input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-48"
            />

            <Button variant="outline" onClick={() => { setSearchTerm(''); setStatusFilter('all'); setDateFilter(''); fetchEntries(); }}>
              {isRTL ? 'إعادة تعيين' : 'Reset'}
            </Button>
          </div>

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isRTL ? 'رقم القيد' : 'Entry Number'}</TableHead>
                  <TableHead>{isRTL ? 'التاريخ' : 'Date'}</TableHead>
                  <TableHead>{isRTL ? 'نوع القيد' : 'Journal'}</TableHead>
                  <TableHead>{isRTL ? 'الوصف' : 'Description'}</TableHead>
                  <TableHead className="text-right">{isRTL ? 'المدين' : 'Debit'}</TableHead>
                  <TableHead className="text-right">{isRTL ? 'الدائن' : 'Credit'}</TableHead>
                  <TableHead>{isRTL ? 'الحالة' : 'Status'}</TableHead>
                  <TableHead className="text-center">{isRTL ? 'الإجراءات' : 'Actions'}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8">
                      {isRTL ? 'جاري التحميل...' : 'Loading...'}
                    </TableCell>
                  </TableRow>
                ) : filteredEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                      {isRTL ? 'لا توجد قيود' : 'No entries found'}
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="font-medium">{entry.entry_number}</TableCell>
                      <TableCell>
                        {format(new Date(entry.entry_date), 'dd/MM/yyyy', { locale: isRTL ? ar : undefined })}
                      </TableCell>
                      <TableCell>
                        {isRTL ? (entry.journal_name_ar || entry.journal_name) : entry.journal_name}
                      </TableCell>
                      <TableCell>
                        {isRTL ? entry.description_ar : entry.description}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {entry.total_debit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {entry.total_credit.toLocaleString('ar-SA', { minimumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>{getStatusBadge(entry.status)}</TableCell>
                      <TableCell>
                        <div className="flex justify-center gap-2">
                          {entry.status === 'draft' && (
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleEdit(entry)}
                                title={isRTL ? 'تعديل' : 'Edit'}
                              >
                                <Edit className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handlePost(entry)}
                                title={isRTL ? 'ترحيل' : 'Post'}
                              >
                                <CheckCircle className="h-4 w-4 text-green-600" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => handleDelete(entry)}
                                title={isRTL ? 'حذف' : 'Delete'}
                              >
                                <Trash2 className="h-4 w-4 text-red-600" />
                              </Button>
                            </>
                          )}
                          {entry.status === 'posted' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={async () => {
                                const lines = await fetchEntryLines(entry.id);
                                setEditingEntry({ ...entry, lines });
                                setIsDialogOpen(true);
                              }}
                              title={isRTL ? 'عرض' : 'View'}
                            >
                              <FileText className="h-4 w-4 text-blue-600" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default JournalEntries;
