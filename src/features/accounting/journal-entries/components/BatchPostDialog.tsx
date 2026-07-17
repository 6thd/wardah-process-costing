import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { JournalService } from '@/services/accounting/journal-service';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface BatchPostDialogProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly entries: ReadonlyArray<{ readonly id: string; readonly entry_number: string; readonly total_debit: number; readonly status: string }>;
  readonly onSuccess: () => void;
}

// eslint-disable-next-line complexity
export function BatchPostDialog({ isOpen, onClose, entries, onSuccess }: BatchPostDialogProps) {
  const { t, i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [selectedEntries, setSelectedEntries] = useState<Set<string>>(new Set());
  const [posting, setPosting] = useState(false);
  const [results, setResults] = useState<Array<{
    entry_id: string;
    success: boolean;
    message?: string;
    error?: string;
  }>>([]);

  // Filter draft entries only
  const draftEntries = (entries || []).filter(e => e.status === 'draft');

  const toggleEntry = (entryId: string) => {
    const newSelected = new Set(selectedEntries);
    if (newSelected.has(entryId)) {
      newSelected.delete(entryId);
    } else {
      newSelected.add(entryId);
    }
    setSelectedEntries(newSelected);
  };

  const selectAll = () => {
    if (selectedEntries.size === draftEntries.length) {
      setSelectedEntries(new Set());
    } else {
      setSelectedEntries(new Set(draftEntries.map(e => e.id)));
    }
  };

  const handleBatchPost = async () => {
    if (selectedEntries.size === 0) {
      toast.error(t('batchPost.selectEntries'));
      return;
    }

    setPosting(true);
    setResults([]);

    try {
      const entryIds = Array.from(selectedEntries);
      const result = await JournalService.batchPostEntries(entryIds);
      
      setResults(result.results || []);
      
      if (result.success) {
        toast.success(
          t('batchPost.postSuccess', { success: result.success_count, total: result.total })
        );
        onSuccess();
        setTimeout(() => {
          onClose();
          setSelectedEntries(new Set());
          setResults([]);
        }, 2000);
      } else {
        toast.warning(
          t('batchPost.postPartial', { success: result.success_count, total: result.total, failed: result.fail_count })
        );
      }
    } catch (error: any) {
      toast.error(error.message || t('batchPost.postFailed'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle>
            {t('batchPost.title')}
          </DialogTitle>
          <DialogDescription>
            {t('batchPost.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {draftEntries.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              {t('batchPost.noDrafts')}
            </div>
          ) : (
            <>
              <div className="flex justify-between items-center">
                <Button variant="outline" size="sm" onClick={selectAll}>
                  {selectedEntries.size === draftEntries.length
                    ? t('batchPost.deselectAll')
                    : t('batchPost.selectAll')}
                </Button>
                <Badge variant="secondary">
                  {selectedEntries.size} / {draftEntries.length} {t('batchPost.selected')}
                </Badge>
              </div>

              <div className="border rounded-lg max-h-96 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12"></TableHead>
                      <TableHead>{t('batchPost.entryNumber')}</TableHead>
                      <TableHead className="text-right">{t('batchPost.amount')}</TableHead>
                      <TableHead>{t('batchPost.status')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {draftEntries.map((entry) => {
                      const isSelected = selectedEntries.has(entry.id);
                      const result = results?.find(r => r.entry_id === entry.id);
                      
                      return (
                        <TableRow key={entry.id}>
                          <TableCell>
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleEntry(entry.id)}
                              disabled={posting}
                            />
                          </TableCell>
                          <TableCell className="font-medium">{entry.entry_number}</TableCell>
                          <TableCell className="text-right font-mono">
                            {entry.total_debit.toLocaleString('en-US', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2
                            })}
                          </TableCell>
                          <TableCell>
                            {/* eslint-disable-next-line complexity */}
                            {(() => {
                              if (!result) {
                                return (
                                  <Badge variant="secondary">
                                    {t('batchPost.draft')}
                                  </Badge>
                                );
                              }
                              if (result.success) {
                                return (
                                  <Badge variant="default" className="bg-green-600">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    {t('batchPost.posted')}
                                  </Badge>
                                );
                              }
                              return (
                                <Badge variant="destructive">
                                  <XCircle className="h-3 w-3 mr-1" />
                                  {t('batchPost.failed')}
                                </Badge>
                              );
                            })()}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {results && results.length > 0 && (
                <div className="border rounded-lg p-4 bg-muted/50">
                  <h4 className="font-semibold mb-2">
                    {t('batchPost.results')}
                  </h4>
                  <div className="space-y-1 text-sm">
                    {results.map((result) => (
                      <div key={result.entry_id} className="flex items-center gap-2">
                        {result.success ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <XCircle className="h-4 w-4 text-red-600" />
                        )}
                        <span className="font-mono">{result.entry_id.substring(0, 8)}...</span>
                        <span className="text-muted-foreground">
                          {result.message || result.error}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose} disabled={posting}>
                  {t('batchPost.cancel')}
                </Button>
                <Button 
                  onClick={handleBatchPost} 
                  disabled={posting || selectedEntries.size === 0}
                >
                  {posting ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {t('batchPost.posting')}
                    </>
                  ) : (
                    <>
                      {t('batchPost.postSelected')}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

