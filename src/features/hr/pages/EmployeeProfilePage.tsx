import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  User,
  Briefcase,
  Banknote,
  FileText,
  Plus,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { getEmployees } from '@/services/hr/hr-service';
import {
  getEmployeeSalaryComponents,
  listSalaryComponents,
  upsertEmployeeSalaryComponent,
  deactivateEmployeeSalaryComponent,
  type EmployeeSalaryComponent,
} from '@/services/hr/employee-service';
import { STATUS_BADGES } from '../types';

export const EmployeeProfilePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [showAddDialog, setShowAddDialog] = React.useState(false);
  const [addForm, setAddForm] = React.useState({
    component_id: '',
    amount: '',
    calculation_type: 'fixed' as 'fixed' | 'percentage',
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
    staleTime: 60_000,
  });

  const employee = React.useMemo(
    () => employees.find((e) => e.id === id),
    [employees, id],
  );

  const { data: salaryComponents = [] } = useQuery({
    queryKey: ['hr', 'employee-salary-components', id],
    queryFn: () => getEmployeeSalaryComponents(id as string),
    enabled: !!id && !!employee,
    staleTime: 60_000,
  });

  const { data: availableComponents = [] } = useQuery({
    queryKey: ['hr', 'salary-components'],
    queryFn: listSalaryComponents,
    staleTime: 300_000,
  });

  const addMutation = useMutation({
    mutationFn: () =>
      upsertEmployeeSalaryComponent(id as string, {
        component_id: addForm.component_id,
        amount: Number(addForm.amount),
        calculation_type: addForm.calculation_type,
      }),
    onSuccess: () => {
      toast.success('تم إسناد مكوّن الراتب');
      queryClient.invalidateQueries({ queryKey: ['hr', 'employee-salary-components', id] });
      setShowAddDialog(false);
      setAddForm({ component_id: '', amount: '', calculation_type: 'fixed' });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const removeMutation = useMutation({
    mutationFn: (structureId: string) => deactivateEmployeeSalaryComponent(structureId),
    onSuccess: () => {
      toast.success('تم إلغاء تفعيل المكوّن');
      queryClient.invalidateQueries({ queryKey: ['hr', 'employee-salary-components', id] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!employee) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <p className="text-muted-foreground">الموظف غير موجود</p>
        <Button variant="link" onClick={() => navigate('/hr/employees')}>
          العودة للقائمة
        </Button>
      </div>
    );
  }

  const totalEarnings = salaryComponents
    .filter((c: EmployeeSalaryComponent) => c.componentType !== 'deduction')
    .reduce((s, c) => s + c.value, employee.salary ?? 0);

  const totalDeductions = salaryComponents
    .filter((c: EmployeeSalaryComponent) => c.componentType === 'deduction')
    .reduce((s, c) => s + c.value, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate('/hr/employees')}>
          <ArrowRight className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{employee.name}</h1>
          <p className="text-muted-foreground text-sm">
            {employee.jobTitle} • {employee.department}
          </p>
        </div>
        <div className="mr-auto">
          <Badge className={STATUS_BADGES[employee.status]}>{employee.status}</Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* بطاقة الموظف */}
        <Card className="md:col-span-1 border-border/60 h-fit">
          <CardContent className="pt-6 flex flex-col items-center text-center">
            <Avatar className="h-24 w-24 mb-4">
              <AvatarImage
                src={`https://ui-avatars.com/api/?name=${employee.name}&background=random`}
              />
              <AvatarFallback>
                <User className="h-10 w-10" />
              </AvatarFallback>
            </Avatar>
            <h2 className="text-xl font-semibold">{employee.name}</h2>
            <p className="text-sm text-muted-foreground mb-4">{employee.code}</p>

            <div className="w-full space-y-3 text-right mt-4 border-t pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">تاريخ التعيين</span>
                <span>
                  {employee.hiringDate
                    ? new Date(employee.hiringDate).toLocaleDateString()
                    : '—'}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">القسم</span>
                <span>{employee.department}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">الراتب الأساسي</span>
                <span>
                  {employee.salary?.toLocaleString()} {employee.currency}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* تبويبات */}
        <div className="md:col-span-2">
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="w-full justify-start">
              <TabsTrigger value="overview">نظرة عامة</TabsTrigger>
              <TabsTrigger value="salary">الراتب والبدلات</TabsTrigger>
              <TabsTrigger value="documents">المستندات</TabsTrigger>
            </TabsList>

            {/* نظرة عامة */}
            <TabsContent value="overview" className="space-y-4 mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Briefcase className="h-4 w-4" />
                    معلومات العقد
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">نوع العقد</p>
                      <p className="font-medium">دوام كامل</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">تاريخ الانتهاء</p>
                      <p className="font-medium">
                        {employee.contractEndDate
                          ? new Date(employee.contractEndDate).toLocaleDateString()
                          : 'مفتوح'}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* الراتب والبدلات */}
            <TabsContent value="salary" className="space-y-4 mt-4">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Banknote className="h-4 w-4" />
                    هيكل الراتب
                  </CardTitle>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setShowAddDialog(true)}
                  >
                    <Plus className="h-4 w-4 ml-1" />
                    إضافة مكوّن
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {/* الأساسي */}
                    <div className="flex justify-between items-center p-3 bg-muted/50 rounded-md">
                      <span className="font-medium">الراتب الأساسي</span>
                      <span className="font-bold">
                        {employee.salary?.toLocaleString()} {employee.currency}
                      </span>
                    </div>

                    {/* المكوّنات */}
                    {salaryComponents.length === 0 ? (
                      <div className="text-center py-4 text-muted-foreground text-sm border-2 border-dashed rounded-md">
                        لا توجد بدلات أو استقطاعات إضافية — اضغط &quot;إضافة مكوّن&quot;
                      </div>
                    ) : (
                      salaryComponents.map((comp: EmployeeSalaryComponent) => (
                        <div
                          key={comp.id}
                          className="flex justify-between items-center p-3 bg-muted/30 rounded-md group"
                        >
                          <span className="flex items-center gap-2">
                            {comp.componentName}
                            {comp.componentType === 'deduction' && (
                              <Badge variant="outline" className="text-xs">
                                استقطاع
                              </Badge>
                            )}
                          </span>
                          <div className="flex items-center gap-3">
                            <span
                              className={`font-medium ${
                                comp.componentType === 'deduction'
                                  ? 'text-destructive'
                                  : 'text-emerald-600'
                              }`}
                            >
                              {comp.componentType === 'deduction' ? '−' : '+'}
                              {comp.value.toLocaleString('en-US')} {employee.currency}
                            </span>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 opacity-0 group-hover:opacity-100 text-destructive"
                              onClick={() => removeMutation.mutate(comp.id)}
                              disabled={removeMutation.isPending}
                              title="إلغاء تفعيل"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}

                    {/* ملخّص */}
                    {salaryComponents.length > 0 && (
                      <div className="mt-3 pt-3 border-t space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">إجمالي المستحقات</span>
                          <span className="text-emerald-600 font-medium">
                            {totalEarnings.toLocaleString()} {employee.currency}
                          </span>
                        </div>
                        {totalDeductions > 0 && (
                          <div className="flex justify-between text-sm">
                            <span className="text-muted-foreground">إجمالي الاستقطاعات</span>
                            <span className="text-destructive font-medium">
                              −{totalDeductions.toLocaleString()} {employee.currency}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between font-semibold">
                          <span>الصافي التقديري</span>
                          <span>
                            {(totalEarnings - totalDeductions).toLocaleString()}{' '}
                            {employee.currency}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* المستندات */}
            <TabsContent value="documents" className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    المستندات الرسمية
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-md">
                    لا توجد مستندات مرفقة (الهوية، العقد، الشهادات)
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* ── نافذة إضافة مكوّن ── */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>إضافة مكوّن راتب</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>المكوّن *</Label>
              <Select
                value={addForm.component_id}
                onValueChange={(v) => setAddForm((f) => ({ ...f, component_id: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر المكوّن..." />
                </SelectTrigger>
                <SelectContent>
                  {availableComponents.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name_ar || c.name}
                      <span className="text-muted-foreground text-xs mr-1">
                        ({c.component_type === 'deduction' ? 'استقطاع' : 'إضافة'})
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>نوع الحساب</Label>
                <Select
                  value={addForm.calculation_type}
                  onValueChange={(v) =>
                    setAddForm((f) => ({
                      ...f,
                      calculation_type: v as 'fixed' | 'percentage',
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">مبلغ ثابت</SelectItem>
                    <SelectItem value="percentage">نسبة %</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>
                  القيمة {addForm.calculation_type === 'percentage' ? '(%)' : '(ر.س)'}
                </Label>
                <Input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={addForm.amount}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, amount: e.target.value }))
                  }
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              إلغاء
            </Button>
            <Button
              onClick={() => addMutation.mutate()}
              disabled={
                !addForm.component_id ||
                !addForm.amount ||
                Number(addForm.amount) <= 0 ||
                addMutation.isPending
              }
            >
              {addMutation.isPending ? 'جارٍ الحفظ...' : 'حفظ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
