import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { AlertCircle, Building2, Calculator, CheckCircle2, Clock, Plus, RefreshCw, Save, Settings, Palmtree } from 'lucide-react';
import { getHrPolicies, updateHrPolicies, type HrPolicies } from '@/services/hr/policies-service';
import {
  getPayrollAccountMappings,
  listPostingAccounts,
  upsertPayrollAccountMapping,
  type PayrollAccountMapping,
  type PayrollAccountType,
} from '@/services/hr/payroll-account-service';
import { useHrTranslation } from '../i18n';
import '../translations/pages';

const ACCOUNT_TYPES: PayrollAccountType[] = [
  'basic_salary', 'housing_allowance', 'transport_allowance', 'other_allowance',
  'deductions', 'loans', 'payable', 'net_payable', 'overtime', 'absence_recovery',
  'gosi_employee', 'gosi_employer_expense', 'gosi_payable', 'eos_expense', 'eos_payable',
];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

export const SettingsPage: React.FC = () => {
  const { t } = useHrTranslation();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = React.useState('policies');
  const [showAccountDialog, setShowAccountDialog] = React.useState(false);
  const [selectedMapping, setSelectedMapping] = React.useState<PayrollAccountMapping | null>(null);
  const [accountType, setAccountType] = React.useState<PayrollAccountType | ''>('');
  const [glAccountId, setGlAccountId] = React.useState('');
  const [editedPolicies, setEditedPolicies] = React.useState<Partial<HrPolicies>>({});

  const { data: policies } = useQuery({ queryKey: ['hr', 'policies'], queryFn: getHrPolicies });
  const { data: mappings = [], isLoading: mappingsLoading } = useQuery({ queryKey: ['hr', 'payroll-account-mappings'], queryFn: getPayrollAccountMappings });
  const { data: accounts = [] } = useQuery({ queryKey: ['hr', 'posting-accounts'], queryFn: listPostingAccounts });

  const currentPolicies = { ...policies, ...editedPolicies };
  const updatePolicy = <K extends keyof HrPolicies>(key: K, value: HrPolicies[K]) => setEditedPolicies((current) => ({ ...current, [key]: value }));

  const policyMutation = useMutation({
    mutationFn: () => updateHrPolicies(editedPolicies),
    onSuccess: () => {
      toast.success(t('settings.policiesSaved'));
      setEditedPolicies({});
      queryClient.invalidateQueries({ queryKey: ['hr', 'policies'] });
    },
    onError: () => toast.error(t('settings.policiesFailed')),
  });

  const mappingMutation = useMutation({
    mutationFn: () => {
      if (!accountType || !glAccountId) throw new Error(t('settings.selectAccount'));
      return upsertPayrollAccountMapping(accountType, glAccountId);
    },
    onSuccess: () => {
      toast.success(t('settings.mappingSaved'));
      queryClient.invalidateQueries({ queryKey: ['hr', 'payroll-account-mappings'] });
      setShowAccountDialog(false);
    },
    onError: (error: Error) => toast.error(error.message || t('settings.mappingFailed')),
  });

  const openMappingDialog = (mapping?: PayrollAccountMapping) => {
    setSelectedMapping(mapping ?? null);
    setAccountType(mapping?.account_type ?? '');
    setGlAccountId(mapping?.gl_account_id ?? '');
    setShowAccountDialog(true);
  };

  const saveButton = (labelKey: string) => (
    <div className="flex justify-end">
      <Button onClick={() => policyMutation.mutate()} disabled={policyMutation.isPending || Object.keys(editedPolicies).length === 0}>
        {policyMutation.isPending ? <RefreshCw className="h-4 w-4 me-2 animate-spin" /> : <Save className="h-4 w-4 me-2" />}
        {t(labelKey)}
      </Button>
    </div>
  );

  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold tracking-tight">{t('settings.title')}</h1><p className="text-muted-foreground">{t('settings.subtitle')}</p></div>
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <TabsList className="grid w-full grid-cols-4">
        <TabsTrigger value="policies"><Settings className="h-4 w-4 me-2" />{t('settings.general')}</TabsTrigger>
        <TabsTrigger value="leave"><Palmtree className="h-4 w-4 me-2" />{t('settings.leave')}</TabsTrigger>
        <TabsTrigger value="attendance"><Clock className="h-4 w-4 me-2" />{t('settings.attendance')}</TabsTrigger>
        <TabsTrigger value="accounts"><Calculator className="h-4 w-4 me-2" />{t('settings.accounts')}</TabsTrigger>
      </TabsList>

      <TabsContent value="policies" className="mt-4">
        <Card><CardHeader><CardTitle><Building2 className="inline h-5 w-5 me-2" />{t('settings.generalTitle')}</CardTitle><CardDescription>{t('settings.generalDescription')}</CardDescription></CardHeader>
          <CardContent className="space-y-6"><div className="grid gap-6 md:grid-cols-2">
            <div><Label>{t('settings.employeeHours')}</Label><Input type="number" value={currentPolicies.employee_daily_hours ?? 8} onChange={(event) => updatePolicy('employee_daily_hours', Number(event.target.value))} /></div>
            <div><Label>{t('settings.workerHours')}</Label><Input type="number" value={currentPolicies.worker_daily_hours ?? 11} onChange={(event) => updatePolicy('worker_daily_hours', Number(event.target.value))} /></div>
            <div><Label>{t('settings.workerShifts')}</Label><Input type="number" value={currentPolicies.worker_shifts ?? 2} onChange={(event) => updatePolicy('worker_shifts', Number(event.target.value))} /></div>
            <div><Label>{t('settings.overtimeMultiplier')}</Label><Select value={String(currentPolicies.overtime_multiplier ?? 1.5)} onValueChange={(value) => updatePolicy('overtime_multiplier', Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1.25">1.25x</SelectItem><SelectItem value="1.5">1.5x</SelectItem><SelectItem value="2">2x</SelectItem></SelectContent></Select></div>
          </div>{saveButton('settings.saveSettings')}</CardContent></Card>
      </TabsContent>

      <TabsContent value="leave" className="mt-4">
        <Card><CardHeader><CardTitle>{t('settings.leaveTitle')}</CardTitle><CardDescription>{t('settings.leaveDescription')}</CardDescription></CardHeader><CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2"><Card><CardContent className="p-4"><p className="font-medium">{t('settings.annualLeave')}</p><p className="text-2xl font-bold">{t('settings.daysValue', { count: currentPolicies.annual_leave_days_before_5y ?? 21 })}</p><p className="text-xs text-muted-foreground">{t('settings.annualNote')}</p></CardContent></Card><Card><CardContent className="p-4"><p className="font-medium">{t('settings.sickLeave')}</p><p className="text-2xl font-bold">{t('settings.daysValue', { count: 30 })}</p><p className="text-xs text-muted-foreground">{t('settings.sickNote')}</p></CardContent></Card></div>
          {saveButton('settings.saveLeave')}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="attendance" className="mt-4">
        <Card><CardHeader><CardTitle>{t('settings.attendanceTitle')}</CardTitle><CardDescription>{t('settings.attendanceDescription')}</CardDescription></CardHeader><CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2"><div><Label>{t('settings.overtimeGrace')}</Label><Input type="number" value={currentPolicies.overtime_grace_minutes ?? 0} onChange={(event) => updatePolicy('overtime_grace_minutes', Number(event.target.value))} /><p className="text-xs text-muted-foreground">{t('settings.overtimeGraceNote')}</p></div><div><Label>{t('settings.overtimeMultiplier')}</Label><Select value={String(currentPolicies.overtime_multiplier ?? 1.5)} onValueChange={(value) => updatePolicy('overtime_multiplier', Number(value))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="1.25">1.25x</SelectItem><SelectItem value="1.5">1.5x</SelectItem><SelectItem value="2">2x</SelectItem></SelectContent></Select></div></div>
          <div className="rounded-lg border p-4"><h4 className="font-medium mb-3">{t('settings.weekendDays')}</h4><div className="flex flex-wrap gap-2">{WEEKDAYS.map((day) => <Badge key={day} variant={currentPolicies.weekend_days?.includes(day) ? 'default' : 'outline'}>{t(`settings.weekdays.${day}`)}</Badge>)}</div><p className="mt-2 text-xs text-muted-foreground">{t('settings.selectedDays', { days: currentPolicies.weekend_days?.map((day) => t(`settings.weekdays.${day}`)).join(', ') || t('settings.none') })}</p></div>
          {saveButton('settings.saveAttendance')}
        </CardContent></Card>
      </TabsContent>

      <TabsContent value="accounts" className="mt-4">
        <Card><CardHeader className="flex flex-row items-center justify-between"><div><CardTitle>{t('settings.accountsTitle')}</CardTitle><CardDescription>{t('settings.accountsDescription')}</CardDescription></div><Button variant="outline" onClick={() => openMappingDialog()}><Plus className="h-4 w-4 me-2" />{t('settings.addMapping')}</Button></CardHeader><CardContent>
          {mappingsLoading ? <div className="py-8 text-center">{t('common.loading')}</div> : mappings.length === 0 ? <div className="py-8 text-center"><AlertCircle className="mx-auto mb-3 h-12 w-12" /><p>{t('settings.noMappings')}</p><p className="text-sm text-muted-foreground">{t('settings.noMappingsDescription')}</p></div> : <Table><TableHeader><TableRow><TableHead>{t('settings.accountType')}</TableHead><TableHead>{t('settings.linkedAccount')}</TableHead><TableHead>{t('common.status')}</TableHead><TableHead>{t('common.actions')}</TableHead></TableRow></TableHeader><TableBody>{mappings.map((mapping) => { const account = accounts.find((item) => item.id === mapping.gl_account_id); return <TableRow key={mapping.id}><TableCell>{t(`settings.accountTypes.${mapping.account_type}`)}</TableCell><TableCell>{account ? `${account.code} - ${account.name}` : mapping.gl_account_id}</TableCell><TableCell><Badge><CheckCircle2 className="h-3 w-3 me-1" />{t('settings.linked')}</Badge></TableCell><TableCell><Button size="sm" variant="ghost" onClick={() => openMappingDialog(mapping)}>{t('common.edit')}</Button></TableCell></TableRow>; })}</TableBody></Table>}
          <div className="mt-6 rounded-lg border p-4"><h4 className="font-medium mb-3">{t('settings.requiredMappings')}</h4><div className="grid gap-2 md:grid-cols-2">{ACCOUNT_TYPES.map((type) => { const mapped = mappings.some((mapping) => mapping.account_type === type); return <div key={type} className="flex items-center justify-between rounded-lg border p-3"><span>{t(`settings.accountTypes.${type}`)}</span>{mapped ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <AlertCircle className="h-4 w-4 text-amber-600" />}</div>; })}</div></div>
        </CardContent></Card>
      </TabsContent>
    </Tabs>

    <Dialog open={showAccountDialog} onOpenChange={setShowAccountDialog}><DialogContent className="max-w-md"><DialogHeader><DialogTitle>{t(selectedMapping ? 'settings.mappingTitleEdit' : 'settings.mappingTitleAdd')}</DialogTitle><DialogDescription>{t('settings.mappingDescription')}</DialogDescription></DialogHeader><div className="space-y-4"><div><Label>{t('settings.accountType')}</Label><Select value={accountType} onValueChange={(value) => setAccountType(value as PayrollAccountType)}><SelectTrigger><SelectValue placeholder={t('settings.selectAccountType')} /></SelectTrigger><SelectContent>{ACCOUNT_TYPES.map((type) => <SelectItem key={type} value={type}>{t(`settings.accountTypes.${type}`)}</SelectItem>)}</SelectContent></Select></div><div><Label>{t('settings.glAccount')}</Label><Select value={glAccountId} onValueChange={setGlAccountId}><SelectTrigger><SelectValue placeholder={t('settings.selectAccount')} /></SelectTrigger><SelectContent>{accounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.code} - {account.name}</SelectItem>)}</SelectContent></Select></div></div><DialogFooter><Button variant="outline" onClick={() => setShowAccountDialog(false)}>{t('common.cancel')}</Button><Button onClick={() => mappingMutation.mutate()} disabled={!accountType || !glAccountId || mappingMutation.isPending}><Save className="h-4 w-4 me-2" />{t('common.save')}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
};
