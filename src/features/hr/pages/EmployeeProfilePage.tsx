import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Banknote, Briefcase, FileText, Plus, Trash2, User } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { getEmployees } from '@/services/hr/hr-service';
import {
  deactivateEmployeeSalaryComponent,
  getEmployeeSalaryComponents,
  listSalaryComponents,
  upsertEmployeeSalaryComponent,
  type EmployeeSalaryComponent,
} from '@/services/hr/employee-service';
import { STATUS_BADGES } from '../types';
import { getHrStatusKey, useHrTranslation } from '../i18n';
import '../translations/pages';

const initialForm = {
  component_id: '',
  amount: '',
  calculation_type: 'fixed' as 'fixed' | 'percentage',
  percentage_base: 'basic' as 'basic' | 'basic_housing',
};

export const EmployeeProfilePage: React.FC = () => {
  const { t, i18n } = useHrTranslation();
  const isArabic = i18n.resolvedLanguage?.startsWith('ar') ?? true;
  const locale = isArabic ? 'ar-SA' : 'en-US';
  const BackIcon = isArabic ? ArrowRight : ArrowLeft;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showAddDialog, setShowAddDialog] = React.useState(false);
  const [form, setForm] = React.useState(initialForm);

  const { data: employees = [] } = useQuery({ queryKey: ['hr', 'employees'], queryFn: getEmployees, staleTime: 60_000 });
  const employee = React.useMemo(() => employees.find((item) => item.id === id), [employees, id]);
  const { data: salaryComponents = [] } = useQuery({
    queryKey: ['hr', 'employee-salary-components', id],
    queryFn: () => getEmployeeSalaryComponents(id as string),
    enabled: Boolean(id && employee),
    staleTime: 60_000,
  });
  const { data: availableComponents = [] } = useQuery({ queryKey: ['hr', 'salary-components'], queryFn: listSalaryComponents, staleTime: 300_000 });

  const addMutation = useMutation({
    mutationFn: () => upsertEmployeeSalaryComponent(id as string, {
      component_id: form.component_id,
      amount: Number(form.amount),
      calculation_type: form.calculation_type,
      percentage_base: form.calculation_type === 'percentage' ? form.percentage_base : undefined,
    }),
    onSuccess: () => {
      toast.success(t('profile.assigned'));
      queryClient.invalidateQueries({ queryKey: ['hr', 'employee-salary-components', id] });
      setShowAddDialog(false);
      setForm(initialForm);
    },
    onError: (error: Error) => toast.error(error.message || t('profile.operationFailed')),
  });
  const removeMutation = useMutation({
    mutationFn: deactivateEmployeeSalaryComponent,
    onSuccess: () => {
      toast.success(t('profile.deactivated'));
      queryClient.invalidateQueries({ queryKey: ['hr', 'employee-salary-components', id] });
    },
    onError: (error: Error) => toast.error(error.message || t('profile.operationFailed')),
  });

  if (!employee) return <div className="flex h-96 flex-col items-center justify-center"><p className="text-muted-foreground">{t('profile.notFound')}</p><Button variant="link" onClick={() => navigate('/hr/employees')}>{t('profile.backToList')}</Button></div>;

  const money = (value: number) => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value);
  const date = (value?: string | null) => value ? new Intl.DateTimeFormat(locale).format(new Date(value)) : '—';
  const totalEarnings = salaryComponents.filter((component: EmployeeSalaryComponent) => component.componentType !== 'deduction').reduce((sum, component) => sum + component.value, employee.salary ?? 0);
  const totalDeductions = salaryComponents.filter((component: EmployeeSalaryComponent) => component.componentType === 'deduction').reduce((sum, component) => sum + component.value, 0);

  return <div className="space-y-6">
    <div className="flex items-center gap-4"><Button variant="ghost" size="icon" onClick={() => navigate('/hr/employees')} aria-label={t('profile.backToList')}><BackIcon className="h-4 w-4" /></Button><div><h1 className="text-2xl font-bold">{employee.name}</h1><p className="text-sm text-muted-foreground">{employee.jobTitle} • {employee.department}</p></div><div className="ms-auto"><Badge className={STATUS_BADGES[employee.status]}>{t(getHrStatusKey(employee.status))}</Badge></div></div>

    <div className="grid gap-6 md:grid-cols-3">
      <Card className="h-fit"><CardContent className="flex flex-col items-center pt-6 text-center"><Avatar className="mb-4 h-24 w-24"><AvatarImage src={`https://ui-avatars.com/api/?name=${encodeURIComponent(employee.name)}&background=random`} /><AvatarFallback><User className="h-10 w-10" /></AvatarFallback></Avatar><h2 className="text-xl font-semibold">{employee.name}</h2><p className="text-sm text-muted-foreground">{employee.code}</p><div className="mt-4 w-full space-y-3 border-t pt-4 text-start"><div className="flex justify-between"><span>{t('profile.hireDate')}</span><span>{date(employee.hiringDate)}</span></div><div className="flex justify-between"><span>{t('common.department')}</span><span>{employee.department}</span></div><div className="flex justify-between"><span>{t('profile.baseSalary')}</span><span>{money(employee.salary ?? 0)} {employee.currency}</span></div></div></CardContent></Card>

      <div className="md:col-span-2"><Tabs defaultValue="overview"><TabsList><TabsTrigger value="overview">{t('profile.overview')}</TabsTrigger><TabsTrigger value="salary">{t('profile.salaryBenefits')}</TabsTrigger><TabsTrigger value="documents">{t('profile.documents')}</TabsTrigger></TabsList>
        <TabsContent value="overview" className="mt-4"><Card><CardHeader><CardTitle><Briefcase className="inline h-4 w-4 me-2" />{t('profile.contractInfo')}</CardTitle></CardHeader><CardContent className="grid grid-cols-2 gap-4"><div><p className="text-sm text-muted-foreground">{t('profile.contractType')}</p><p className="font-medium">{t('profile.fullTime')}</p></div><div><p className="text-sm text-muted-foreground">{t('profile.expiryDate')}</p><p className="font-medium">{employee.contractEndDate ? date(employee.contractEndDate) : t('profile.openEnded')}</p></div></CardContent></Card></TabsContent>
        <TabsContent value="salary" className="mt-4"><Card><CardHeader className="flex flex-row items-center justify-between"><CardTitle><Banknote className="inline h-4 w-4 me-2" />{t('profile.salaryStructure')}</CardTitle><Button size="sm" variant="outline" onClick={() => setShowAddDialog(true)}><Plus className="h-4 w-4 me-1" />{t('profile.addComponent')}</Button></CardHeader><CardContent className="space-y-2"><div className="flex justify-between rounded-md bg-muted/50 p-3"><span>{t('profile.baseSalary')}</span><b>{money(employee.salary ?? 0)} {employee.currency}</b></div>{salaryComponents.length === 0 ? <div className="rounded-md border-2 border-dashed py-4 text-center text-sm text-muted-foreground">{t('profile.noComponents')}</div> : salaryComponents.map((component: EmployeeSalaryComponent) => <div key={component.id} className="group flex items-center justify-between rounded-md bg-muted/30 p-3"><span>{component.componentName}{component.componentType === 'deduction' && <Badge variant="outline" className="ms-2">{t('profile.deduction')}</Badge>}</span><div className="flex items-center gap-3"><span>{component.componentType === 'deduction' ? '−' : '+'}{money(component.value)} {employee.currency}</span><Button size="icon" variant="ghost" aria-label={t('profile.deactivate')} onClick={() => removeMutation.mutate(component.id)}><Trash2 className="h-4 w-4" /></Button></div></div>)}{salaryComponents.length > 0 && <div className="space-y-1 border-t pt-3"><div className="flex justify-between"><span>{t('profile.totalEarnings')}</span><span>{money(totalEarnings)} {employee.currency}</span></div><div className="flex justify-between"><span>{t('profile.totalDeductions')}</span><span>{money(totalDeductions)} {employee.currency}</span></div><div className="flex justify-between font-semibold"><span>{t('profile.estimatedNet')}</span><span>{money(totalEarnings - totalDeductions)} {employee.currency}</span></div></div>}</CardContent></Card></TabsContent>
        <TabsContent value="documents" className="mt-4"><Card><CardHeader><CardTitle><FileText className="inline h-4 w-4 me-2" />{t('profile.officialDocuments')}</CardTitle></CardHeader><CardContent><div className="rounded-md border-2 border-dashed py-8 text-center text-muted-foreground">{t('profile.noDocuments')}</div></CardContent></Card></TabsContent>
      </Tabs></div>
    </div>

    <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>{t('profile.addTitle')}</DialogTitle></DialogHeader><div className="space-y-4"><div><Label>{t('profile.component')}</Label><Select value={form.component_id} onValueChange={(value) => setForm((current) => ({ ...current, component_id: value }))}><SelectTrigger><SelectValue placeholder={t('profile.selectComponent')} /></SelectTrigger><SelectContent>{availableComponents.map((component) => <SelectItem key={component.id} value={component.id}>{isArabic ? component.name_ar || component.name : component.name || component.name_ar} ({t(component.component_type === 'deduction' ? 'profile.deduction' : 'profile.addition')})</SelectItem>)}</SelectContent></Select></div><div className="grid grid-cols-2 gap-3"><div><Label>{t('profile.calculationType')}</Label><Select value={form.calculation_type} onValueChange={(value) => setForm((current) => ({ ...current, calculation_type: value as 'fixed' | 'percentage' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="fixed">{t('profile.fixed')}</SelectItem><SelectItem value="percentage">{t('profile.percentage')}</SelectItem></SelectContent></Select></div><div><Label>{t('profile.value')}</Label><Input type="number" min="0.01" step="0.01" value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} /></div></div>{form.calculation_type === 'percentage' && <div><Label>{t('profile.percentageBase')}</Label><Select value={form.percentage_base} onValueChange={(value) => setForm((current) => ({ ...current, percentage_base: value as 'basic' | 'basic_housing' }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="basic">{t('profile.baseSalary')}</SelectItem><SelectItem value="basic_housing">{t('profile.basicHousing')}</SelectItem></SelectContent></Select><p className="text-xs text-muted-foreground">{t('profile.percentageNote')}</p></div>}</div><DialogFooter><Button variant="outline" onClick={() => setShowAddDialog(false)}>{t('common.cancel')}</Button><Button onClick={() => addMutation.mutate()} disabled={!form.component_id || !form.amount || Number(form.amount) <= 0 || addMutation.isPending}>{addMutation.isPending ? t('common.saving') : t('common.save')}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
};
