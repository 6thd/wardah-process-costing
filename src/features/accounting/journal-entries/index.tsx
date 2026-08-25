import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { BatchPostDialog } from './components/BatchPostDialog';
import { AttachmentsSection } from './components/AttachmentsSection';
import { CommentsSection } from './components/CommentsSection';
import { JournalEntriesTable, JournalEntryFilters, JournalEntryViewDialog } from './components/JournalEntrySections';
import { toast } from 'sonner';
import { useJournalData } from './hooks/useJournalData';
import { useJournalEntries } from './hooks/useJournalEntries';
import { fetchEntryLines } from './hooks/useEntryLines';
import { calculateTotals, validateEntry, normalizeLines } from './utils/journalHelpers';
import { createJournalEntry, updateJournalEntry, postJournalEntry, deleteJournalEntry } from './services/journalEntryService';
import { JournalService } from '@/services/accounting/journal-service';
import { isValidDecimalInput } from '@/utils/numberValidation';
import { usePermissions } from '@/hooks/usePermissions';
import type { JournalEntry, JournalLine } from './types';

function canOpenEntryDialog(open: boolean, editingEntry: JournalEntry | null, canCreate: boolean, canUpdate: boolean) {
  return open && (editingEntry ? canUpdate : canCreate);
}

const BALANCE_CLASS_NAMES = {
  true: 'text-green-600',
  false: 'text-red-600',
} as const;

const BALANCE_LABEL_KEYS = {
  true: 'accounting.journalEntries.balanced',
  false: 'accounting.journalEntries.notBalanced',
} as const;

const SAVE_LABEL_KEYS = {
  true: 'accounting.journalEntries.saving',
  false: 'common.save',
} as const;

const JournalEntries = () => {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const { hasPermissionKey } = usePermissions();
  const canCreate = hasPermissionKey('accounting.journals.create');
  const canUpdate = hasPermissionKey('accounting.journals.update');
  const canDelete = hasPermissionKey('accounting.journals.delete');
  const canPost = hasPermissionKey('accounting.journals.post');
  const canReverse = hasPermissionKey('accounting.journals.reverse');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFilter, setDateFilter] = useState<string>('');
  const [batchPostDialogOpen, setBatchPostDialogOpen] = useState(false);
  const [viewingEntry, setViewingEntry] = useState<JournalEntry | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const [formLoading, setFormLoading] = useState(false);

  const [formData, setFormData] = useState({
    journal_id: '',
    entry_date: format(new Date(), 'yyyy-MM-dd'),
    description: '',
    description_ar: '',
    reference_type: '',
    reference_number: '',
    lines: [] as Partial<JournalLine>[]
  });

  const { journals, accounts } = useJournalData();
  const { entries, loading, fetchEntries } = useJournalEntries({ statusFilter, dateFilter });

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
    if (editingEntry ? !canUpdate : !canCreate) {
      toast.error(editingEntry ? t('accounting.journalEntries.noUpdatePermission', { defaultValue: 'لا تملك صلاحية تعديل القيود' }) : t('accounting.journalEntries.noCreatePermission', { defaultValue: 'لا تملك صلاحية إنشاء قيود' }));
      return;
    }
    try {
      setFormLoading(true);
      const { totalDebit, totalCredit } = calculateTotals(formData.lines);

      const validation = validateEntry(formData.journal_id, formData.lines);
      if (!validation.valid) {
        toast.error(validation.message);
        setFormLoading(false);
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
        const success = await updateJournalEntry({ ...entryData, id: editingEntry.id });
        if (success) {
          setIsDialogOpen(false);
          resetForm();
          fetchEntries();
        }
      } else {
        const entryId = await createJournalEntry(entryData);
        if (entryId) {
          setIsDialogOpen(false);
          resetForm();
          fetchEntries();
        }
      }
    } catch (error: any) {
      console.error('❌ Error saving entry:', error);
      toast.error(error?.message || t('accounting.journalEntries.errorSaving'));
    } finally {
      setFormLoading(false);
    }
  };

  const handlePost = async (entry: JournalEntry) => {
    if (!canPost) {
      toast.error(t('accounting.journalEntries.noPostPermission', { defaultValue: 'لا تملك صلاحية ترحيل القيود' }));
      return;
    }
    if (!globalThis.window?.confirm(t('accounting.journalEntries.confirmPost', { entryNumber: entry.entry_number }))) {
      return;
    }
    setFormLoading(true);
    const success = await postJournalEntry(entry);
    if (success) fetchEntries();
    setFormLoading(false);
  };

  const handleDelete = async (entry: JournalEntry) => {
    if (!canDelete) {
      toast.error(t('accounting.journalEntries.noDeletePermission', { defaultValue: 'لا تملك صلاحية حذف القيود' }));
      return;
    }
    if (entry.status === 'posted') {
      toast.error(t('accounting.journalEntries.cannotDeletePosted'));
      return;
    }
    if (!globalThis.window?.confirm(t('accounting.journalEntries.confirmDelete', { entryNumber: entry.entry_number }))) {
      return;
    }
    setFormLoading(true);
    const success = await deleteJournalEntry(entry);
    if (success) fetchEntries();
    setFormLoading(false);
  };

  const handleEdit = async (entry: JournalEntry) => {
    if (!canUpdate) {
      toast.error(t('accounting.journalEntries.noUpdatePermission', { defaultValue: 'لا تملك صلاحية تعديل القيود' }));
      return;
    }
    if (entry.status === 'posted') {
      toast.warning(t('accounting.journalEntries.cannotEditPosted'));
      return;
    }
    try {
      setFormLoading(true);
      let lines = await fetchEntryLines(entry.id, accounts);

      if (!lines || lines.length === 0) {
        console.warn('Trying to load lines via service fallback...');
        const fullEntry = await JournalService.getEntryWithDetails(entry.id);
        if (fullEntry?.lines?.length) {
          lines = normalizeLines(fullEntry.lines, entry.id, accounts);
        }
      }

      if (!lines || lines.length === 0) {
        toast.error(t('accounting.journalEntries.emptyEntry'), { duration: 6000 });
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
      toast.error(error.message || t('accounting.journalEntries.failedLoad'));
    } finally {
      setFormLoading(false);
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

  const handleView = async (entry: JournalEntry) => {
    const fullEntry = await JournalService.getEntryWithDetails(entry.id);
    if (fullEntry) {
      setViewingEntry(fullEntry);
      setViewDialogOpen(true);
    }
  };

  const handleReverse = async (entry: JournalEntry) => {
    if (!canReverse) {
      toast.error(t('accounting.journalEntries.noReversePermission', { defaultValue: 'لا تملك صلاحية عكس القيود' }));
      return;
    }
    if (!confirm(t('accounting.journalEntries.confirmReverse'))) {
      return;
    }
    try {
      const result = await JournalService.reverseEntry(entry.id);
      if (result.success) {
        toast.success(t('accounting.journalEntries.entryReversed'));
        fetchEntries();
      }
    } catch (error: any) {
      toast.error(error.message || t('accounting.journalEntries.reversalFailed'));
    }
  };

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setDateFilter('');
    fetchEntries();
  };

  const filteredEntries = entries.filter(entry => {
    const matchesSearch = searchTerm === '' ||
      entry.entry_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.description_ar?.includes(searchTerm);
    return matchesSearch;
  });

  const { totalDebit, totalCredit, balanced } = calculateTotals(formData.lines);
  const balanceKey = String(balanced) as keyof typeof BALANCE_CLASS_NAMES;
  const loadingKey = String(loading) as keyof typeof SAVE_LABEL_KEYS;

  return (
    <div className="container mx-auto p-6" dir={isRTL ? 'rtl' : 'ltr'}>
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <div>
              <CardTitle className="text-2xl">
                {t('accounting.journalEntries.title')}
              </CardTitle>
              <CardDescription>
                {t('accounting.journalEntries.subtitle')}
              </CardDescription>
            </div>
            <Dialog open={canOpenEntryDialog(isDialogOpen, editingEntry, canCreate, canUpdate)} onOpenChange={(open) => {
              setIsDialogOpen(open);
              if (!open) resetForm();
            }}>
              {canCreate && (
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="h-4 w-4 ml-2" />
                    {t('accounting.journalEntries.newEntry')}
                  </Button>
                </DialogTrigger>
              )}
              <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>
                    {editingEntry ? t('accounting.journalEntries.editEntry') : t('accounting.journalEntries.newEntry')}
                  </DialogTitle>
                  <DialogDescription>
                    {t('accounting.journalEntries.enterDetails')}
                  </DialogDescription>
                </DialogHeader>

                <div className="grid gap-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="journal_id">{t('accounting.journalEntries.journalType')}</Label>
                      <Select
                        value={formData.journal_id}
                        onValueChange={(value) => setFormData({ ...formData, journal_id: value })}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t('accounting.journalEntries.selectJournalType')} />
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
                      <Label htmlFor="entry_date">{t('common.date')}</Label>
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
                      <Label htmlFor="description_ar">{t('accounting.journalEntries.descriptionAr')}</Label>
                      <textarea
                        id="description_ar"
                        value={formData.description_ar}
                        onChange={(e) => setFormData({ ...formData, description_ar: e.target.value })}
                        rows={2}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      />
                    </div>

                    <div>
                      <Label htmlFor="description">{t('accounting.journalEntries.descriptionEn')}</Label>
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
                      <Label htmlFor="reference_type">{t('accounting.journalEntries.referenceType')}</Label>
                      <Input
                        id="reference_type"
                        value={formData.reference_type}
                        onChange={(e) => setFormData({ ...formData, reference_type: e.target.value })}
                        placeholder={t('accounting.journalEntries.referenceTypePlaceholder')}
                      />
                    </div>

                    <div>
                      <Label htmlFor="reference_number">{t('accounting.journalEntries.referenceNumber')}</Label>
                      <Input
                        id="reference_number"
                        value={formData.reference_number}
                        onChange={(e) => setFormData({ ...formData, reference_number: e.target.value })}
                      />
                    </div>
                  </div>

                  {/* Tabs for Lines, Attachments, and Comments */}
                  <Tabs defaultValue="lines" className="w-full border-t pt-4">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="lines">{t('accounting.journalEntries.linesTab')}</TabsTrigger>
                      <TabsTrigger value="attachments" disabled={!editingEntry}>
                        {t('accounting.journalEntries.attachmentsTab')}
                        {!editingEntry && <span className="text-xs opacity-50 ml-1">*</span>}
                      </TabsTrigger>
                      <TabsTrigger value="comments" disabled={!editingEntry}>
                        {t('accounting.journalEntries.commentsTab')}
                        {!editingEntry && <span className="text-xs opacity-50 ml-1">*</span>}
                      </TabsTrigger>
                    </TabsList>

                    {!editingEntry && (
                      <div className="mt-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-md">
                        <p className="text-xs text-blue-700 flex items-center gap-2">
                          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                          </svg>
                          <span>{t('accounting.journalEntries.attachmentsNote')}</span>
                        </p>
                      </div>
                    )}

                    <TabsContent value="lines" className="space-y-4">
                      <div className="flex justify-between items-center mb-4">
                        <h3 className="text-lg font-semibold">
                          {t('accounting.entryLines')}
                        </h3>
                        <Button type="button" onClick={addLine} size="sm">
                          <Plus className="h-4 w-4 ml-1" />
                          {t('accounting.journalEntries.addLine')}
                        </Button>
                      </div>

                      <div className="space-y-2">
                        {formData.lines.map((line, index) => (
                          <Card key={`line-${index}-${line.account_id || 'new'}`} className="p-4">
                            <div className="grid grid-cols-12 gap-2 items-end">
                              <div className="col-span-5">
                                <Label>{t('accounting.account')}</Label>
                                <Select
                                  value={line.account_id}
                                  onValueChange={(value) => updateLine(index, 'account_id', value)}
                                >
                                  <SelectTrigger>
                                    <SelectValue placeholder={t('accounting.journalEntries.selectAccount')} />
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
                                <Label>{t('accounting.debit')}</Label>
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
                                <Label>{t('accounting.credit')}</Label>
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
                                <Label>{t('common.description')}</Label>
                                <Input
                                  value={line.description || ''}
                                  onChange={(e) => updateLine(index, 'description', e.target.value)}
                                  placeholder={t('accounting.journalEntries.lineDescPlaceholder')}
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
                        <div className="mt-4 p-4 bg-muted/50 rounded-lg">
                          <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                              <p className="text-sm text-muted-foreground">{t('accounting.journalEntries.totalDebit')}</p>
                              <p className="text-lg font-bold">{totalDebit.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t('accounting.journalEntries.totalCredit')}</p>
                              <p className="text-lg font-bold">{totalCredit.toFixed(2)}</p>
                            </div>
                            <div>
                              <p className="text-sm text-muted-foreground">{t('common.status')}</p>
                              <p className={`text-lg font-bold ${BALANCE_CLASS_NAMES[balanceKey]}`}>
                                {t(BALANCE_LABEL_KEYS[balanceKey])}
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
                          <h3 className="text-lg font-semibold text-foreground mb-2">
                            {t('accounting.journalEntries.saveEntryFirst')}
                          </h3>
                          <p className="text-sm text-muted-foreground max-w-md">
                            {t('accounting.journalEntries.saveEntryFirstAttach')}
                          </p>
                          <Button
                            onClick={handleSubmit}
                            disabled={loading || !balanced}
                            className="mt-4"
                          >
                            {t('accounting.journalEntries.saveEntryNow')}
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
                          <h3 className="text-lg font-semibold text-foreground mb-2">
                            {t('accounting.journalEntries.saveEntryFirst')}
                          </h3>
                          <p className="text-sm text-muted-foreground max-w-md">
                            {t('accounting.journalEntries.saveEntryFirstComments')}
                          </p>
                          <Button
                            onClick={handleSubmit}
                            disabled={loading || !balanced}
                            className="mt-4"
                          >
                            {t('accounting.journalEntries.saveEntryNow')}
                          </Button>
                        </div>
                      )}
                    </TabsContent>
                  </Tabs>

                  <div className="flex justify-end gap-2 pt-4 border-t">
                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button onClick={handleSubmit} disabled={loading || !balanced}>
                      {t(SAVE_LABEL_KEYS[loadingKey])}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>

        <CardContent>
          <JournalEntryFilters
            searchTerm={searchTerm}
            statusFilter={statusFilter}
            dateFilter={dateFilter}
            canPost={canPost}
            t={t}
            onSearchChange={setSearchTerm}
            onStatusChange={setStatusFilter}
            onDateChange={setDateFilter}
            onReset={resetFilters}
            onBatchPost={() => setBatchPostDialogOpen(true)}
          />

          <JournalEntriesTable
            entries={filteredEntries}
            loading={loading}
            isRTL={isRTL}
            canUpdate={canUpdate}
            canPost={canPost}
            canReverse={canReverse}
            canDelete={canDelete}
            t={t}
            onEdit={handleEdit}
            onPost={handlePost}
            onDelete={handleDelete}
            onView={handleView}
            onReverse={handleReverse}
          />
        </CardContent>
      </Card>

      {/* Batch Post Dialog */}
      <BatchPostDialog
        isOpen={batchPostDialogOpen && canPost}
        onClose={() => setBatchPostDialogOpen(false)}
        entries={entries}
        onSuccess={fetchEntries}
      />

      <JournalEntryViewDialog
        open={viewDialogOpen}
        entry={viewingEntry}
        isRTL={isRTL}
        t={t}
        onOpenChange={setViewDialogOpen}
      />
    </div>
  );
};

export default JournalEntries;