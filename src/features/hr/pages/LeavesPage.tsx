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
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Plus,
  Filter,
  Search,
  CalendarDays,
  Palmtree,
  Stethoscope,
  Baby,
  Briefcase,
  FileText,
} from 'lucide-react';
import { getLeaveRequests, getEmployees } from '@/services/hr/hr-service';
import { STATUS_BADGES } from '../types';

// أنواع الإجازات
const LEAVE_TYPES = [
  { id: 'annual', name: 'إجازة سنوية', icon: Palmtree, color: 'text-emerald-500', days: 21 },
  { id: 'sick', name: 'إجازة مرضية', icon: Stethoscope, color: 'text-rose-500', days: 30 },
  { id: 'maternity', name: 'إجازة أمومة', icon: Baby, color: 'text-pink-500', days: 70 },
  { id: 'paternity', name: 'إجازة أبوة', icon: Baby, color: 'text-blue-500', days: 3 },
  { id: 'unpaid', name: 'إجازة بدون راتب', icon: Briefcase, color: 'text-slate-500', days: 0 },
  { id: 'compassionate', name: 'إجازة عزاء', icon: FileText, color: 'text-purple-500', days: 5 },
];

export const LeavesPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('pending');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedType, setSelectedType] = useState<string>('all');
  const [showNewRequestDialog, setShowNewRequestDialog] = useState(false);
  const [showApprovalDialog, setShowApprovalDialog] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);
  const [approvalNote, setApprovalNote] = useState('');

  // جلب طلبات الإجازات
  const { data: leaveRequests = [], isLoading } = useQuery({
    queryKey: ['hr', 'leave-requests'],
    queryFn: () => getLeaveRequests(100),
  });

  // جلب قائمة الموظفين
  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
  });

  // تصفية الطلبات
  const filteredRequests = React.useMemo(() => {
    return leaveRequests.filter((req: any) => {
      const matchesTab = activeTab === 'all' || req.status === activeTab;
      const matchesSearch = !searchQuery || 
        req.employeeName?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        req.employeeId?.includes(searchQuery);
      const matchesType = selectedType === 'all' || req.leaveType === selectedType;
      return matchesTab && matchesSearch && matchesType;
    });
  }, [leaveRequests, activeTab, searchQuery, selectedType]);

  // إحصائيات الإجازات
  const leaveStats = React.useMemo(() => {
    const stats = {
      pending: leaveRequests.filter((r: any) => r.status === 'pending').length,
      approved: leaveRequests.filter((r: any) => r.status === 'approved').length,
      rejected: leaveRequests.filter((r: any) => r.status === 'rejected').length,
      total: leaveRequests.length,
    };
    return stats;
  }, [leaveRequests]);

  // الموافقة على الطلب
  const handleApprove = async () => {
    if (!selectedRequest) return;
    // TODO: Call API to approve
    toast.success(`تمت الموافقة على طلب الإجازة رقم ${selectedRequest.id}`);
    setShowApprovalDialog(false);
    setSelectedRequest(null);
    setApprovalNote('');
    queryClient.invalidateQueries({ queryKey: ['hr', 'leave-requests'] });
  };

  // رفض الطلب
  const handleReject = async () => {
    if (!selectedRequest || !approvalNote) {
      toast.error('يرجى إدخال سبب الرفض');
      return;
    }
    // TODO: Call API to reject
    toast.error(`تم رفض طلب الإجازة رقم ${selectedRequest.id}`);
    setShowApprovalDialog(false);
    setSelectedRequest(null);
    setApprovalNote('');
    queryClient.invalidateQueries({ queryKey: ['hr', 'leave-requests'] });
  };

  const getLeaveTypeInfo = (typeId: string) => {
    return LEAVE_TYPES.find(t => t.id === typeId) || LEAVE_TYPES[0];
  };

  return (
    <div className="space-y-6">
      {/* العنوان */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">إدارة الإجازات</h1>
        <p className="text-muted-foreground">
          إدارة طلبات الإجازات والموافقات وأرصدة الإجازات للموظفين
        </p>
      </div>

      {/* بطاقات الإحصائيات */}
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

      {/* أنواع الإجازات */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">أنواع الإجازات والرصيد المتاح</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
            {LEAVE_TYPES.map((type) => {
              const Icon = type.icon;
              return (
                <div
                  key={type.id}
                  className="flex items-center gap-3 rounded-lg border p-3 hover:bg-muted/50 transition-colors"
                >
                  <Icon className={`h-5 w-5 ${type.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{type.name}</p>
                    <p className="text-xs text-muted-foreground">{type.days} يوم</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

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
          {/* أدوات التصفية */}
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث بالاسم أو الرقم الوظيفي..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
              />
            </div>
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="نوع الإجازة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">جميع الأنواع</SelectItem>
                {LEAVE_TYPES.map((type) => (
                  <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* التبويبات */}
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
                    {filteredRequests.map((request: any) => {
                      const leaveType = getLeaveTypeInfo(request.leaveType);
                      const Icon = leaveType.icon;
                      const startDate = new Date(request.startDate);
                      const endDate = new Date(request.endDate);
                      const days = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

                      return (
                        <TableRow key={request.id}>
                          <TableCell>
                            <div>
                              <p className="font-medium">{request.employeeName || '—'}</p>
                              <p className="text-xs text-muted-foreground">{request.employeeId}</p>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Icon className={`h-4 w-4 ${leaveType.color}`} />
                              <span>{leaveType.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>{startDate.toLocaleDateString('ar-SA')}</TableCell>
                          <TableCell>{endDate.toLocaleDateString('ar-SA')}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{days} يوم</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className={STATUS_BADGES[request.status] || 'bg-slate-100 text-slate-700'}>
                              {request.status === 'pending' && 'معلق'}
                              {request.status === 'approved' && 'موافق عليه'}
                              {request.status === 'rejected' && 'مرفوض'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {request.status === 'pending' && (
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-emerald-600 hover:bg-emerald-50"
                                  onClick={() => {
                                    setSelectedRequest(request);
                                    setShowApprovalDialog(true);
                                  }}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="text-rose-600 hover:bg-rose-50"
                                  onClick={() => {
                                    setSelectedRequest(request);
                                    setShowApprovalDialog(true);
                                  }}
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

      {/* نافذة الموافقة/الرفض */}
      <Dialog open={showApprovalDialog} onOpenChange={setShowApprovalDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>مراجعة طلب الإجازة</DialogTitle>
            <DialogDescription>
              راجع تفاصيل الطلب واتخذ القرار المناسب
            </DialogDescription>
          </DialogHeader>
          {selectedRequest && (
            <div className="space-y-4">
              <div className="rounded-lg border p-4 space-y-2">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الموظف:</span>
                  <span className="font-medium">{selectedRequest.employeeName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">نوع الإجازة:</span>
                  <span>{getLeaveTypeInfo(selectedRequest.leaveType).name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">الفترة:</span>
                  <span dir="ltr">
                    {new Date(selectedRequest.startDate).toLocaleDateString('ar-SA')} - 
                    {new Date(selectedRequest.endDate).toLocaleDateString('ar-SA')}
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>ملاحظات (مطلوبة في حالة الرفض)</Label>
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
            <Button variant="outline" onClick={() => setShowApprovalDialog(false)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={handleReject}
              disabled={!approvalNote}
            >
              <XCircle className="h-4 w-4 ml-2" />
              رفض
            </Button>
            <Button
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={handleApprove}
            >
              <CheckCircle2 className="h-4 w-4 ml-2" />
              موافقة
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

