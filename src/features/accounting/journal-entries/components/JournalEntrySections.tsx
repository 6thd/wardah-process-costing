import type { TFunction } from 'i18next';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
import { BookOpen, CheckCircle, Edit, FileText, Layers, RotateCcw, Search, Trash2 } from 'lucide-react';
import { ApprovalWorkflow } from './ApprovalWorkflow';
import { AttachmentsSection } from './AttachmentsSection';
import { CommentsSection } from './CommentsSection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TableSkeleton } from '@/components/ui/loading-state';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { JournalEntry } from '../types';

type EntryHandler = (entry: JournalEntry) => void | Promise<void>;

interface JournalEntryFiltersProps {
  searchTerm: string;
  statusFilter: string;
  dateFilter: string;
  canPost: boolean;
  t: TFunction;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: string) => void;
  onDateChange: (value: string) => void;
  onReset: () => void;
  onBatchPost: () => void;
}

export function JournalEntryFilters({
  searchTerm,
  statusFilter,
  dateFilter,
  canPost,
  t,
  onSearchChange,
  onStatusChange,
  onDateChange,
  onReset,
  onBatchPost,
}: Readonly<JournalEntryFiltersProps>) {
  return (
    <div className="flex gap-4 mb-6">
      <div className="flex-1">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder={t('accounting.journalEntries.searchPlaceholder')}
            value={searchTerm}
            onChange={(event) => onSearchChange(event.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t('accounting.journalEntries.allStatuses')}</SelectItem>
          <SelectItem value="draft">{t('accounting.status.draft')}</SelectItem>
          <SelectItem value="posted">{t('accounting.status.posted')}</SelectItem>
          <SelectItem value="reversed">{t('accounting.status.reversed')}</SelectItem>
        </SelectContent>
      </Select>

      <Input
        type="date"
        value={dateFilter}
        onChange={(event) => onDateChange(event.target.value)}
        className="w-48"
      />

      <Button variant="outline" onClick={onReset}>
        {t('common.reset')}
      </Button>
      {canPost && (
        <Button variant="outline" onClick={onBatchPost}>
          <Layers className="h-4 w-4 mr-2" />
          {t('accounting.journalEntries.batchPost')}
        </Button>
      )}
    </div>
  );
}

interface JournalEntriesTableProps {
  entries: JournalEntry[];
  loading: boolean;
  isRTL: boolean;
  canUpdate: boolean;
  canPost: boolean;
  canReverse: boolean;
  canDelete: boolean;
  t: TFunction;
  onEdit: EntryHandler;
  onPost: EntryHandler;
  onDelete: EntryHandler;
  onView: EntryHandler;
  onReverse: EntryHandler;
}

function StatusBadge({ status, t }: Readonly<{ status: string; t: TFunction }>) {
  const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
    draft: 'secondary',
    posted: 'default',
    reversed: 'destructive',
  };

  return <Badge variant={variants[status]}>{t(`accounting.status.${status}`)}</Badge>;
}

function LoadingRows() {
  return (
    <TableRow>
      <TableCell colSpan={8} className="p-4">
        <TableSkeleton rows={5} />
      </TableCell>
    </TableRow>
  );
}

function EmptyRows({ t }: Readonly<{ t: TFunction }>) {
  return (
    <TableRow>
      <TableCell colSpan={8}>
        <EmptyState
          icon={<BookOpen aria-hidden="true" />}
          title={t('accounting.journalEntries.noEntries')}
          description={t('accounting.journalEntries.noEntriesDesc')}
        />
      </TableCell>
    </TableRow>
  );
}

interface JournalEntryActionsProps {
  entry: JournalEntry;
  canUpdate: boolean;
  canPost: boolean;
  canReverse: boolean;
  canDelete: boolean;
  t: TFunction;
  onEdit: EntryHandler;
  onPost: EntryHandler;
  onDelete: EntryHandler;
  onView: EntryHandler;
  onReverse: EntryHandler;
}

function JournalEntryActions({
  entry,
  canUpdate,
  canPost,
  canReverse,
  canDelete,
  t,
  onEdit,
  onPost,
  onDelete,
  onView,
  onReverse,
}: Readonly<JournalEntryActionsProps>) {
  if (entry.status === 'draft') {
    return (
      <div className="flex justify-center gap-2">
        {canUpdate && (
          <Button size="sm" variant="ghost" onClick={() => onEdit(entry)} title={t('common.edit')}>
            <Edit className="h-4 w-4" />
          </Button>
        )}
        {canPost && (
          <Button size="sm" variant="ghost" onClick={() => onPost(entry)} title={t('accounting.journalEntries.post')}>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </Button>
        )}
        {canDelete && (
          <Button size="sm" variant="ghost" onClick={() => onDelete(entry)} title={t('common.delete')}>
            <Trash2 className="h-4 w-4 text-red-600" />
          </Button>
        )}
      </div>
    );
  }

  if (entry.status !== 'posted') {
    return <div className="flex justify-center gap-2" />;
  }

  return (
    <div className="flex justify-center gap-2">
      <Button size="sm" variant="ghost" onClick={() => onView(entry)} title={t('accounting.journalEntries.view')}>
        <FileText className="h-4 w-4 text-blue-600" />
      </Button>
      {!entry.reversed_by_entry_id && canReverse && (
        <Button size="sm" variant="ghost" onClick={() => onReverse(entry)} title={t('accounting.journalEntries.reverse')}>
          <RotateCcw className="h-4 w-4 text-orange-600" />
        </Button>
      )}
    </div>
  );
}

function EntryRow({
  entry,
  isRTL,
  canUpdate,
  canPost,
  canReverse,
  canDelete,
  t,
  onEdit,
  onPost,
  onDelete,
  onView,
  onReverse,
}: Readonly<Omit<JournalEntriesTableProps, 'entries' | 'loading'> & { entry: JournalEntry }>) {
  return (
    <TableRow>
      <TableCell className="font-medium">{entry.entry_number}</TableCell>
      <TableCell>{format(new Date(entry.entry_date), 'dd/MM/yyyy', { locale: isRTL ? ar : undefined })}</TableCell>
      <TableCell>{isRTL ? (entry.journal_name_ar || entry.journal_name) : entry.journal_name}</TableCell>
      <TableCell>{isRTL ? entry.description_ar : entry.description}</TableCell>
      <TableCell className="text-right font-mono" dir="ltr">
        {entry.total_debit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell className="text-right font-mono" dir="ltr">
        {entry.total_credit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </TableCell>
      <TableCell><StatusBadge status={entry.status} t={t} /></TableCell>
      <TableCell>
        <JournalEntryActions
          entry={entry}
          canUpdate={canUpdate}
          canPost={canPost}
          canReverse={canReverse}
          canDelete={canDelete}
          t={t}
          onEdit={onEdit}
          onPost={onPost}
          onDelete={onDelete}
          onView={onView}
          onReverse={onReverse}
        />
      </TableCell>
    </TableRow>
  );
}

export function JournalEntriesTable(props: Readonly<JournalEntriesTableProps>) {
  const { entries, loading, t } = props;
  let rows = <EmptyRows t={t} />;
  if (loading) {
    rows = <LoadingRows />;
  } else if (entries.length > 0) {
    rows = <>{entries.map((entry) => <EntryRow key={entry.id} entry={entry} {...props} />)}</>;
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('accounting.entryNumber')}</TableHead>
            <TableHead>{t('common.date')}</TableHead>
            <TableHead>{t('accounting.journalEntries.journal')}</TableHead>
            <TableHead>{t('common.description')}</TableHead>
            <TableHead className="text-right">{t('accounting.debit')}</TableHead>
            <TableHead className="text-right">{t('accounting.credit')}</TableHead>
            <TableHead>{t('common.status')}</TableHead>
            <TableHead className="text-center">{t('common.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>{rows}</TableBody>
      </Table>
    </div>
  );
}

interface JournalEntryViewDialogProps {
  open: boolean;
  entry: JournalEntry | null;
  isRTL: boolean;
  canApprove: boolean;
  t: TFunction;
  onOpenChange: (open: boolean) => void;
}

function EntryDetails({ entry, isRTL, canApprove, t }: Readonly<{ entry: JournalEntry; isRTL: boolean; canApprove: boolean; t: TFunction }>) {
  return (
    <Tabs defaultValue="details" className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="details">{t('accounting.journalEntries.details')}</TabsTrigger>
        <TabsTrigger value="approvals">{t('accounting.journalEntries.approvals')}</TabsTrigger>
        <TabsTrigger value="attachments">{t('accounting.journalEntries.attachmentsTab')}</TabsTrigger>
        <TabsTrigger value="comments">{t('accounting.journalEntries.commentsTab')}</TabsTrigger>
      </TabsList>

      <TabsContent value="details" className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div><Label>{t('accounting.entryNumber')}</Label><p className="font-mono">{entry.entry_number}</p></div>
          <div><Label>{t('common.date')}</Label><p>{format(new Date(entry.entry_date), 'dd/MM/yyyy')}</p></div>
          <div><Label>{t('common.status')}</Label><div><StatusBadge status={entry.status} t={t} /></div></div>
          <div><Label>{t('accounting.debit')}</Label><p className="font-mono">{entry.total_debit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p></div>
          <div><Label>{t('accounting.credit')}</Label><p className="font-mono">{entry.total_credit.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p></div>
        </div>

        {entry.lines && entry.lines.length > 0 && (
          <div className="border rounded-lg">
            <Table>
              <TableHeader><TableRow><TableHead>{t('accounting.account')}</TableHead><TableHead className="text-right">{t('accounting.debit')}</TableHead><TableHead className="text-right">{t('accounting.credit')}</TableHead><TableHead>{t('common.description')}</TableHead></TableRow></TableHeader>
              <TableBody>
                {entry.lines.map((line) => (
                  <TableRow key={line.id || line.line_number}>
                    <TableCell>{line.account_code} - {isRTL ? (line.account_name_ar || line.account_name) : line.account_name}</TableCell>
                    <TableCell className="text-right font-mono">{Number(line.debit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell className="text-right font-mono">{Number(line.credit || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</TableCell>
                    <TableCell>{isRTL ? line.description_ar : line.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </TabsContent>

      <TabsContent value="approvals"><ApprovalWorkflow entryId={entry.id} entryNumber={entry.entry_number} canApprove={canApprove} /></TabsContent>
      <TabsContent value="attachments"><AttachmentsSection entryId={entry.id} /></TabsContent>
      <TabsContent value="comments"><CommentsSection entryId={entry.id} /></TabsContent>
    </Tabs>
  );
}

export function JournalEntryViewDialog({ open, entry, isRTL, canApprove, t, onOpenChange }: Readonly<JournalEntryViewDialogProps>) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>{t('accounting.entryDetails')} - {entry?.entry_number}</DialogTitle>
          <DialogDescription>{t('accounting.journalEntries.viewEntryDetails')}</DialogDescription>
        </DialogHeader>
        {entry && <EntryDetails entry={entry} isRTL={isRTL} canApprove={canApprove} t={t} />}
      </DialogContent>
    </Dialog>
  );
}
