// src/features/hr/pages/LeavesPage.tsx
// بسم الله الرحمن الرحيم
// صفحة إدارة الإجازات مع سير عمل الموافقات

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
} from '@/services/hr/leave-service';
import { STATUS_BADGES } from '../types';

export const LeavesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewRequestDialog, setShowNewRequestDialog] = useState(false);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [approveAction, setApproveAction] = useState<'approve' | 'reject'>('approve');
  const [selectedRequest, setSelectedRequest] = useState<LeaveRequestRow | null>(null);
  const [approvalNote, setApprovalNote] = useState('');
  const [adminOverride, setAdminOverride] = useState(false);

  // نموذج الطلب الجديد
  const [newForm, setNewForm] = useState({
    employee_id: '',
    leave_type_id: '',
    start_date: '',
    end_date: '',
    reason: '',
  });

  // بيانات
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

  // رصيد الإجازة للطلب المحدد
  const { data: selectedBalance } = useQuery({
    queryKey: ['hr', 'leave-balance', selectedRequest?.employee_id],
    queryFn: () => getLeaveBalance(selectedRequest!.employee_id),
    enabled: !!selectedRequest?.employee_id,
  });

  // تصفية
  const filteredRequests = React.useMemo(() => {
    return leaveRequests.filter((req) => {
      const matchesTab = activeTab === 'all' || req.status === activeTab;
      const empName =
        (Array.isArray(req.employee) ? req.employee[0] : req.employee)?.full_name ?? '';
      const matchesSearch =
        !searchQuery || empName.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesTab && matchesSearch;
    });
  }, [leaveRequests, activeTab, searchQuery]);

  const leaveStats = React.useMemo(
    () => ({
      pending: leaveRequests.filter((r) => r.status === 'pending').length,
      approved: leaveRequests.filter((r) => r.status === 'approved').length,
      rejected: leaveRequests.filter((r) => r.status === 'rejected').length,
      total: leaveRequests.length,
    }),
    [leaveRequests],
  );

  // ── Mutations ─────────────────────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: ({ id, override }: { id: string; override: boolean }) =>
      approveLeaveRequest(id, override),
    onSuccess: () => {
      toast.success('تمت الموافقة على الإجازة وتحديث الحضور');
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-requests'] });
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-balance'] });
      closeApprovalDialog();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: string; notes: string }) =>
      rejectLeaveRequest(id, notes),
    onSuccess: () => {
      toast.success('تم رفض طلب الإجازة');
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-requests'] });
      closeApprovalDialog();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const createMutation = useMutation({
    mutationFn: () => createLeaveRequest(newForm),
    onSuccess: () => {
      toast.success('تم تقديم طلب الإجازة');
      queryClient.invalidateQueries({ queryKey: ['hr', 'leave-requests'] });
      setShowNewRequestDialog(false);
      setNewForm({ employee_id: '', leave_type_id: '', start_date: '', end_date: '', reason: '' });
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // ── Handlers ──────────────────────────────────────────────────────────────

  function openApprovalDialog(req: LeaveRequestRow, action: 'approve' | 'reject') {
    setSelectedRequest(req);
    setApproveAction(action);
    setApprovalNote('');
    setAdminOverride(false);
    setShowApprovalDialog(true);
  }

  function closeApprovalDialog() {
    setShowApprovalDialog(false);
    setSelectedRequest(null);
    setApprovalNote('');
    setAdminOverride(false);
  }

  function handleConfirm() {
    if (!selectedRequest) return;
    if (approveAction === 'approve') {
      approveMutation.mutate({ id: selectedRequest.id, override: adminOverride });
    } else {
      rejectMutation.mutate({ id: selectedRequest.id, notes: approvalNote });
    }
  }

  const isPending =
    approveMutation.isPending || rejectMutation.isPending || createMutation.isPending;

  return (
    <div className="space-y-6">
      {/* العنوان */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">إدارة الإجازات</h1>
        <p className="text-muted-foreground">
          إدارة طلبات الإجازات والموافقات وأرصدة الإجازات للموظفين
        </p>
      </div>

      {/* إحصائيات */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-amber-400">طلبات معلقة</p>
                <p className="text-2xl font-bold text-amber-300">{leaveStats.pending}</p>
              </div>
              <AlertCircle className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/30 bg-emerald-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-emerald-400">تمت الموافقة</p>
                <p className="text-2xl font-bold text-emerald-300">{leaveStats.approved}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-rose-500/30 bg-rose-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-rose-400">مرفوضة</p>
                <p className="text-2xl font-bold text-rose-300">{leaveStats.rejected}</p>
              </div>
              <XCircle className="h-8 w-8 text-rose-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30 bg-blue-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-400">إجمالي الطلبات</p>
                <p className="text-2xl font-bold text-blue-300">{leaveStats.total}</p>
              </div>
              <CalendarDays className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* قائمة الطلبات */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">طلبات الإجازات</CardTitle>
            <CardDescription>إدارة ومراجعة طلبات الإجازات</CardDescription>
          </div>
          <Button onClick={() => setShowNewRequestDialog(true)}>
            <Plus className="h-4 w-4 ml-2" />
            طلب جديد
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="relative max-w-sm">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
            />
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="pending" className="gap-2">
                <AlertCircle className="h-4 w-4" />
                معلقة ({leaveStats.pending})
              </TabsTrigger>
              <TabsTrigger value="approved" className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                موافق عليها
              </TabsTrigger>
              <TabsTrigger value="rejected" className="gap-2">
                <XCircle className="h-4 w-4" />
                مرفوضة
              </TabsTrigger>
              <TabsTrigger value="all">الكل</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
              ) : filteredRequests.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  لا توجد طلبات إجازات
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظف</TableHead>
                      <TableHead>نوع الإجازة</TableHead>
                      <TableHead>من</TableHead>
                      <TableHead>إلى</TableHead>
                      <TableHead>المدة</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredRequests.map((request) => {
                      const emp = Array.isArray(request.employee)
                        ? request.employee[0]
                        : request.employee;
                      const lt = Array.isArray(request.leave_type)
                        ? request.leave_type[0]
                        : request.leave_type;
                      return (
                        <TableRow key={request.id}>
                          <TableCell>
                            <p className="font-medium">{emp?.full_name ?? '—'}</p>
                          </TableCell>
                          <TableCell>{lt?.name_ar ?? lt?.name ?? '—'}</TableCell>
                          <TableCell dir="ltr">{request.start_date}</TableCell>
                          <TableCell dir="ltr">{request.end_date}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{request.total_days} يوم</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                STATUS_BADGES[request.status] ||
                                'bg-slate-100 text-slate-700'
                              }
                            >
                              {request.status === 'pending' && 'معلق'}
                              {request.status === 'approved' && 'موافق عليه'}
                              {request.status === 'rejected' && 'مرفوض'}
                              {request.status === 'cancelled' && 'ملغى'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {request.status === 'pending' && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-emerald-600 hover:bg-emerald-50"
                                  onClick={() => openApprovalDialog(request, 'approve')}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-rose-600 hover:bg-rose-50"
                                  onClick={() => openApprovalDialog(request, 'reject')}
                                >
                                  <XCircle className="h-4 w-4" />
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ── نافذة الموافقة/الرفض ── */}
      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {approveAction === 'approve' ? 'الموافقة على الإجازة' : 'رفض طلب الإجازة'}
            </DialogTitle>
            <DialogDescription>
              {approveAction === 'approve'
                ? 'سيتم تحديث سجل الحضور آلياً عند الموافقة'
                : 'يرجى إدخال سبب الرفض'}
            </DialogDescription>
          </DialogHeader>

          {selectedRequest && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الموظف:</span>
                  <span className="font-medium">
                    {(Array.isArray(selectedRequest.employee)
                      ? selectedRequest.employee[0]
                      : selectedRequest.employee
                    )?.full_name ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">نوع الإجازة:</span>
                  <span>
                    {(Array.isArray(selectedRequest.leave_type)
                      ? selectedRequest.leave_type[0]
                      : selectedRequest.leave_type
                    )?.name_ar ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الفترة:</span>
                  <span dir="ltr">
                    {selectedRequest.start_date} → {selectedRequest.end_date}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">المدة:</span>
                  <span>{selectedRequest.total_days} يوم</span>
                </div>
              </div>

              {/* رصيد الإجازة */}
              {selectedBalance && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                  <p className="font-medium">رصيد الإجازة</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-muted-foreground text-xs">المكتسب</p>
                      <p className="font-mono font-bold">{selectedBalance.accrued.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">المستهلك</p>
                      <p className="font-mono font-bold">{selectedBalance.used.toFixed(1)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs">المتبقي</p>
                      <p
                        className={`font-mono font-bold ${
                          selectedBalance.balance < selectedRequest.total_days
                            ? 'text-rose-500'
                            : 'text-emerald-500'
                        }`}
                      >
                        {selectedBalance.balance.toFixed(1)}
                      </p>
                    </div>
                  </div>
                  {selectedBalance.balance < selectedRequest.total_days &&
                    approveAction === 'approve' && (
                      <div className="mt-2 space-y-2">
                        <p className="text-rose-500 text-xs">
                          الرصيد أقل من المطلوب ({selectedRequest.total_days} يوم)
                        </p>
                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                          <input
                            type="checkbox"
                            checked={adminOverride}
                            onChange={(e) => setAdminOverride(e.target.checked)}
                          />
                          تجاوز بصلاحية المشرف (تجاوز الرصيد)
                        </label>
                      </div>
                    )}
                </div>
              )}

              <div className="space-y-2">
                <Label>
                  {approveAction === 'reject' ? 'سبب الرفض (مطلوب)' : 'ملاحظات (اختياري)'}
                </Label>
                <Textarea
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  placeholder="أدخل ملاحظاتك هنا..."
                  rows={3}
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeApprovalDialog} disabled={isPending}>
              إلغاء
            </Button>
            {approveAction === 'reject' ? (
              <Button
                variant="destructive"
                onClick={handleConfirm}
                disabled={!approvalNote.trim() || isPending}
              >
                <XCircle className="h-4 w-4 ml-2" />
                {isPending ? 'جارٍ الرفض...' : 'رفض'}
              </Button>
            ) : (
              <Button
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={handleConfirm}
                disabled={
                  isPending ||
                  (!!selectedBalance &&
                    selectedBalance.balance < (selectedRequest?.total_days ?? 0) &&
                    !adminOverride)
                }
              >
                <CheckCircle2 className="h-4 w-4 ml-2" />
                {isPending ? 'جارٍ الموافقة...' : 'موافقة'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── نافذة الطلب الجديد ── */}
      <Dialog open={showNewRequestDialog} onOpenChange={setShowNewRequestDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>طلب إجازة جديد</DialogTitle>
            <DialogDescription>تقديم طلب إجازة لأحد الموظفين</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>الموظف *</Label>
              <Select
                value={newForm.employee_id}
                onValueChange={(v) => setNewForm((f) => ({ ...f, employee_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الموظف..." />
                </SelectTrigger>
                <SelectContent>
                  {employees.map((emp) => (
                    <SelectItem key={emp.id} value={emp.id}>
                      {emp.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>نوع الإجازة *</Label>
              <Select
                value={newForm.leave_type_id}
                onValueChange={(v) => setNewForm((f) => ({ ...f, leave_type_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر نوع الإجازة..." />
                </SelectTrigger>
                <SelectContent>
                  {leaveTypes.map((lt) => (
                    <SelectItem key={lt.id} value={lt.id}>
                      {lt.name_ar}
                      {lt.max_days_per_year ? ` (حتى ${lt.max_days_per_year} يوم)` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>تاريخ البداية *</Label>
                <Input
                  type="date"
                  value={newForm.start_date}
                  onChange={(e) => setNewForm((f) => ({ ...f, start_date: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <Label>تاريخ الانتهاء *</Label>
                <Input
                  type="date"
                  value={newForm.end_date}
                  onChange={(e) => setNewForm((f) => ({ ...f, end_date: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label>السبب (اختياري)</Label>
              <Textarea
                value={newForm.reason}
                onChange={(e) => setNewForm((f) => ({ ...f, reason: e.target.value }))}
                placeholder="أدخل سبب الإجازة..."
                rows={2}
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowNewRequestDialog(false)}
              disabled={isPending}
            >
              إلغاء
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !newForm.employee_id ||
                !newForm.leave_type_id ||
                !newForm.start_date ||
                !newForm.end_date ||
                isPending
              }
            >
              {isPending ? 'جارٍ التقديم...' : 'تقديم الطلب'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
