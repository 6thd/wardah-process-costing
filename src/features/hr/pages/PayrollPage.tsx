import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { getPayrollRuns } from '@/services/hr/hr-service';
import {
  calculatePayrollPreview,
  processPayrollRun,
  type PayrollPreviewEmployee,
} from '@/services/hr/payroll-engine';
import { checkIsPayrollAdmin } from '@/services/hr/payroll-admin-service';
import { STATUS_BADGES } from '../types';
import {
  DollarSign,
  Users,
  TrendingUp,
  AlertCircle,
  Download,
  Lock,
  FileText,
  Calculator,
  CheckCircle,
  Eye,
  Clock,
  Building2,
  Receipt,
} from 'lucide-react';
import { getHrStatusKey, HR_MONTH_KEYS, useHrTranslation } from '../i18n';
import '../translations/pages';
import '../translations/ui';

export const PayrollPage: React.FC = () => {
  const { t, i18n } = useHrTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const locale = i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-US';
  const currencyFormatter = React.useMemo(
    () => new Intl.NumberFormat(locale, { style: 'currency', currency: 'SAR', maximumFractionDigits: 2 }),
    [locale],
  );
  const numberFormatter = React.useMemo(
    () => new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }),
    [locale],
  );
  const initialDate = React.useMemo(() => new Date(), []);
  const [selectedPeriod, setSelectedPeriod] = React.useState(() => ({
    year: initialDate.getFullYear(),
    month: initialDate.getMonth() + 1,
  }));
  const [salarySlipDialogOpen, setSalarySlipDialogOpen] = React.useState(false);
  const [selectedEmployee, setSelectedEmployee] = React.useState<PayrollPreviewEmployee | null>(null);

  const { data: payrollRuns = [], isLoading: runsLoading } = useQuery({
    queryKey: ['hr', 'payroll-runs'],
    queryFn: () => getPayrollRuns(12),
  });

  // Display gate only; RLS/RPC remains the authoritative control.
  const { data: isPayrollAdmin = false } = useQuery({
    queryKey: ['hr', 'payroll-admin-gate'],
    queryFn: checkIsPayrollAdmin,
  });

  const {
    data: preview,
    isLoading: previewLoading,
    refetch: refetchPreview,
  } = useQuery({
    queryKey: ['hr', 'payroll-preview', selectedPeriod.year, selectedPeriod.month],
    queryFn: () => calculatePayrollPreview(selectedPeriod.year, selectedPeriod.month),
    enabled: Boolean(selectedPeriod.year && selectedPeriod.month),
  });

  const processPayrollMutation = useMutation({
    mutationFn: () => processPayrollRun(selectedPeriod.year, selectedPeriod.month),
    onSuccess: () => {
      toast({ title: `✅ ${t('payroll.approvedSuccess')}` });
      refetchPreview();
      queryClient.invalidateQueries({ queryKey: ['hr', 'payroll-runs'] });
    },
    onError: (error: any) => {
      toast({
        title: `❌ ${t('payroll.approveFailed')}`,
        description: error?.message ?? '',
        variant: 'destructive',
      });
    },
  });

  const handlePeriodChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (!value) return;
    const [yearPart, monthPart] = value.split('-').map((part) => Number.parseInt(part, 10));
    if (!Number.isNaN(yearPart) && !Number.isNaN(monthPart)) {
      setSelectedPeriod({ year: yearPart, month: monthPart });
    }
  };

  const handleViewSlip = (employee: PayrollPreviewEmployee) => {
    setSelectedEmployee(employee);
    setSalarySlipDialogOpen(true);
  };

  const handleExportPayroll = () => {
    if (!preview) return;
    const csvContent = [
      [
        t('payroll.csv.employee'),
        t('payroll.csv.department'),
        t('payroll.csv.base'),
        t('payroll.csv.allowances'),
        t('payroll.csv.overtime'),
        t('payroll.csv.deductions'),
        t('payroll.csv.absence'),
        t('payroll.csv.gross'),
        t('payroll.csv.net'),
      ].join(','),
      ...preview.employees.map((employee) => [
        employee.name,
        employee.department || '',
        employee.baseSalary,
        employee.allowanceTotal,
        employee.overtimeAmount,
        employee.deductions,
        employee.absenceAmount,
        employee.gross,
        employee.net,
      ].join(',')),
    ].join('\n');

    const blob = new Blob([`\ufeff${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `payroll_${selectedPeriod.year}_${selectedPeriod.month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast({ title: `✅ ${t('payroll.exported')}` });
  };

  const stats = React.useMemo(() => {
    if (!preview) return { employees: 0, avgSalary: 0, totalCost: 0, deductionRate: '0.0' };
    const employeeCount = preview.employees.length;
    return {
      employees: employeeCount,
      avgSalary: employeeCount > 0 ? preview.totals.net / employeeCount : 0,
      totalCost: preview.totals.gross,
      deductionRate: preview.totals.gross > 0
        ? ((preview.totals.deductions / preview.totals.gross) * 100).toFixed(1)
        : '0.0',
    };
  }, [preview]);

  const periodLabel = `${t(`months.${HR_MONTH_KEYS[selectedPeriod.month - 1]}`)} ${selectedPeriod.year}`;
  const alignNumber = i18n.resolvedLanguage?.startsWith('ar') ? 'text-right' : 'text-left';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('payroll.title')}</h1>
          <p className="text-muted-foreground">{t('payroll.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {preview && preview.employees.length > 0 && (
            <Button variant="outline" onClick={handleExportPayroll} className="gap-2">
              <Download className="h-4 w-4" />
              {t('payroll.export')}
            </Button>
          )}
          <Input
            type="month"
            className="w-48"
            value={`${selectedPeriod.year}-${String(selectedPeriod.month).padStart(2, '0')}`}
            onChange={handlePeriodChange}
          />
          <Button
            onClick={() => processPayrollMutation.mutate()}
            disabled={!isPayrollAdmin || processPayrollMutation.isPending || preview?.locked || !preview?.employees.length}
            title={!isPayrollAdmin ? t('payroll.adminRequired') : undefined}
            className="gap-2 bg-teal-600 hover:bg-teal-700"
          >
            {preview?.locked ? (
              <><Lock className="h-4 w-4" />{t('payroll.approved')}</>
            ) : processPayrollMutation.isPending ? (
              t('payroll.processing')
            ) : (
              <><CheckCircle className="h-4 w-4" />{t('payroll.approve')}</>
            )}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        {[
          { label: t('payroll.totalEmployees'), value: numberFormatter.format(stats.employees), icon: Users, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
          { label: t('payroll.averageSalary'), value: currencyFormatter.format(stats.avgSalary), icon: TrendingUp, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
          { label: t('payroll.totalCost'), value: currencyFormatter.format(stats.totalCost), icon: DollarSign, color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
          { label: t('payroll.deductionRate'), value: `${stats.deductionRate}%`, icon: AlertCircle, color: 'text-rose-500', bgColor: 'bg-rose-500/10' },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-border/60 bg-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div><p className="text-sm text-muted-foreground">{stat.label}</p><p className="mt-1 text-2xl font-bold">{stat.value}</p></div>
                  <div className={`${stat.bgColor} rounded-lg p-3`}><Icon className={`h-6 w-6 ${stat.color}`} /></div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs defaultValue="current" className="space-y-4">
        <TabsList>
          <TabsTrigger value="current">{t('payroll.current')}</TabsTrigger>
          <TabsTrigger value="history">{t('payroll.history')}</TabsTrigger>
          <TabsTrigger value="summary">{t('payroll.summary')}</TabsTrigger>
        </TabsList>

        <TabsContent value="current" className="space-y-4">
          <Card className="border-border/60 bg-card">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div><CardTitle>{t('payroll.payrollSheet')}</CardTitle><CardDescription>{periodLabel}</CardDescription></div>
                {preview?.locked && (
                  <Badge className="bg-emerald-500/20 text-emerald-400"><Lock className="me-1 h-3 w-3" />{t('payroll.approved')}</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent>
              {previewLoading ? (
                <div className="p-12 text-center">
                  <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-teal-500 border-r-transparent" />
                  <p className="mt-4 text-muted-foreground">{t('payroll.calculating')}</p>
                </div>
              ) : !preview || preview.employees.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground">
                  <Calculator className="mx-auto mb-4 h-16 w-16 opacity-50" />
                  <p className="text-lg font-medium">{t('common.noData')}</p>
                  <p className="text-sm">{t('payroll.noEmployees')}</p>
                </div>
              ) : (
                <>
                  <div className="mb-6 grid gap-4 md:grid-cols-3">
                    {[
                      { label: t('payroll.grossPayroll'), value: preview.totals.gross, classes: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400' },
                      { label: t('payroll.deductions'), value: preview.totals.deductions, classes: 'border-rose-500/30 bg-rose-500/10 text-rose-400' },
                      { label: t('payroll.netPay'), value: preview.totals.net, classes: 'border-blue-500/30 bg-blue-500/10 text-blue-400' },
                    ].map((item) => (
                      <div key={item.label} className={`rounded-lg border p-4 ${item.classes}`}>
                        <p className="mb-1 text-sm text-muted-foreground">{item.label}</p>
                        <p className="text-2xl font-bold">{currencyFormatter.format(item.value)}</p>
                      </div>
                    ))}
                  </div>
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.employee')}</TableHead>
                          <TableHead>{t('common.department')}</TableHead>
                          <TableHead className={alignNumber}>{t('payroll.base')}</TableHead>
                          <TableHead className={alignNumber}>{t('payroll.allowances')}</TableHead>
                          <TableHead className={alignNumber}>{t('payroll.overtime')}</TableHead>
                          <TableHead className={alignNumber}>{t('payroll.deductions')}</TableHead>
                          <TableHead className={alignNumber}>{t('payroll.gross')}</TableHead>
                          <TableHead className={alignNumber}>{t('payroll.net')}</TableHead>
                          <TableHead />
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {preview.employees.map((employee) => (
                          <TableRow key={employee.employeeId} className="hover:bg-muted/50">
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 text-xs font-semibold text-white">{employee.name.charAt(0).toUpperCase()}</div>
                                <div><div className="font-medium">{employee.name}</div><div className="text-xs text-muted-foreground">{employee.employeeCode || '—'}</div></div>
                              </div>
                            </TableCell>
                            <TableCell><div className="flex items-center gap-2"><Building2 className="h-4 w-4 text-muted-foreground" />{employee.department || '—'}</div></TableCell>
                            <TableCell className={`${alignNumber} font-medium`}>{numberFormatter.format(employee.baseSalary)}</TableCell>
                            <TableCell className={`${alignNumber} text-emerald-600`}>+{numberFormatter.format(employee.allowanceTotal)}</TableCell>
                            <TableCell className={`${alignNumber} text-amber-600`}>+{numberFormatter.format(employee.overtimeAmount)}</TableCell>
                            <TableCell className={`${alignNumber} text-rose-600`}>-{numberFormatter.format(employee.deductions)}</TableCell>
                            <TableCell className={`${alignNumber} font-semibold`}>{numberFormatter.format(employee.gross)}</TableCell>
                            <TableCell className={`${alignNumber} font-bold text-blue-600`}>{numberFormatter.format(employee.net)}</TableCell>
                            <TableCell><Button variant="ghost" size="sm" onClick={() => handleViewSlip(employee)} className="gap-2"><Eye className="h-4 w-4" />{t('payroll.slip')}</Button></TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="border-border/60 bg-card">
            <CardHeader><CardTitle>{t('payroll.historyTitle')}</CardTitle><CardDescription>{t('payroll.historyDescription')}</CardDescription></CardHeader>
            <CardContent>
              {runsLoading ? (
                <div className="p-12 text-center text-muted-foreground">{t('common.loading')}</div>
              ) : payrollRuns.length === 0 ? (
                <div className="p-12 text-center text-muted-foreground"><FileText className="mx-auto mb-4 h-16 w-16 opacity-50" /><p>{t('payroll.noHistory')}</p></div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {payrollRuns.map((run) => (
                    <Card key={run.id} className="cursor-pointer border-border/60 transition-all hover:border-teal-500/50">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-lg font-semibold">{run.periodCode}</p>
                            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="h-3 w-3" />
                              {run.processedOn ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(new Date(run.processedOn)) : t('payroll.notSpecified')}
                            </p>
                            <p className="mt-1 text-xs text-muted-foreground">{t('payroll.employeeCount', { count: run.employeeCount || 0 })}</p>
                          </div>
                          <div className="text-end">
                            <p className="text-xl font-bold text-blue-600">{numberFormatter.format(run.totalNet || 0)}</p>
                            <p className="text-xs text-muted-foreground">{run.currency || 'SAR'}</p>
                            <Badge className={`mt-2 px-2 py-0.5 text-[10px] ${STATUS_BADGES[run.status]}`}>{t(getHrStatusKey(run.status))}</Badge>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-border/60 bg-card">
              <CardHeader><CardTitle>{t('payroll.allowancesSummary')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3"><span className="text-sm font-medium">{t('payroll.totalAllowances')}</span><span className="text-lg font-bold text-emerald-500">{currencyFormatter.format(preview?.totals.allowances || 0)}</span></div>
                <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3"><span className="text-sm font-medium">{t('payroll.overtime')}</span><span className="text-lg font-bold text-amber-500">{currencyFormatter.format(preview?.totals.overtime || 0)}</span></div>
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-card">
              <CardHeader><CardTitle>{t('payroll.deductionsSummary')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3"><span className="text-sm font-medium">{t('payroll.totalDeductions')}</span><span className="text-lg font-bold text-rose-500">{currencyFormatter.format(preview?.totals.deductions || 0)}</span></div>
                <div className="flex items-center justify-between rounded-lg bg-muted/30 p-3"><span className="text-sm font-medium">{t('payroll.absenceDeduction')}</span><span className="text-lg font-bold text-rose-500">{currencyFormatter.format(preview?.totals.absence || 0)}</span></div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={salarySlipDialogOpen} onOpenChange={setSalarySlipDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" />{t('payroll.slipTitle')}</DialogTitle>
            <DialogDescription>{periodLabel}</DialogDescription>
          </DialogHeader>
          {selectedEmployee && (
            <div className="space-y-6 py-4">
              <div className="grid grid-cols-2 gap-4 rounded-lg bg-muted/30 p-4">
                <div><p className="text-xs text-muted-foreground">{t('common.employee')}</p><p className="font-semibold">{selectedEmployee.name}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('common.department')}</p><p className="font-semibold">{selectedEmployee.department || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('payroll.employeeCode')}</p><p className="font-semibold">{selectedEmployee.employeeCode || '—'}</p></div>
                <div><p className="text-xs text-muted-foreground">{t('payroll.absenceDays')}</p><p className="font-semibold">{numberFormatter.format(selectedEmployee.absenceDays)}</p></div>
              </div>
              <div>
                <h3 className="mb-3 flex items-center gap-2 font-semibold"><TrendingUp className="h-4 w-4 text-emerald-500" />{t('payroll.earnings')}</h3>
                <div className="space-y-2">
                  <div className="flex justify-between rounded bg-muted/20 p-2"><span className="text-sm">{t('payroll.base')}</span><span className="font-medium">{currencyFormatter.format(selectedEmployee.baseSalary)}</span></div>
                  <div className="flex justify-between rounded bg-muted/20 p-2"><span className="text-sm">{t('payroll.allowances')}</span><span className="font-medium text-emerald-600">+{currencyFormatter.format(selectedEmployee.allowanceTotal)}</span></div>
                  <div className="flex justify-between rounded bg-muted/20 p-2"><span className="text-sm">{t('payroll.overtime')}</span><span className="font-medium text-amber-600">+{currencyFormatter.format(selectedEmployee.overtimeAmount)}</span></div>
                </div>
              </div>
              <div>
                <h3 className="mb-3 flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4 text-rose-500" />{t('payroll.deductions')}</h3>
                <div className="space-y-2">
                  <div className="flex justify-between rounded bg-muted/20 p-2"><span className="text-sm">{t('payroll.generalDeductions')}</span><span className="font-medium text-rose-600">-{currencyFormatter.format(selectedEmployee.deductions)}</span></div>
                  <div className="flex justify-between rounded bg-muted/20 p-2"><span className="text-sm">{t('payroll.absenceDeduction')}</span><span className="font-medium text-rose-600">-{currencyFormatter.format(selectedEmployee.absenceAmount)}</span></div>
                </div>
              </div>
              <div className="space-y-2 border-t pt-4">
                <div className="flex justify-between text-lg"><span className="font-semibold">{t('payroll.gross')}</span><span className="font-bold">{currencyFormatter.format(selectedEmployee.gross)}</span></div>
                <div className="flex justify-between rounded-lg bg-blue-500/10 p-3 text-xl"><span className="font-bold">{t('payroll.netSalary')}</span><span className="font-bold text-blue-600">{currencyFormatter.format(selectedEmployee.net)}</span></div>
              </div>
              <div className="flex gap-2 pt-4">
                <Button variant="outline" onClick={() => setSalarySlipDialogOpen(false)} className="flex-1">{t('payroll.close')}</Button>
                <Button onClick={() => window.print()} className="flex-1 gap-2"><FileText className="h-4 w-4" />{t('payroll.print')}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};
