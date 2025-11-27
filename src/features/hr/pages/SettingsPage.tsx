// src/features/hr/pages/SettingsPage.tsx
// بسم الله الرحمن الرحيم
// صفحة إعدادات الموارد البشرية

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  Settings,
  Calendar,
  DollarSign,
  Clock,
  Building2,
  Users,
  Briefcase,
  Plus,
  Edit2,
  Trash2,
  Save,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Palmtree,
  Calculator,
} from 'lucide-react';
import { getHrPolicies, updateHrPolicies, HrPolicies } from '@/services/hr/policies-service';
import {
  getPayrollAccountMappings,
  listPostingAccounts,
  upsertPayrollAccountMapping,
  PayrollAccountType,
} from '@/services/hr/payroll-account-service';

// أنواع حسابات الرواتب
const PAYROLL_ACCOUNT_TYPES: { value: PayrollAccountType; label: string }[] = [
  { value: 'basic_salary', label: 'الراتب الأساسي' },
  { value: 'housing_allowance', label: 'بدل السكن' },
  { value: 'transport_allowance', label: 'بدل النقل' },
  { value: 'other_allowance', label: 'بدلات أخرى' },
  { value: 'deductions', label: 'الخصومات' },
  { value: 'loans', label: 'السلف' },
  { value: 'payable', label: 'رواتب مستحقة' },
  { value: 'net_payable', label: 'صافي الدفع' },
];

export const SettingsPage: React.FC = () => {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('policies');
  const [showAccountDialog, setShowAccountDialog] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState<any>(null);

  // جلب السياسات
  const { data: policies, isLoading: policiesLoading } = useQuery({
    queryKey: ['hr', 'policies'],
    queryFn: getHrPolicies,
  });

  // جلب ربط الحسابات
  const { data: accountMappings = [], isLoading: mappingsLoading } = useQuery({
    queryKey: ['hr', 'payroll-account-mappings'],
    queryFn: getPayrollAccountMappings,
  });

  // جلب قائمة الحسابات المتاحة
  const { data: availableAccounts = [] } = useQuery({
    queryKey: ['hr', 'posting-accounts'],
    queryFn: listPostingAccounts,
  });

  // حالة تحرير السياسات
  const [editedPolicies, setEditedPolicies] = useState<Partial<HrPolicies>>({});

  // حفظ السياسات
  const updatePoliciesMutation = useMutation({
    mutationFn: (data: Partial<HrPolicies>) => updateHrPolicies(data),
    onSuccess: () => {
      toast.success('تم حفظ السياسات بنجاح');
      queryClient.invalidateQueries({ queryKey: ['hr', 'policies'] });
    },
    onError: () => {
      toast.error('حدث خطأ أثناء حفظ السياسات');
    },
  });

  // حفظ ربط الحساب
  const upsertMappingMutation = useMutation({
    mutationFn: (data: { accountType: PayrollAccountType; glAccountId: string }) =>
      upsertPayrollAccountMapping(data.accountType, data.glAccountId),
    onSuccess: () => {
      toast.success('تم حفظ ربط الحساب بنجاح');
      queryClient.invalidateQueries({ queryKey: ['hr', 'payroll-account-mappings'] });
      setShowAccountDialog(false);
    },
    onError: () => {
      toast.error('حدث خطأ أثناء حفظ ربط الحساب');
    },
  });

  const handlePolicyChange = (key: keyof HrPolicies, value: any) => {
    setEditedPolicies(prev => ({ ...prev, [key]: value }));
  };

  const handleSavePolicies = () => {
    updatePoliciesMutation.mutate(editedPolicies);
  };

  const currentPolicies = { ...policies, ...editedPolicies };

  return (
    <div className="space-y-6">
      {/* العنوان */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">إعدادات الموارد البشرية</h1>
        <p className="text-muted-foreground">
          إدارة سياسات الحضور والإجازات وربط حسابات الرواتب
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="policies" className="gap-2">
            <Settings className="h-4 w-4" />
            السياسات العامة
          </TabsTrigger>
          <TabsTrigger value="leave" className="gap-2">
            <Palmtree className="h-4 w-4" />
            سياسات الإجازات
          </TabsTrigger>
          <TabsTrigger value="attendance" className="gap-2">
            <Clock className="h-4 w-4" />
            سياسات الحضور
          </TabsTrigger>
          <TabsTrigger value="accounts" className="gap-2">
            <Calculator className="h-4 w-4" />
            ربط الحسابات
          </TabsTrigger>
        </TabsList>

        {/* السياسات العامة */}
        <TabsContent value="policies" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5 text-teal-600" />
                إعدادات عامة
              </CardTitle>
              <CardDescription>
                الإعدادات الأساسية لنظام الموارد البشرية
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>ساعات العمل اليومية (موظفون)</Label>
                  <Input
                    type="number"
                    value={currentPolicies?.employee_daily_hours || 8}
                    onChange={(e) => handlePolicyChange('employee_daily_hours', Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    ساعات العمل للموظفين الإداريين
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>ساعات العمل اليومية (عمال)</Label>
                  <Input
                    type="number"
                    value={currentPolicies?.worker_daily_hours || 11}
                    onChange={(e) => handlePolicyChange('worker_daily_hours', Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    ساعات العمل للعمال في المصنع
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>عدد الورديات (عمال)</Label>
                  <Input
                    type="number"
                    value={currentPolicies?.worker_shifts || 2}
                    onChange={(e) => handlePolicyChange('worker_shifts', Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label>معامل العمل الإضافي</Label>
                  <Select
                    value={String(currentPolicies?.overtime_multiplier || 1.5)}
                    onValueChange={(v) => handlePolicyChange('overtime_multiplier', Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1.25">1.25x</SelectItem>
                      <SelectItem value="1.5">1.5x</SelectItem>
                      <SelectItem value="2">2x</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSavePolicies}
                  disabled={updatePoliciesMutation.isPending}
                  className="bg-teal-600 hover:bg-teal-700"
                >
                  {updatePoliciesMutation.isPending ? (
                    <RefreshCw className="h-4 w-4 ml-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 ml-2" />
                  )}
                  حفظ الإعدادات
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* سياسات الإجازات */}
        <TabsContent value="leave" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Palmtree className="h-5 w-5 text-emerald-600" />
                سياسات الإجازات
              </CardTitle>
              <CardDescription>
                تكوين أنواع الإجازات وأرصدتها السنوية
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-amber-400">إعدادات الإجازات</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      سياسات الإجازات يتم إدارتها من خلال جدول leave_types في قاعدة البيانات.
                      يمكنك إضافة أنواع جديدة أو تعديل الأنواع الموجودة مباشرة من قاعدة البيانات.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <Card className="border-emerald-500/30">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-emerald-400">الإجازة السنوية</p>
                      <p className="text-2xl font-bold">21 يوم</p>
                      <p className="text-xs text-muted-foreground">
                        وفقاً لنظام العمل السعودي
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-rose-500/30">
                  <CardContent className="p-4">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-rose-400">الإجازة المرضية</p>
                      <p className="text-2xl font-bold">30 يوم</p>
                      <p className="text-xs text-muted-foreground">
                        بموجب تقرير طبي
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSavePolicies}
                  disabled={updatePoliciesMutation.isPending}
                  className="bg-teal-600 hover:bg-teal-700"
                >
                  <Save className="h-4 w-4 ml-2" />
                  حفظ سياسات الإجازات
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* سياسات الحضور */}
        <TabsContent value="attendance" className="space-y-4 mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-blue-600" />
                سياسات الحضور والانصراف
              </CardTitle>
              <CardDescription>
                إعدادات أوقات العمل والعمل الإضافي
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>فترة السماح للعمل الإضافي (دقائق)</Label>
                  <Input
                    type="number"
                    value={currentPolicies?.overtime_grace_minutes || 0}
                    onChange={(e) => handlePolicyChange('overtime_grace_minutes', Number(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    الحد الأدنى للدقائق الإضافية لاحتساب العمل الإضافي
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>معامل العمل الإضافي</Label>
                  <Select
                    value={String(currentPolicies?.overtime_multiplier || 1.5)}
                    onValueChange={(v) => handlePolicyChange('overtime_multiplier', Number(v))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1.25">1.25x</SelectItem>
                      <SelectItem value="1.5">1.5x</SelectItem>
                      <SelectItem value="2">2x</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="rounded-lg border border-blue-500/30 p-4 space-y-3">
                <h4 className="font-medium text-blue-400">أيام نهاية الأسبوع</h4>
                <div className="flex flex-wrap gap-2">
                  {['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day, idx) => {
                    const dayKey = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][idx];
                    const isWeekend = currentPolicies?.weekend_days?.includes(dayKey);
                    return (
                      <Badge 
                        key={day}
                        variant={isWeekend ? 'default' : 'outline'}
                        className={isWeekend ? 'bg-blue-500/20 text-blue-400' : ''}
                      >
                        {day}
                      </Badge>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  الأيام المحددة: {currentPolicies?.weekend_days?.join(', ') || 'لا يوجد'}
                </p>
              </div>

              <div className="flex justify-end">
                <Button
                  onClick={handleSavePolicies}
                  disabled={updatePoliciesMutation.isPending}
                  className="bg-teal-600 hover:bg-teal-700"
                >
                  <Save className="h-4 w-4 ml-2" />
                  حفظ سياسات الحضور
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ربط الحسابات */}
        <TabsContent value="accounts" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5 text-purple-600" />
                  ربط حسابات الرواتب
                </CardTitle>
                <CardDescription>
                  ربط عناصر الرواتب بحسابات الأستاذ العام للقيود المحاسبية
                </CardDescription>
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setSelectedAccount(null);
                  setShowAccountDialog(true);
                }}
              >
                <Plus className="h-4 w-4 ml-2" />
                إضافة ربط
              </Button>
            </CardHeader>
            <CardContent>
              {mappingsLoading ? (
                <div className="text-center py-8 text-muted-foreground">جارٍ التحميل...</div>
              ) : accountMappings.length === 0 ? (
                <div className="text-center py-8">
                  <AlertCircle className="h-12 w-12 mx-auto text-amber-400 mb-3" />
                  <p className="text-muted-foreground">لم يتم ربط أي حسابات بعد</p>
                  <p className="text-sm text-muted-foreground">
                    قم بربط الحسابات لتفعيل القيود المحاسبية التلقائية للرواتب
                  </p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>نوع الحساب</TableHead>
                      <TableHead>الحساب المرتبط</TableHead>
                      <TableHead>رقم الحساب</TableHead>
                      <TableHead>الحالة</TableHead>
                      <TableHead>الإجراءات</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {accountMappings.map((mapping: any) => {
                      const typeInfo = PAYROLL_ACCOUNT_TYPES.find(t => t.value === mapping.accountType);
                      return (
                        <TableRow key={mapping.id}>
                          <TableCell className="font-medium">
                            {typeInfo?.label || mapping.accountType}
                          </TableCell>
                          <TableCell>{mapping.glAccountName || '—'}</TableCell>
                          <TableCell>
                            <Badge variant="outline">{mapping.glAccountCode}</Badge>
                          </TableCell>
                          <TableCell>
                            <Badge className="bg-emerald-100 text-emerald-700">
                              <CheckCircle2 className="h-3 w-3 ml-1" />
                              مرتبط
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                  setSelectedAccount(mapping);
                                  setShowAccountDialog(true);
                                }}
                              >
                                <Edit2 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-600"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}

              {/* قائمة الحسابات المطلوب ربطها */}
              <div className="mt-6 rounded-lg border p-4">
                <h4 className="font-medium mb-3">الحسابات المطلوب ربطها</h4>
                <div className="grid gap-2 md:grid-cols-2">
                  {PAYROLL_ACCOUNT_TYPES.map((type) => {
                    const isMapped = accountMappings.some((m: any) => m.accountType === type.value);
                    return (
                      <div
                        key={type.value}
                        className={`flex items-center justify-between rounded-lg border p-3 ${
                          isMapped ? 'bg-emerald-50 border-emerald-200' : 'bg-amber-50 border-amber-200'
                        }`}
                      >
                        <span className="text-sm">{type.label}</span>
                        {isMapped ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-amber-600" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* نافذة ربط الحساب */}
      <Dialog open={showAccountDialog} onOpenChange={setShowAccountDialog}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedAccount ? 'تعديل ربط الحساب' : 'إضافة ربط حساب جديد'}
            </DialogTitle>
            <DialogDescription>
              اختر نوع الحساب وحساب الأستاذ العام المقابل
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>نوع الحساب</Label>
              <Select defaultValue={selectedAccount?.accountType}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر نوع الحساب" />
                </SelectTrigger>
                <SelectContent>
                  {PAYROLL_ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>حساب الأستاذ العام</Label>
              <Select defaultValue={selectedAccount?.glAccountId}>
                <SelectTrigger>
                  <SelectValue placeholder="اختر الحساب" />
                </SelectTrigger>
                <SelectContent>
                  {availableAccounts.map((account: any) => (
                    <SelectItem key={account.id} value={account.id}>
                      {account.code} - {account.nameAr || account.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAccountDialog(false)}>
              إلغاء
            </Button>
            <Button className="bg-teal-600 hover:bg-teal-700">
              <Save className="h-4 w-4 ml-2" />
              حفظ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

