import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  Search,
  CalendarDays,
} from 'lucide-react';
import { getEmployees } from '@/services/hr/hr-service';
import {
  listLeaveRequests,
  getLeaveTypes,
  approveLeaveRequest,
  rejectLeaveRequest,
  createLeaveRequest,
  getLeaveBalance,
  type LeaveRequestRow,
  type LeaveTypeRow,
} from '@/services/hr/leave-service';
import { STATUS_BADGES } from '../types';
import { getHrStatusKey, useHrTranslation } from '../i18n';
import '../translations/pages';

const emptyForm = {
  employee_id: '',
  leave_type_id: '',
  start_date: '',
  end_date: '',
  reason: '',
};

export const LeavesPage: React.FC = () => {
  const { t, i18n } = useHrTranslation();
  const isArabic = i18n.resolvedLanguage?.startsWith('ar') ?? true;
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewRequestDialog, setShowNewRequestDialog] = useState(false);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [approveAction, setApproveAction] = useState<'approve' | 'reject'>('approve');
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestRow | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [adminOverride, setAdminOverride] = useState(false);
  const [newForm, setNewForm] = useState(emptyForm);

  const { data: leaveRequests = [], isLoading } = useQuery({
    queryKey: ['hr', 'leave-requests'],
    queryFn: () => listLeaveRequests(200),
  });
  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
  });
  const { data: leaveTypes = [] } = useQuery({
    queryKey: ['hr', 'leave-types'],
    queryFn: getLeaveTypes,
  });
  const { data: selectedBalance } = useQuery({
    queryKey: ['hr', 'leave-balance', selectedRequest?.employee_id],
    queryFn: () => getLeaveBalance(selectedRequest!.employee_id),
    enabled: Boolean(selectedRequest?.employee_id),
  });

  const leaveTypeName = React.useCallback(
    (leaveType?: LeaveTypeRow | LeaveTypeRow[] | null) => {
      const item = Array.isArray(leaveType) ? leaveType[0] : leaveType;
      if (!item) return '—';
      return isArabic ? item.name_ar || item.name : item.name || item.name_ar;
    },
    [isArabic],
  );

  const filteredRequests = React.useMemo(
    () => leaveRequests.filter((request) => {
      const matchesTab = activeTab === 'all' || request.status === activeTab;
      const employee = Array.isArray(request.employee) ? request.employee[0] : request.employee;
      return matchesTab && (!searchQuery || (employee?.full_name ?? '').toLowerCase().includes(searchQuery.toLowerCase()));
    }),
    [activeTab, leaveRequests, searchQuery],
  );

  const stats = React.useMemo(() => ({
    pending: leaveRequests.filter((request) => request.status === 'pending').length,
    approved: leaveRequests.filter((request) => request.status === 'approved').length,
    rejected: leaveRequests.filter((request) => request.status === 'rejected').length,
    total: leaveRequests.length,
  }), [leaveRequests]);

  const closeApprovalDialog = React.useCallback(() => {
    setShowApprovalDialog(false);
    setSelectedRequest(null);
    setApprovalNote('');
    setAdminOverride(false);
  }, []);

  const approveMutation = useMutation({
    mutationFn: ({ id, override }: { id: string; override: boolean }) => approveLeaveRequest(id, override),
    onSuccess: () => {
      toast.success(t('leaves.approvedSuccess'));
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-requests'] });
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-balance'] });
      closeApprovalDialog();
    },
    onError: (error: Error) => toast.error(error.message || t('leaves.operationFailed')),
  });
  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) => rejectLeaveRequest(id, notes),
    onSuccess: () => {
      toast.success(t('leaves.rejectedSuccess'));
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-requests'] });
      closeApprovalDialog();
    },
    onError: (error: Error) => toast.error(error.message || t('leaves.operationFailed')),
  });
  const createMutation = useMutation({
    mutationFn: () => createLeaveRequest(newForm),
    onSuccess: () => {
      toast.success(t('leaves.createdSuccess'));
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-requests'] });
      setShowNewRequestDialog(false);
      setNewForm(emptyForm);
    },
    onError: (error: Error) => toast.error(error.message || t('leaves.operationFailed')),
  });

  const openApprovalDialog = (request: LeaveRequestRow, action: 'approve' | 'reject') => {
    setSelectedRequest(request);
    setApproveAction(action);
    setApprovalNote('');
    setAdminOverride(false);
    setShowApprovalDialog(true);
  };

  const confirmApproval = () => {
    if (!selectedRequest) return;
    if (approveAction === 'approve') {
      approveMutation.mutate({ id: selectedRequest.id, override: adminOverride });
    } else {
      rejectMutation.mutate({ id: selectedRequest.id, notes: approvalNote });
    }
  };

  const isPending = approveMutation.isPending || rejectMutation.isPending || createMutation.isPending;
  const statCards = [
    { key: 'pendingRequests', value: stats.pending, className: 'border-amber-500/30 bg-amber-500/10', text: 'text-amber-400', Icon: AlertCircle },
    { key: 'approvedRequests', value: stats.approved, className: 'border-emerald-500/30 bg-emerald-500/10', text: 'text-emerald-400', Icon: CheckCircle2 },
    { key: 'rejectedRequests', value: stats.rejected, className: 'border-rose-500/30 bg-rose-500/10', text: 'text-rose-400', Icon: XCircle },
    { key: 'totalRequests', value: stats.total, className: 'border-blue-500/30 bg-blue-500/10', text: 'text-blue-400', Icon: CalendarDays },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('leaves.title')}</h1>
        <p className="text-muted-foreground">{t('leaves.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {statCards.map(({ key, value, className, text, Icon }) => (
          <Card key={key} className={className}>
            <CardContent className="flex items-center justify-between p-4">
              <div><p className={`text-sm ${text}`}>{t(`leaves.${key}`)}</p><p className="text-2xl font-bold">{value}</p></div>
              <Icon className={`h-8 w-8 ${text}`} />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div><CardTitle>{t('leaves.listTitle')}</CardTitle><CardDescription>{t('leaves.listDescription')}</CardDescription></div>
          <Button onClick={() => setShowNewRequestDialog(true)}><Plus className="h-4 w-4 me-2" />{t('leaves.newRequest')}</Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search className={`absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground ${isArabic ? 'right-3' : 'left-3'}`} />
            <Input placeholder={t('leaves.searchPlaceholder')} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} className={isArabic ? 'pr-10' : 'pl-10'} />
          </div>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="pending">{t('common.pending')} ({stats.pending})</TabsTrigger>
              <TabsTrigger value="approved">{t('leaves.approvedTab')}</TabsTrigger>
              <TabsTrigger value="rejected">{t('leaves.rejectedTab')}</TabsTrigger>
              <TabsTrigger value="all">{t('common.all')}</TabsTrigger>
            </TabsList>
            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? <div className="py-8 text-center text-muted-foreground">{t('common.loading')}</div> : filteredRequests.length === 0 ? <div className="py-8 text-center text-muted-foreground">{t('leaves.noRequests')}</div> : (
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>{t('common.employee')}</TableHead><TableHead>{t('leaves.leaveType')}</TableHead><TableHead>{t('leaves.from')}</TableHead><TableHead>{t('leaves.to')}</TableHead><TableHead>{t('leaves.duration')}</TableHead><TableHead>{t('common.status')}</TableHead><TableHead>{t('common.actions')}</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>{filteredRequests.map((request) => {
                    const employee = Array.isArray(request.employee) ? request.employee[0] : request.employee;
                    return <TableRow key={request.id}>
                      <TableCell className="font-medium">{employee?.full_name ?? '—'}</TableCell>
                      <TableCell>{leaveTypeName(request.leave_type)}</TableCell>
                      <TableCell dir="ltr">{request.start_date}</TableCell><TableCell dir="ltr">{request.end_date}</TableCell>
                      <TableCell><Badge variant="outline">{t('leaves.days', { count: request.total_days })}</Badge></TableCell>
                      <TableCell><Badge className={STATUS_BADGES[request.status] || 'bg-slate-100 text-slate-700'}>{t(getHrStatusKey(request.status))}</Badge></TableCell>
                      <TableCell>{request.status === 'pending' && <div className="flex gap-2"><Button size="sm" variant="outline" aria-label={t('common.approve')} onClick={() => openApprovalDialog(request, 'approve')}><CheckCircle2 className="h-4 w-4" /></Button><Button size="sm" variant="outline" aria-label={t('common.reject')} onClick={() => openApprovalDialog(request, 'reject')}><XCircle className="h-4 w-4" /></Button></div>}</TableCell>
                    </TableRow>;
                  })}</TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t(approveAction === 'approve' ? 'leaves.approveTitle' : 'leaves.rejectTitle')}</DialogTitle><DialogDescription>{t(approveAction === 'approve' ? 'leaves.approveDescription' : 'leaves.rejectDescription')}</DialogDescription></DialogHeader>
          {selectedRequest && <div className="space-y-4">
            <div className="rounded-lg border p-4 text-sm space-y-2">
              <div className="flex justify-between"><span className="text-muted-foreground">{t('common.employee')}</span><span>{(Array.isArray(selectedRequest.employee) ? selectedRequest.employee[0] : selectedRequest.employee)?.full_name ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('leaves.leaveType')}</span><span>{leaveTypeName(selectedRequest.leave_type)}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('leaves.period')}</span><span dir="ltr">{selectedRequest.start_date} → {selectedRequest.end_date}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">{t('leaves.duration')}</span><span>{t('leaves.days', { count: selectedRequest.total_days })}</span></div>
            </div>
            {selectedBalance && <div className="rounded-lg bg-muted/50 p-3 text-sm">
              <p className="font-medium mb-2">{t('leaves.leaveBalance')}</p>
              <div className="grid grid-cols-3 gap-2 text-center"><div><p className="text-xs text-muted-foreground">{t('leaves.accrued')}</p><b>{selectedBalance.accrued.toFixed(1)}</b></div><div><p className="text-xs text-muted-foreground">{t('leaves.used')}</p><b>{selectedBalance.used.toFixed(1)}</b></div><div><p className="text-xs text-muted-foreground">{t('leaves.remaining')}</p><b>{selectedBalance.balance.toFixed(1)}</b></div></div>
              {selectedBalance.balance < selectedRequest.total_days && approveAction === 'approve' && <div className="mt-2"><p className="text-xs text-rose-500">{t('leaves.insufficientBalance', { count: selectedRequest.total_days })}</p><label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={adminOverride} onChange={(event) => setAdminOverride(event.target.checked)} />{t('leaves.adminOverride')}</label></div>}
            </div>}
            <div className="space-y-2"><Label>{t(approveAction === 'reject' ? 'leaves.rejectionReason' : 'leaves.optionalNotes')}</Label><Textarea value={approvalNote} onChange={(event) => setApprovalNote(event.target.value)} placeholder={t('leaves.notesPlaceholder')} /></div>
          </div>}
          <DialogFooter><Button variant="outline" onClick={closeApprovalDialog}>{t('common.cancel')}</Button><Button variant={approveAction === 'reject' ? 'destructive' : 'default'} onClick={confirmApproval} disabled={isPending || (approveAction === 'reject' && !approvalNote.trim()) || (approveAction === 'approve' && Boolean(selectedBalance && selectedBalance.balance < (selectedRequest?.total_days ?? 0) && !adminOverride))}>{isPending ? t(approveAction === 'reject' ? 'leaves.rejecting' : 'leaves.approving') : t(approveAction === 'reject' ? 'common.reject' : 'common.approve')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showNewRequestDialog} onOpenChange={setShowNewRequestDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{t('leaves.newTitle')}</DialogTitle><DialogDescription>{t('leaves.newDescription')}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2"><Label>{t('common.employee')} *</Label><Select value={newForm.employee_id} onValueChange={(value) => setNewForm((form) => ({ ...form, employee_id: value }))}><SelectTrigger><SelectValue placeholder={t('leaves.selectEmployee')} /></SelectTrigger><SelectContent>{employees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-2"><Label>{t('leaves.leaveType')} *</Label><Select value={newForm.leave_type_id} onValueChange={(value) => setNewForm((form) => ({ ...form, leave_type_id: value }))}><SelectTrigger><SelectValue placeholder={t('leaves.selectLeaveType')} /></SelectTrigger><SelectContent>{leaveTypes.map((leaveType) => <SelectItem key={leaveType.id} value={leaveType.id}>{leaveTypeName(leaveType)}{leaveType.max_days_per_year ? ` (${t('leaves.upToDays', { count: leaveType.max_days_per_year })})` : ''}</SelectItem>)}</SelectContent></Select></div>
            <div className="grid grid-cols-2 gap-3"><div className="space-y-2"><Label>{t('leaves.startDate')}</Label><Input type="date" value={newForm.start_date} onChange={(event) => setNewForm((form) => ({ ...form, start_date: event.target.value }))} /></div><div className="space-y-2"><Label>{t('leaves.endDate')}</Label><Input type="date" value={newForm.end_date} onChange={(event) => setNewForm((form) => ({ ...form, end_date: event.target.value }))} /></div></div>
            <div className="space-y-2"><Label>{t('leaves.reason')}</Label><Textarea value={newForm.reason} onChange={(event) => setNewForm((form) => ({ ...form, reason: event.target.value }))} placeholder={t('leaves.reasonPlaceholder')} /></div>
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setShowNewRequestDialog(false)}>{t('common.cancel')}</Button><Button onClick={() => createMutation.mutate()} disabled={!newForm.employee_id || !newForm.leave_type_id || !newForm.start_date || !newForm.end_date || isPending}>{isPending ? t('leaves.submitting') : t('leaves.submit')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
