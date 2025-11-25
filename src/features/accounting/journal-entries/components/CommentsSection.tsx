import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { JournalService, JournalComment } from '@/services/accounting/journal-service';
import { useTranslation } from 'react-i18next';
import { MessageSquare, Send, Trash2, User } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface CommentsSectionProps {
  entryId: string;
}

export function CommentsSection({ entryId }: CommentsSectionProps) {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [comments, setComments] = useState<JournalComment[]>([]);
  const [newComment, setNewComment] = useState('');
  const [commentType, setCommentType] = useState<'note' | 'comment' | 'internal'>('comment');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadComments();
  }, [entryId]);

  const loadComments = async () => {
    try {
      const data = await JournalService.getEntryComments(entryId);
      setComments(data);
    } catch (error: any) {
      console.error('Error loading comments:', error);
    }
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) {
      toast.error(isRTL ? 'يرجى إدخال تعليق' : 'Please enter a comment');
      return;
    }

    setLoading(true);
    try {
      const comment = await JournalService.addComment(entryId, newComment, commentType);
      setComments([comment, ...comments]);
      setNewComment('');
      toast.success(isRTL ? 'تم إضافة التعليق' : 'Comment added');
    } catch (error: any) {
      toast.error(error.message || (isRTL ? 'فشل إضافة التعليق' : 'Failed to add comment'));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (commentId: string) => {
    if (!confirm(isRTL ? 'هل تريد حذف هذا التعليق؟' : 'Delete this comment?')) {
      return;
    }

    try {
      await JournalService.deleteComment(commentId);
      setComments(comments.filter(c => c.id !== commentId));
      toast.success(isRTL ? 'تم حذف التعليق' : 'Comment deleted');
    } catch (error: any) {
      toast.error(error.message || (isRTL ? 'فشل الحذف' : 'Delete failed'));
    }
  };

  const getTypeLabel = (type: string) => {
    const labels = {
      note: { ar: 'ملاحظة', en: 'Note' },
      comment: { ar: 'تعليق', en: 'Comment' },
      internal: { ar: 'داخلي', en: 'Internal' }
    };
    return isRTL ? labels[type as keyof typeof labels]?.ar : labels[type as keyof typeof labels]?.en;
  };

  const getTypeBadge = (type: string) => {
    const variants: Record<string, 'default' | 'secondary' | 'outline'> = {
      note: 'default',
      comment: 'secondary',
      internal: 'outline'
    };
    return variants[type] || 'secondary';
  };

  return (
    <Card dir={isRTL ? 'rtl' : 'ltr'}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageSquare className="h-5 w-5" />
          {isRTL ? 'التعليقات والملاحظات' : 'Comments & Notes'}
        </CardTitle>
        <CardDescription>
          {isRTL ? 'إضافة تعليقات وملاحظات على القيد' : 'Add comments and notes to the entry'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="space-y-2">
            <Select value={commentType} onValueChange={(v: any) => setCommentType(v)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="comment">
                  {isRTL ? 'تعليق' : 'Comment'}
                </SelectItem>
                <SelectItem value="note">
                  {isRTL ? 'ملاحظة' : 'Note'}
                </SelectItem>
                <SelectItem value="internal">
                  {isRTL ? 'داخلي' : 'Internal'}
                </SelectItem>
              </SelectContent>
            </Select>
            <Textarea
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              placeholder={isRTL ? 'أضف تعليقاً أو ملاحظة...' : 'Add a comment or note...'}
              rows={3}
            />
            <Button onClick={handleAddComment} disabled={loading || !newComment.trim()}>
              <Send className="h-4 w-4 mr-2" />
              {loading
                ? (isRTL ? 'جاري الإضافة...' : 'Adding...')
                : (isRTL ? 'إضافة' : 'Add')}
            </Button>
          </div>

          {comments.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              {isRTL ? 'لا توجد تعليقات' : 'No comments'}
            </div>
          ) : (
            <div className="space-y-3">
              {comments.map((comment) => (
                  <div
                  key={comment.id}
                  className="p-3 border rounded-lg hover:bg-gray-50"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <User className="h-4 w-4 text-gray-400" />
                        <span className="text-sm font-medium">
                          {comment.created_by?.substring(0, 8) || 'System'}...
                        </span>
                        <Badge variant={getTypeBadge(comment.comment_type)}>
                          {getTypeLabel(comment.comment_type)}
                        </Badge>
                        <span className="text-xs text-gray-400">
                          {format(new Date(comment.created_at), 'dd/MM/yyyy HH:mm')}
                        </span>
                      </div>
                      <div className="text-sm text-gray-700 whitespace-pre-wrap">
                        {comment.comment_text}
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => handleDelete(comment.id)}
                    >
                      <Trash2 className="h-4 w-4 text-red-600" />
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

