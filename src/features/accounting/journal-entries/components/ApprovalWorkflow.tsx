import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { JournalService, JournalApproval } from '@/services/accounting/journal-service';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, Clock, User } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface ApprovalWorkflowProps {
  entryId: string;
  entryNumber: string;
  canApprove?: boolean;
}

export function ApprovalWorkflow({ entryId, entryNumber, canApprove = false }: ApprovalWorkflowProps) {
  const { i18n } = useTranslation();
  const isRTL = i18n.language === 'ar';
  const [approvals, setApprovals] = useState<JournalApproval[]>([]);
  const [approvalInfo, setApprovalInfo] = useState<{
    required: boolean;
    required_levels: number;
    current_levels: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [approvingLevel, setApprovingLevel] = useState<number | null>(null);
  const [approvalComments, setApprovalComments] = useState('');

  useEffect(() => {
    loadApprovals();
  }, [entryId]);

  const loadApprovals = async () => {
    try {
      const [approvalsData, approvalInfoData] = await Promise.all([
        JournalService.getEntryApprovals(entryId),
        JournalService.checkApprovalRequired(entryId)
      ]);
      setApprovals(approvalsData);
      setApprovalInfo(approvalInfoData);
    } catch (error: any) {
      console.error('Error loading approvals:', error);
    }
  };

  const handleApprove = async (level: number) => {
    setApprovingLevel(level);
    setApproveDialogOpen(true);
  };

  const confirmApprove = async () => {
    if (!approvingLevel) return;

    setLoading(true);
    try {
      const result = await JournalService.approveEntry(
        entryId,
        approvingLevel,
        approvalComments || undefined
      );

      if (result.success) {
        toast.success(
          isRTL 
            ? `تمت الموافقة على المستوى ${approvingLevel}`
            : `Approved at level ${approvingLevel}`
        );
        await loadApprovals();
        setApproveDialogOpen(false);
        setApprovalComments('');
        setApprovingLevel(null);
      } else {
        toast.error(isRTL ? 'فشلت الموافقة' : 'Approval failed');
      }
    } catch (error: any) {
      toast.error(error.message || (isRTL ? 'حدث خطأ' : 'An error occurred'));
    } finally {
      setLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle className="h-4 w-4 text-green-600" />;
      case 'rejected':
        return <XCircle className="h-4 w-4 text-red-600" />;
      default:
        return <Clock className="h-4 w-4 text-yellow-600" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const labels = {
      pending: { ar: 'قيد الانتظار', en: 'Pending' },
      approved: { ar: 'موافق', en: 'Approved' },
      rejected: { ar: 'مرفوض', en: 'Rejected' }
    };

    const variants: Record<string, 'default' | 'secondary' | 'destructive'> = {
      pending: 'secondary',
      approved: 'default',
      rejected: 'destructive'
    };

    return (
      <Badge variant={variants[status]}>
        {isRTL ? labels[status as keyof typeof labels]?.ar : labels[status as keyof typeof labels]?.en}
      </Badge>
    );
  };

  if (!approvalInfo?.required && approvals.length === 0) {
    return null;
  }

  return (
    <Card dir={isRTL ? 'rtl' : 'ltr'}>
      <CardHeader>
        <CardTitle>{isRTL ? 'سير عمل الموافقات' : 'Approval Workflow'}</CardTitle>
        <CardDescription>
          {isRTL 
            ? `المستوى المطلوب: ${approvalInfo?.required_levels || 0} | المعتمد: ${approvalInfo?.current_levels || 0}`
            : `Required: ${approvalInfo?.required_levels || 0} | Approved: ${approvalInfo?.current_levels || 0}`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {approvals.map((approval) => (
            <div
              key={approval.id}
              className="flex items-center justify-between p-3 border rounded-lg"
            >
              <div className="flex items-center gap-3">
                {getStatusIcon(approval.status)}
                <div>
                  <div className="font-medium">
                    {isRTL ? `المستوى ${approval.approval_level}` : `Level ${approval.approval_level}`}
                  </div>
                  <div className="text-sm text-gray-500">
                    {approval.approver_id.substring(0, 8)}...
                  </div>
                  {approval.comments && (
                    <div className="text-sm text-gray-600 mt-1">
                      {approval.comments}
                    </div>
                  )}
                  {approval.approved_at && (
                    <div className="text-xs text-gray-400 mt-1">
                      {format(new Date(approval.approved_at), 'dd/MM/yyyy HH:mm')}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {getStatusBadge(approval.status)}
                {approval.status === 'pending' && canApprove && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleApprove(approval.approval_level)}
                  >
                    {isRTL ? 'موافقة' : 'Approve'}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {approvalInfo?.required && approvalInfo.current_levels < approvalInfo.required_levels && (
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-800">
              {isRTL
                ? `يحتاج ${approvalInfo.required_levels - approvalInfo.current_levels} موافقة إضافية`
                : `Requires ${approvalInfo.required_levels - approvalInfo.current_levels} more approval(s)`}
            </p>
          </div>
        )}
      </CardContent>

      <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
        <DialogContent dir={isRTL ? 'rtl' : 'ltr'}>
          <DialogHeader>
            <DialogTitle>
              {isRTL ? 'الموافقة على القيد' : 'Approve Entry'}
            </DialogTitle>
            <DialogDescription>
              {isRTL
                ? `الموافقة على القيد ${entryNumber} - المستوى ${approvingLevel}`
                : `Approve entry ${entryNumber} - Level ${approvingLevel}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">
                {isRTL ? 'تعليقات (اختياري)' : 'Comments (Optional)'}
              </label>
              <Textarea
                value={approvalComments}
                onChange={(e) => setApprovalComments(e.target.value)}
                rows={3}
                placeholder={isRTL ? 'أضف تعليقات...' : 'Add comments...'}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setApproveDialogOpen(false)}>
                {isRTL ? 'إلغاء' : 'Cancel'}
              </Button>
              <Button onClick={confirmApprove} disabled={loading}>
                {loading
                  ? (isRTL ? 'جاري...' : 'Processing...')
                  : (isRTL ? 'موافقة' : 'Approve')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

