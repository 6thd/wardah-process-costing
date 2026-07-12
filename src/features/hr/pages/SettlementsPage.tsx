// src/features/hr/pages/SettlementsPage.tsx
// بسم الله الرحمن الرحيم
// صفحة تسويات نهاية الخدمة

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
  Calculator,
  FileText,
  DollarSign,
  Plus,
  Search,
  CheckCircle2,
  Clock,
  Briefcase,
  AlertTriangle,
} from 'lucide-react';
import { getEmployees } from '@/services/hr/hr-service';
import {
  listSettlements,
  createSettlement,
  postSettlement,
  cancelSettlement,
  type SettlementRow,
  type TerminationType,
  type EosResult,
} from '@/services/hr/settlement-service';
import { checkIsPayrollAdmin } from '@/services/hr/payroll-admin-service';
import { STATUS_BADGES } from '../types';

const TERMINATION_TYPES: { id: TerminationType; name: string; color: string }[] = [
  { id: 'resignation', name: 'استقالة', color: 'text-blue-500' },
  { id: 'end_of_contract', name: 'انتهاء العقد', color: 'text-slate-500' },
  { id: 'termination_without_cause', name: 'فصل بدون سبب (م77)', color: 'text-rose-500' },
  { id: 'termination_for_cause', name: 'فصل بسبب مشروع (م80)', color: 'text-rose-700' },
  { id: 'mutual_agreement', name: 'اتفاق مشترك', color: 'text-teal-500' },
  { id: 'retirement', name: 'تقاعد', color: 'text-amber-500' },
  { id: 'death', name: 'وفاة', color: 'text-purple-500' },
];

export const SettlementsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('draft');
  const [searchQuery, setSearchQuery] = useState('');
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);
  const [selectedSettlement, setSelectedSettlement] = useState<SettlementRow | null>(null);
  const [previewResult, setPreviewResult] = useState<EosResult | null>(null);

  const [newForm, setNewForm] = useState({
    employee_id: '',
    termination_type: '' as TerminationType | '',
    service_end: '',
    notes: '',
  });

  // بيانات
  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ['hr', 'settlements'],
    queryFn: () => listSettlements(200),
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
  });

  // بوابة عرض فقط — الحاجز الفعلي wardah_is_org_admin في RPC (Migration 101)
  const { data: isPayrollAdmin = false } = useQuery({
    queryKey: ['hr', 'payroll-admin-gate'],
    queryFn: checkIsPayrollAdmin,
  });

  // تصفية
  const filteredSettlements = React.useMemo(() => {
    return settlements.filter((s) => {
      const matchesTab = activeTab === 'all' || s.status === activeTab;
      const emp = Array.isArray(s.employee) ? s.employee[0] : s.employee;
      const matchesSearch =
        !searchQuery ||
        (emp?.full_name ?? '').toLowerCase().includes(searchQuery.toLowerCase());
      return matchesTab && matchesSearch;
    });
  }, [settlements, activeTab, searchQuery]);

  const stats = React.useMemo(
    () => ({
      draft: settlements.filter((s) => s.status === 'draft').length,
      approved: settlements.filter((s) => s.status === 'approved').length,
      paid: settlements.filter((s) => s.status === 'paid').length,
      total: settlements.length,
      totalAmount: settlements.reduce((sum, s) => sum + (s.payable_amount ?? 0), 0),
    }),
    [settlements],
  );

  // ── Mutations ──────────────────────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () =>
      createSettlement({
        employee_id: newForm.employee_id,
        termination_type: newForm.termination_type as TerminationType,
        service_end: newForm.service_end,
        notes: newForm.notes || undefined,
      }),
    onSuccess: ({ settlement, result }) => {
      setPreviewResult(result);
      setSelectedSettlement(settlement);
      setShowNewDialog(false);
      setShowDetailsDialog(true);
      queryClient.invalidateQueries({ queryKey: ['hr', 'settlements'] });
      toast.success('تم إنشاء التسوية — راجع التفاصيل قبل الاعتماد');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const postMutation = useMutation({
    mutationFn: (settlementId: string) => postSettlement(settlementId),
    onSuccess: () => {
      toast.success('تم اعتماد التسوية وترحيل القيد المحاسبي');
      queryClient.invalidateQueries({ queryKey: ['hr', 'settlements'] });
      setShowDetailsDialog(false);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (settlementId: string) => cancelSettlement(settlementId),
    onSuccess: () => {
      toast.success('تم إلغاء التسوية');
      queryClient.invalidateQueries({ queryKey: ['hr', 'settlements'] });
      setShowDetailsDialog(false);
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  const isPending = createMutation.isPending || postMutation.isPending || cancelMutation.isPending;

  function openDetails(s: SettlementRow) {
    setSelectedSettlement(s);
    setPreviewResult(null);
    setShowDetailsDialog(true);
  }

  const getTermType = (id: string) =>
    TERMINATION_TYPES.find((t) => t.id === id) ?? TERMINATION_TYPES[0];

  return (
    <div className="space-y-6">
      {/* العنوان */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">تسويات نهاية الخدمة</h1>
        <p className="text-muted-foreground">
          حساب واعتماد مكافآت نهاية الخدمة وفق نظام العمل السعودي (م109/م77/م80)
        </p>
      </div>

      {/* إحصائيات */}
      <div className="grid gap-4 md:grid-cols-5">
        <Card className="border-amber-500/30 bg-amber-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-amber-400">مسودة</p>
                <p className="text-2xl font-bold text-amber-300">{stats.draft}</p>
              </div>
              <Clock className="h-8 w-8 text-amber-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-blue-500/30 bg-blue-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-400">معتمدة</p>
                <p className="text-2xl font-bold text-blue-300">{stats.approved}</p>
              </div>
              <CheckCircle2 className="h-8 w-8 text-blue-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-emerald-500/30 bg-emerald-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-emerald-400">مدفوعة</p>
                <p className="text-2xl font-bold text-emerald-300">{stats.paid}</p>
              </div>
              <DollarSign className="h-8 w-8 text-emerald-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-500/30 bg-slate-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-400">الإجمالي</p>
                <p className="text-2xl font-bold text-slate-300">{stats.total}</p>
              </div>
              <Briefcase className="h-8 w-8 text-slate-500" />
            </div>
          </CardContent>
        </Card>
        <Card className="border-purple-500/30 bg-purple-500/10">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-purple-400">إجمالي المبالغ</p>
                <p className="text-xl font-bold text-purple-300">
                  {stats.totalAmount.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر.س
                </p>
              </div>
              <Calculator className="h-8 w-8 text-purple-500" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* قائمة التسويات */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-lg">سجل التسويات</CardTitle>
            <CardDescription>جميع تسويات نهاية الخدمة</CardDescription>
          </div>
          <Button onClick={() => setShowNewDialog(true)}>
            <Plus className="h-4 w-4 ml-2" />
            تسوية جديدة
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
              <TabsTrigger value="draft">مسودة ({stats.draft})</TabsTrigger>
              <TabsTrigger value="approved">معتمدة</TabsTrigger>
              <TabsTrigger value="paid">مدفوعة</TabsTrigger>
              <TabsTrigger value="all">الكل</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="mt-4">
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
              ) : filteredSettlements.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Briefcase className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                  <p>لا توجد تسويات</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظف</TableHead>
                      <TableHead>سبب الإنهاء</TableHead>
                      <TableHead>تاريخ الإنهاء</TableHead>
                      <TableHead>سنوات الخدمة</TableHead>
                      <TableHead>المبلغ المستحق</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredSettlements.map((s) => {
                      const emp = Array.isArray(s.employee) ? s.employee[0] : s.employee;
                      const tt = getTermType(s.settlement_type);
                      const years = s.service_days
                        ? (s.service_days / 365.25).toFixed(1)
                        : '—';
                      return (
                        <TableRow key={s.id}>
                          <TableCell>
                            <p className="font-medium">{emp?.full_name ?? '—'}</p>
                          </TableCell>
                          <TableCell>
                            <span className={tt.color}>{tt.name}</span>
                          </TableCell>
                          <TableCell dir="ltr">{s.service_end ?? '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{years} سنة</Badge>
                          </TableCell>
                          <TableCell className="font-semibold">
                            {s.payable_amount.toLocaleString('ar-SA', {
                              maximumFractionDigits: 0,
                            })}{' '}
                            ر.س
                          </TableCell>
                          <TableCell>
                            <Badge
                              className={
                                STATUS_BADGES[s.status] || 'bg-slate-100 text-slate-700'
                              }
                            >
                              {s.status === 'draft' && 'مسودة'}
                              {s.status === 'review' && 'مراجعة'}
                              {s.status === 'approved' && 'معتمدة'}
                              {s.status === 'paid' && 'مدفوعة'}
                              {s.status === 'rejected' && 'ملغاة'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDetails(s)}
                            >
                              <FileText className="h-4 w-4" />
                            </Button>
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

      {/* ── نافذة تسوية جديدة ── */}
      <Dialog open={showNewDialog} onOpenChange={setShowNewDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>إنشاء تسوية نهاية خدمة</DialogTitle>
            <DialogDescription>
              سيتم حساب المكافأة تلقائياً من مكوّنات راتب الموظف وسنوات خدمته
            </DialogDescription>
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
              <Label>سبب إنهاء الخدمة *</Label>
              <Select
                value={newForm.termination_type}
                onValueChange={(v) =>
                  setNewForm((f) => ({ ...f, termination_type: v as TerminationType }))
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر السبب..." />
                </SelectTrigger>
                <SelectContent>
                  {TERMINATION_TYPES.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {newForm.termination_type === 'termination_for_cause' && (
                <div className="flex items-center gap-2 text-rose-500 text-sm">
                  <AlertTriangle className="h-4 w-4" />
                  م80: لا يستحق الموظف مكافأة نهاية الخدمة
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label>تاريخ الإنهاء *</Label>
              <Input
                type="date"
                value={newForm.service_end}
                onChange={(e) => setNewForm((f) => ({ ...f, service_end: e.target.value }))}
              />
            </div>

            <div className="space-y-2">
              <Label>ملاحظات</Label>
              <Input
                placeholder="ملاحظات إضافية..."
                value={newForm.notes}
                onChange={(e) => setNewForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowNewDialog(false)}
              disabled={isPending}
            >
              إلغاء
            </Button>
            <Button
              className="bg-teal-600 hover:bg-teal-700"
              onClick={() => createMutation.mutate()}
              disabled={
                !newForm.employee_id ||
                !newForm.termination_type ||
                !newForm.service_end ||
                isPending
              }
            >
              <Calculator className="h-4 w-4 ml-2" />
              {isPending ? 'جارٍ الحساب...' : 'احسب وأنشئ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── نافذة تفاصيل التسوية ── */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>تفاصيل التسوية</DialogTitle>
            <DialogDescription>
              مكافأة نهاية الخدمة والمستحقات المحسوبة وفق نظام العمل السعودي
            </DialogDescription>
          </DialogHeader>

          {selectedSettlement && (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2 text-sm">
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-semibold text-muted-foreground">بيانات الخدمة</h4>
                  <div className="flex justify-between">
                    <span>سبب الإنهاء:</span>
                    <span className="font-medium">
                      {getTermType(selectedSettlement.settlement_type).name}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>بداية الخدمة:</span>
                    <span dir="ltr">{selectedSettlement.service_start ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>نهاية الخدمة:</span>
                    <span dir="ltr">{selectedSettlement.service_end ?? '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>سنوات الخدمة:</span>
                    <span className="font-medium">
                      {selectedSettlement.service_days
                        ? (selectedSettlement.service_days / 365.25).toFixed(2)
                        : '—'}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg border p-4 space-y-2">
                  <h4 className="font-semibold text-muted-foreground">ملخص المستحقات</h4>
                  {previewResult ? (
                    <>
                      {previewResult.eos_amount > 0 && (
                        <div className="flex justify-between">
                          <span>مكافأة نهاية الخدمة:</span>
                          <span>{previewResult.eos_amount.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر.س</span>
                        </div>
                      )}
                      {previewResult.leave_encashment > 0 && (
                        <div className="flex justify-between">
                          <span>رصيد الإجازات:</span>
                          <span>{previewResult.leave_encashment.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر.س</span>
                        </div>
                      )}
                      {previewResult.art77_compensation > 0 && (
                        <div className="flex justify-between text-rose-400">
                          <span>تعويض م77:</span>
                          <span>{previewResult.art77_compensation.toLocaleString('ar-SA', { maximumFractionDigits: 0 })} ر.س</span>
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="text-muted-foreground text-xs">
                      لمزيد من التفاصيل أنشئ تسوية جديدة
                    </div>
                  )}
                </div>
              </div>

              <div className="rounded-lg bg-teal-500/10 border border-teal-500/30 p-4">
                <div className="flex justify-between items-center">
                  <span className="font-semibold text-teal-300">إجمالي التسوية:</span>
                  <span className="text-2xl font-bold text-teal-400">
                    {selectedSettlement.payable_amount.toLocaleString('ar-SA', {
                      maximumFractionDigits: 0,
                    })}{' '}
                    ر.س
                  </span>
                </div>
              </div>

              {selectedSettlement.status === 'draft' && (
                <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 text-sm text-amber-300">
                  الاعتماد يُنشئ قيداً محاسبياً ذرّياً ويقلب حالة الموظف إلى &laquo;منتهية&raquo;.
                  لا يمكن التراجع عنه.
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setShowDetailsDialog(false)}
              disabled={isPending}
            >
              إغلاق
            </Button>
            {selectedSettlement?.status === 'draft' && (
              <>
                <Button
                  variant="outline"
                  className="text-rose-600"
                  onClick={() => cancelMutation.mutate(selectedSettlement.id)}
                  disabled={isPending}
                >
                  إلغاء التسوية
                </Button>
                <Button
                  className="bg-teal-600 hover:bg-teal-700"
                  onClick={() => postMutation.mutate(selectedSettlement.id)}
                  disabled={isPending || !isPayrollAdmin}
                  title={!isPayrollAdmin ? 'اعتماد التسوية يتطلب صلاحية مدير المؤسسة (admin/owner)' : undefined}
                >
                  <CheckCircle2 className="h-4 w-4 ml-2" />
                  {isPending ? 'جارٍ الاعتماد...' : 'اعتماد وترحيل القيد'}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
