import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JournalService, JournalAttachment } from '@/services/accounting/journal-service';
import { useTranslation } from 'react-i18next';
import { Paperclip, X, Download, Upload, Eye, Loader2, FileSpreadsheet } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';

interface AttachmentsSectionProps {
  readonly entryId: string;
}

export function AttachmentsSection({ entryId }: AttachmentsSectionProps) {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [attachments, setAttachments] = useState<JournalAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewType, setPreviewType] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState<string | null>(null);
  const [previewAttachment, setPreviewAttachment] = useState<JournalAttachment | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [csvData, setCsvData] = useState<string[][] | null>(null);

  const loadAttachments = async () => {
    try {
      const data = await JournalService.getEntryAttachments(entryId);
      setAttachments(data);
    } catch (error: unknown) {
      // eslint-disable-next-line no-console
      console.error('Error loading attachments:', error);
    }
  };

  useEffect(() => {
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryId]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      await JournalService.uploadAttachment(entryId, file);
      // Reload list to ensure signed URLs handled consistently
      await loadAttachments();
      toast.success(
        isRTL ? 'تم رفع الملف بنجاح' : 'File uploaded successfully'
      );
    } catch (error: unknown) {
      const defaultMessage = isRTL ? 'فشل رفع الملف' : 'Upload failed';
      const errorMessage = error instanceof Error ? error.message : defaultMessage;
      toast.error(errorMessage);
    } finally {
      setUploading(false);
      // Reset input
      event.target.value = '';
    }
  };

  const handleDelete = async (attachmentId: string) => {
    if (!confirm(isRTL ? 'هل تريد حذف هذا الملف؟' : 'Delete this file?')) {
      return;
    }

    try {
      await JournalService.deleteAttachment(attachmentId);
      setAttachments(attachments.filter(a => a.id !== attachmentId));
      toast.success(isRTL ? 'تم حذف الملف' : 'File deleted');
    } catch (error: unknown) {
      const defaultMessage = isRTL ? 'فشل الحذف' : 'Delete failed';
      const errorMessage = error instanceof Error ? error.message : defaultMessage;
      toast.error(errorMessage);
    }
  };

  const resolveAttachmentUrl = async (attachment: JournalAttachment) => {
    if (!attachment.file_path) {
      throw new Error(isRTL ? 'مسار الملف غير معروف' : 'File path missing');
    }

    // If it's already a full URL, return it
    if (attachment.file_path.startsWith('http')) {
      return attachment.file_path;
    }

    // Create signed URL for storage path
    const { data, error } = await supabase.storage
      .from('documents')
      .createSignedUrl(attachment.file_path, 60 * 60); // 1 hour

    if (error) {
      throw new Error(error?.message || (isRTL ? 'تعذر إنشاء رابط مؤقت' : 'Failed to create signed URL'));
    }

    if (!data?.signedUrl) {
      throw new Error(isRTL ? 'تعذر إنشاء رابط مؤقت' : 'Failed to create signed URL');
    }

    return data.signedUrl;
  };

  const handleDownload = async (attachment: JournalAttachment) => {
    try {
      setDownloadingId(attachment.id);
      const url = await resolveAttachmentUrl(attachment);
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = globalThis.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = attachment.file_name;
      document.body.appendChild(link);
      link.click();
      link.remove(); // Fixed: prefer childNode.remove() over parentNode.removeChild()
      globalThis.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed:', error);
      // Fallback to opening in new tab
      try {
        const fallbackUrl = await resolveAttachmentUrl(attachment);
        window.open(fallbackUrl, '_blank');
      } catch (fallbackError: unknown) {
        // eslint-disable-next-line no-console
        console.error('Fallback download failed:', fallbackError);
        toast.error(isRTL ? 'تعذر تحميل الملف' : 'Failed to download file');
      }
    } finally {
      setDownloadingId(null);
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  const parseCSV = (text: string): string[][] => {
    const lines = text.split(/\r?\n/);
    return lines.map(line => {
      // Simple CSV parser (handles basic cases)
      const values: string[] = [];
      let current = '';
      let inQuotes = false;
      
      for (const char of line) {
        if (char === '"') {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          values.push(current.trim());
          current = '';
        } else {
          current += char;
        }
      }
      values.push(current.trim());
      return values;
    }).filter(row => row.some(cell => cell.length > 0)); // Remove empty rows
  };

  const loadCSVPreview = async (url: string) => {
    try {
      const response = await fetch(url);
      const text = await response.text();
      const parsed = parseCSV(text);
      setCsvData(parsed);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Failed to load CSV:', error);
      setCsvData(null);
    }
  };

  // Helper functions to reduce cognitive complexity
  const getUploadButtonText = (): string => {
    if (uploading) {
      return isRTL ? 'جاري الرفع...' : 'Uploading...';
    }
    return isRTL ? 'رفع ملف' : 'Upload File';
  };

  const handlePreviewClick = async (attachment: JournalAttachment) => {
    try {
      setPreviewLoading(true);
      const signedUrl = await resolveAttachmentUrl(attachment);
      setPreviewUrl(signedUrl);
      setPreviewType(attachment.file_type || 'application/octet-stream');
      setPreviewName(attachment.file_name);
      setPreviewAttachment(attachment);
      
      // Load CSV data if it's a CSV file
      const isCSV = attachment.file_type === 'text/csv' || attachment.file_name.toLowerCase().endsWith('.csv');
      if (isCSV) {
        await loadCSVPreview(signedUrl);
      } else {
        setCsvData(null);
      }
    } catch (error: unknown) {
      const defaultMessage = isRTL ? 'تعذر عرض الملف' : 'Failed to preview file';
      const errorMessage = error instanceof Error ? error.message : defaultMessage;
      toast.error(errorMessage);
    } finally {
      setPreviewLoading(false);
    }
  };

  const renderPreviewContent = () => {
    if (previewType?.startsWith('image/') && previewUrl) {
      return (
        <img 
          src={previewUrl} 
          alt={previewName || 'Preview'} 
          className="max-w-full max-h-full object-contain shadow-lg rounded-md" 
        />
      );
    }
    
    if (previewType === 'application/pdf' && previewUrl) {
      return (
        <iframe 
          src={previewUrl} 
          className="w-full h-full rounded-md shadow-lg" 
          title="PDF Preview"
        />
      );
    }
    
    const isCSVFile = previewType === 'text/csv' || previewName?.toLowerCase().endsWith('.csv');
    if (isCSVFile) {
      return renderCSVPreview();
    }
    
    if (previewType?.startsWith('text/') && previewUrl) {
      return (
        <div className="w-full h-full bg-white rounded-md shadow-lg p-6 overflow-auto">
          <iframe 
            src={previewUrl} 
            className="w-full h-full border-0" 
            title="Text Preview"
            style={{ minHeight: '500px' }}
          />
        </div>
      );
    }
    
    return renderUnsupportedPreview();
  };

  const renderCSVPreview = () => {
    if (!csvData) {
      return (
        <div className="flex items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-blue-600" />
        </div>
      );
    }

    const rowCount = csvData.length;
    const rowLabel = isRTL ? 'صف' : 'rows';
    const csvFileLabel = isRTL ? 'ملف CSV' : 'CSV File';

    return (
      <div className="w-full h-full bg-white rounded-md shadow-lg overflow-auto">
        <div className="p-4">
          <div className="flex items-center gap-2 mb-4 text-green-600">
            <FileSpreadsheet className="h-5 w-5" />
            <span className="font-semibold">
              {csvFileLabel} ({rowCount} {rowLabel})
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse border border-gray-300">
              <thead>
                <tr className="bg-gray-100">
                  {csvData[0]?.map((header) => (
                    <th
                      key={`header-${header}`}
                      className="border border-gray-300 px-4 py-2 text-left text-sm font-semibold text-gray-700"
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {csvData.slice(1).map((row) => {
                  const rowKey = row.join('-');
                  return (
                    <tr key={rowKey} className="hover:bg-gray-50">
                      {row.map((cell) => (
                        <td
                          key={`${rowKey}-${cell}`}
                          className="border border-gray-300 px-4 py-2 text-sm text-gray-600"
                        >
                          {cell}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const renderUnsupportedPreview = () => {
    return (
      <div className="text-center p-8 bg-white rounded-lg shadow-sm">
        <Paperclip className="h-16 w-16 mx-auto text-gray-300 mb-4" />
        <p className="text-lg font-medium text-gray-900 mb-2">
          {isRTL ? 'لا يمكن معاينة هذا الملف' : 'Cannot preview this file'}
        </p>
        <p className="text-sm text-gray-500 mb-4">
          {isRTL ? 'يرجى تحميل الملف لعرضه' : 'Please download the file to view it'}
        </p>
        <Button onClick={() => previewAttachment && handleDownload(previewAttachment)} disabled={!previewAttachment}>
          {isRTL ? 'تحميل الملف' : 'Download File'}
        </Button>
      </div>
    );
  };

  return (
    <>
      <Card dir={isRTL ? 'rtl' : 'ltr'}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="h-5 w-5" />
            {isRTL ? 'المرفقات' : 'Attachments'}
          </CardTitle>
          <CardDescription>
            {isRTL ? 'رفع وإدارة ملفات القيد' : 'Upload and manage entry files'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <Input
                type="file"
                onChange={handleFileUpload}
                disabled={uploading}
                className="hidden"
                id="file-upload"
              />
              <Button
                variant="outline"
                onClick={() => document.getElementById('file-upload')?.click()}
                disabled={uploading}
              >
                <Upload className="h-4 w-4 mr-2" />
                {getUploadButtonText()}
              </Button>
            </div>

            {attachments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                {isRTL ? 'لا توجد مرفقات' : 'No attachments'}
              </div>
            ) : (
              <div className="space-y-2">
                {attachments.map((attachment) => (
                  <div
                    key={attachment.id}
                    className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <Paperclip className="h-4 w-4 text-gray-400" />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{attachment.file_name}</div>
                        <div className="text-sm text-gray-500">
                          {formatFileSize(attachment.file_size)}
                          {attachment.file_type && ` • ${attachment.file_type}`}
                        </div>
                        <div className="text-xs text-gray-400">
                          {format(new Date(attachment.created_at), 'dd/MM/yyyy HH:mm')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handlePreviewClick(attachment)}
                        title={isRTL ? 'معاينة' : 'Preview'}
                        disabled={previewLoading || downloadingId === attachment.id}
                      >
                        {previewLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                        ) : (
                          <Eye className="h-4 w-4 text-blue-600" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDownload(attachment)}
                        title={isRTL ? 'تحميل' : 'Download'}
                        disabled={downloadingId === attachment.id}
                      >
                        {downloadingId === attachment.id ? (
                          <Loader2 className="h-4 w-4 animate-spin text-green-600" />
                        ) : (
                          <Download className="h-4 w-4 text-green-600" />
                        )}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(attachment.id)}
                        title={isRTL ? 'حذف' : 'Delete'}
                      >
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Preview Dialog */}
      <Dialog
        open={!!previewUrl}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewUrl(null);
            setPreviewType(null);
            setPreviewName(null);
            setPreviewAttachment(null);
            setCsvData(null);
          }
        }}
      >
        <DialogContent className="max-w-4xl w-full h-[80vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 border-b">
            <DialogTitle className="flex items-center justify-between">
              <span className="truncate pr-8">{previewName}</span>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => previewAttachment && handleDownload(previewAttachment)}
                  disabled={!previewAttachment}
                >
                  <Download className="h-4 w-4 mr-2" />
                  {isRTL ? 'تحميل' : 'Download'}
                </Button>
              </div>
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 bg-gray-100 p-4 overflow-auto flex items-center justify-center">
            {renderPreviewContent()}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

