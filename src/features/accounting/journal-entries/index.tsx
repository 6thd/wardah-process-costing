import { useState } from 'react';
import { Plus, Edit, Trash2, CheckCircle, FileText, RotateCcw, Layers, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { BatchPostDialog } from './components/BatchPostDialog';
import { ApprovalWorkflow } from './components/ApprovalWorkflow';
import { AttachmentsSection } from './components/AttachmentsSection';
import { CommentsSection } from './components/CommentsSection';
import { toast } from 'sonner';
import { useJournalData } from './hooks/useJournalData';
import { useJournalEntries } from './hooks/useJournalEntries';
import { fetchEntryLines } from './hooks/useEntryLines';
import { calculateTotals, validateEntry, normalizeLines } from './utils/journalHelpers';
import { createJournalEntry, updateJournalEntry, postJournalEntry, deleteJournalEntry } from './services/journalEntryService';
import { JournalService } from '@/services/accounting/journal-service';
import { isValidDecimalInput } from '@/utils/numberValidation';
import type { JournalEntry, JournalLine } from './types';

const JournalEntries = () => {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [batchPostDialogOpen, setBatchPostDialogOpen] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<JournalEntry | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);

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

  const { journals, accounts } = useJournalData(isRTL);
  const { entries, loading, fetchEntries } = useJournalEntries({ 
    statusFilter, 
    dateFilter, 
    journals 
  });


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


  const handleSubmit = async () => {
    try {
      setLoading(true);
      const { totalDebit, totalCredit } = calculateTotals(formData.lines);
      
      const validation = validateEntry(formData.journal_id, formData.lines, isRTL);
      if (!validation.valid) {
        alert(validation.message);
        setLoading(false);
        return;
      }

      const entryData = {
        journal_id: formData.journal_id,
        entry_date: formData.entry_date,
        description: formData.description,
        description_ar: formData.description_ar,
        reference_type: formData.reference_type,
        reference_number: formData.reference_number,
        total_debit: totalDebit,
        total_credit: totalCredit,
        lines: formData.lines
      };

      if (editingEntry) {
        const success = await updateJournalEntry({ ...entryData, id: editingEntry.id }, isRTL);
        if (success) {
          setIsDialogOpen(false);
          resetForm();
          fetchEntries();
        }
      } else {
        const entryId = await createJournalEntry(entryData, isRTL);
        if (entryId) {
          setIsDialogOpen(false);
          resetForm();
          fetchEntries();
        }
      }
    } catch (error: any) {
      console.error('❌ Error saving entry:', error);
      toast.error(error?.message || (isRTL ? 'حدث خطأ أثناء حفظ القيد' : 'Error saving entry'));
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async (entry: JournalEntry) => {
    if (!globalThis.window?.confirm(isRTL ? `هل تريد ترحيل القيد ${entry.entry_number}؟` : `Post entry ${entry.entry_number}?`)) {
      return;
    }

    setLoading(true);
    const success = await postJournalEntry(entry, isRTL);
    if (success) {
      fetchEntries();
    }
    setLoading(false);
  };

  const handleDelete = async (entry: JournalEntry) => {
    if (entry.status === 'posted') {
      alert(isRTL ? 'لا يمكن حذف قيد مرحّل' : 'Cannot delete a posted entry');
      return;
    }

    if (!globalThis.window?.confirm(isRTL ? `هل تريد حذف القيد ${entry.entry_number}؟` : `Delete entry ${entry.entry_number}?`)) {
      return;
    }

    setLoading(true);
    const success = await deleteJournalEntry(entry, isRTL);
    if (success) {
      fetchEntries();
    }
    setLoading(false);
  };

  const handleEdit = async (entry: JournalEntry) => {
    if (entry.status === 'posted') {
      toast.warning(isRTL ? 'لا يمكن تعديل قيد مرحّل' : 'Cannot edit a posted entry');
      return;
    }

    try {
      setLoading(true);
      let lines = await fetchEntryLines(entry.id, accounts);

      if (!lines || lines.length === 0) {
        console.warn('Trying to load lines via service fallback...');
        const fullEntry = await JournalService.getEntryWithDetails(entry.id);
        if (fullEntry?.lines?.length) {
          lines = normalizeLines(fullEntry.lines, entry.id, accounts);
        }
      }

      if (!lines || lines.length === 0) {
        toast.error(
          isRTL
            ? '⚠️ هذا القيد فارغ (بدون بنود). يُرجى حذفه وإنشاء قيد جديد.'
            : '⚠️ This entry is empty (no lines). Please delete it and create a new entry.',
          { duration: 6000 }
        );
        return;
      }

      setEditingEntry(entry);
      setFormData({
        journal_id: entry.journal_id,
        entry_date: entry.entry_date,
        description: entry.description || '',
        description_ar: entry.description_ar || '',
        reference_type: entry.reference_type || '',
        reference_number: entry.reference_number || '',
        lines
      });
      setIsDialogOpen(true);
    } catch (error: any) {
      console.error('Error loading entry for edit:', error);
      toast.error(error.message || (isRTL ? 'تعذر تحميل بيانات القيد' : 'Failed to load entry details'));
    } finally {
      setLoading(false);
    }
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

  const { totalDebit, totalCredit, balanced } = calculateTotals(formData.lines);

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
                    {(() => {
                      if (editingEntry) {
                        return isRTL ? 'تعديل القيد' : 'Edit Entry';
                      }
                      return isRTL ? 'قيد جديد' : 'New Entry';
                    })()}
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

                  {/* Tabs for Lines, Attachments, and Comments - Professional Design */}
                  <Tabs defaultValue="lines" className="w-full border-t pt-4">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="lines">{isRTL ? 'البنود' : 'Lines'}</TabsTrigger>
                      <TabsTrigger value="attachments" disabled={!editingEntry}>
                        {isRTL ? 'المرفقات' : 'Attachments'}
                        {!editingEntry && <span className="text-xs opacity-50 ml-1">*</span>}
                      </TabsTrigger>
                      <TabsTrigger value="comments" disabled={!editingEntry}>
                        {isRTL ? 'التعليقات' : 'Comments'}
                        {!editingEntry && <span className="text-xs opacity-50 ml-1">*</span>}
                      </TabsTrigger>
                    </TabsList>

                    {!editingEntry && (
                      <div className="mt-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-md">
                        <p className="text-xs text-blue-700 flex items-center gap-2">
                          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span>
                            {isRTL
                              ? '* المرفقات والتعليقات ستكون متاحة بعد حفظ القيد'
                              : '* Attachments and comments will be available after saving the entry'}
                          </span>
                        </p>
                      </div>
                    )}

                    <TabsContent value="lines" className="space-y-4">
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
                          <Card key={`line-${index}-${line.account_id || 'new'}`} className="p-4">
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
                                    // NOSONAR - Using safe validation function instead of regex
                                    if (value === '' || isValidDecimalInput(value)) { // NOSONAR
                                      updateLine(index, 'debit', value);
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
                                    // NOSONAR - Using safe validation function instead of regex
                                    if (value === '' || isValidDecimalInput(value)) { // NOSONAR
                                      updateLine(index, 'credit', value);
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
                                {(() => {
                                  if (balanced) {
                                    return isRTL ? '✓ متوازن' : '✓ Balanced';
                                  }
                                  return isRTL ? '✗ غير متوازن' : '✗ Not Balanced';
                                })()}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="attachments">
                      {editingEntry ? (
                        <AttachmentsSection entryId={editingEntry.id} />
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                          <div className="rounded-full bg-blue-100 p-4 mb-4">
                            <svg className="h-12 w-12 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                            </svg>
                          </div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {isRTL ? 'احفظ القيد أولاً' : 'Save Entry First'}
                          </h3>
                          <p className="text-sm text-gray-500 max-w-md">
                            {isRTL
                              ? 'لإضافة مرفقات، يجب عليك حفظ القيد أولاً. بعد الحفظ، يمكنك تعديل القيد وإضافة المرفقات.'
                              : 'To add attachments, you need to save the entry first. After saving, you can edit the entry and add attachments.'}
                          </p>
                          <Button
                            onClick={handleSubmit}
                            disabled={loading || !balanced}
                            className="mt-4"
                          >
                            {isRTL ? 'احفظ القيد الآن' : 'Save Entry Now'}
                          </Button>
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="comments">
                      {editingEntry ? (
                        <CommentsSection entryId={editingEntry.id} />
                      ) : (
                        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                          <div className="rounded-full bg-purple-100 p-4 mb-4">
                            <svg className="h-12 w-12 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                          </div>
                          <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            {isRTL ? 'احفظ القيد أولاً' : 'Save Entry First'}
                          </h3>
                          <p className="text-sm text-gray-500 max-w-md">
                            {isRTL
                              ? 'لإضافة تعليقات، يجب عليك حفظ القيد أولاً. بعد الحفظ، يمكنك تعديل القيد وإضافة التعليقات.'
                              : 'To add comments, you need to save the entry first. After saving, you can edit the entry and add comments.'}
                          </p>
                          <Button
                            onClick={handleSubmit}
                            disabled={loading || !balanced}
                            className="mt-4"
                          >
                            {isRTL ? 'احفظ القيد الآن' : 'Save Entry Now'}
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>

                  <div className="flex justify-end gap-2 pt-4 border-t">
                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                      {isRTL ? 'إلغاء' : 'Cancel'}
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading || !balanced}>
                      {(() => {
                        if (loading) {
                          return isRTL ? 'جاري الحفظ...' : 'Saving...';
                        }
                        return isRTL ? 'حفظ' : 'Save';
                      })()}
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
            <Button variant="outline" onClick={() => setBatchPostDialogOpen(true)}>
              <Layers className="h-4 w-4 mr-2" />
              {isRTL ? 'ترحيل مجمع' : 'Batch Post'}
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
                        {(() => {
                          if (isRTL) {
                            return entry.journal_name_ar || entry.journal_name;
                          }
                          return entry.journal_name;
                        })()}
                      </TableCell>
                      <TableCell>
                        {isRTL ? entry.description_ar : entry.description}
                      </TableCell>
                      <TableCell className="text-right font-mono" dir="ltr">
                        {entry.total_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right font-mono" dir="ltr">
                        {entry.total_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                            <>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={async () => {
                                  const fullEntry = await JournalService.getEntryWithDetails(entry.id);
                                  if (fullEntry) {
                                    setViewingEntry(fullEntry);
                                    setViewDialogOpen(true);
                                  }
                                }}
                                title={isRTL ? 'عرض' : 'View'}
                              >
                                <FileText className="h-4 w-4 text-blue-600" />
                              </Button>
                              {!entry.reversed_by_entry_id && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={async () => {
                                    if (confirm(isRTL ? 'هل تريد عكس هذا القيد؟' : 'Reverse this entry?')) {
                                      try {
                                        const result = await JournalService.reverseEntry(entry.id);
                                        if (result.success) {
                                          toast.success(isRTL ? 'تم عكس القيد' : 'Entry reversed');
                                          fetchEntries();
                                        }
                                      } catch (error: any) {
                                        toast.error(error.message || (isRTL ? 'فشل العكس' : 'Reversal failed'));
                                      }
                                    }
                                  }}
                                  title={isRTL ? 'عكس' : 'Reverse'}
                                >
                                  <RotateCcw className="h-4 w-4 text-orange-600" />
                                </Button>
                              )}
                            </>
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

      {/* Batch Post Dialog */}
      <BatchPostDialog
        isOpen={batchPostDialogOpen}
        onClose={() => setBatchPostDialogOpen(false)}
        entries={entries}
        onSuccess={fetchEntries}
      />

      {/* View Entry Dialog with Tabs */}
      <Dialog open={viewDialogOpen} onOpenChange={setViewDialogOpen}>
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {isRTL ? 'تفاصيل القيد' : 'Entry Details'} - {viewingEntry?.entry_number}
            </DialogTitle>
            <DialogDescription>
              {isRTL ? 'عرض تفاصيل القيد والموافقات والمرفقات والتعليقات' : 'View entry details, approvals, attachments, and comments'}
            </DialogDescription>
          </DialogHeader>

          {viewingEntry && (
            <Tabs defaultValue="details" className="w-full">
              <TabsList className="grid w-full grid-cols-4">
                <TabsTrigger value="details">
                  {isRTL ? 'التفاصيل' : 'Details'}
                </TabsTrigger>
                <TabsTrigger value="approvals">
                  {isRTL ? 'الموافقات' : 'Approvals'}
                </TabsTrigger>
                <TabsTrigger value="attachments">
                  {isRTL ? 'المرفقات' : 'Attachments'}
                </TabsTrigger>
                <TabsTrigger value="comments">
                  {isRTL ? 'التعليقات' : 'Comments'}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="details" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label>{isRTL ? 'رقم القيد' : 'Entry Number'}</Label>
                    <p className="font-mono">{viewingEntry.entry_number}</p>
                  </div>
                  <div>
                    <Label>{isRTL ? 'التاريخ' : 'Date'}</Label>
                    <p>{format(new Date(viewingEntry.entry_date), 'dd/MM/yyyy')}</p>
                  </div>
                  <div>
                    <Label>{isRTL ? 'الحالة' : 'Status'}</Label>
                    <div>{getStatusBadge(viewingEntry.status)}</div>
                  </div>
                  <div>
                    <Label>{isRTL ? 'المدين' : 'Debit'}</Label>
                    <p className="font-mono">{viewingEntry.total_debit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                  <div>
                    <Label>{isRTL ? 'الدائن' : 'Credit'}</Label>
                    <p className="font-mono">{viewingEntry.total_credit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
                  </div>
                </div>

                {viewingEntry.lines && viewingEntry.lines.length > 0 && (
                  <div className="border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{isRTL ? 'الحساب' : 'Account'}</TableHead>
                          <TableHead className="text-right">{isRTL ? 'مدين' : 'Debit'}</TableHead>
                          <TableHead className="text-right">{isRTL ? 'دائن' : 'Credit'}</TableHead>
                          <TableHead>{isRTL ? 'الوصف' : 'Description'}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewingEntry.lines.map((line) => (
                          <TableRow key={line.id || line.line_number}>
                            <TableCell>
                              {line.account_code} - {isRTL ? (line.account_name_ar || line.account_name) : line.account_name}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {Number(line.debit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-right font-mono">
                              {Number(line.credit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>{isRTL ? line.description_ar : line.description}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="approvals">
                <ApprovalWorkflow
                  entryId={viewingEntry.id}
                  entryNumber={viewingEntry.entry_number}
                  canApprove={true}
                />
              </TabsContent>

              <TabsContent value="attachments">
                <AttachmentsSection entryId={viewingEntry.id} />
              </TabsContent>

              <TabsContent value="comments">
                <CommentsSection entryId={viewingEntry.id} />
              </TabsContent>
            </Tabs>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default JournalEntries;
