import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { JournalService, JournalAttachment } from '@/services/accounting/journal-service';
import { useTranslation } from 'react-i18next';
import { Paperclip, X, Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface AttachmentsSectionProps {
  entryId: string;
}

export function AttachmentsSection({ entryId }: AttachmentsSectionProps) {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [attachments, setAttachments] = useState<JournalAttachment[]>([]);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    loadAttachments();
  }, [entryId]);

  const loadAttachments = async () => {
    try {
      const data = await JournalService.getEntryAttachments(entryId);
      setAttachments(data);
    } catch (error: any) {
      console.error('Error loading attachments:', error);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      const attachment = await JournalService.uploadAttachment(entryId, file);
      setAttachments([attachment, ...attachments]);
      toast.success(
        isRTL ? 'تم رفع الملف بنجاح' : 'File uploaded successfully'
      );
    } catch (error: any) {
      toast.error(error.message || (isRTL ? 'فشل رفع الملف' : 'Upload failed'));
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
    } catch (error: any) {
      toast.error(error.message || (isRTL ? 'فشل الحذف' : 'Delete failed'));
    }
  };

  const formatFileSize = (bytes?: number) => {
    if (!bytes) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  };

  return (
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
              {uploading
                ? (isRTL ? 'جاري الرفع...' : 'Uploading...')
                : (isRTL ? 'رفع ملف' : 'Upload File')}
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
                      onClick={() => window.open(attachment.file_path, '_blank')}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(attachment.id)}
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
  );
}

