// src/features/hr/pages/PayrollPage.tsx
// بسم الله الرحمن الرحيم  
// إدارة الرواتب المحسّنة

import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { ar } from 'date-fns/locale';
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
import { calculatePayrollPreview, processPayrollRun, type PayrollPreviewEmployee } from '@/services/hr/payroll-engine';
import { STATUS_BADGES } from '../types';
import {
    DollarSign, Users, TrendingUp, AlertCircle, Download, 
    Lock, Unlock, FileText, Calculator, CheckCircle, XCircle,
    Eye, Clock, Building2, Receipt
} from 'lucide-react';

export const PayrollPage: React.FC = () => {
    const { t } = useTranslation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
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

    const {
        data: preview,
        isLoading: previewLoading,
        refetch: refetchPreview,
    } = useQuery({
        queryKey: ['hr', 'payroll-preview', selectedPeriod.year, selectedPeriod.month],
        queryFn: () => calculatePayrollPreview(selectedPeriod.year, selectedPeriod.month),
        enabled: !!selectedPeriod.year && !!selectedPeriod.month,
    });

    const processPayrollMutation = useMutation({
        mutationFn: () => processPayrollRun(selectedPeriod.year, selectedPeriod.month),
        onSuccess: () => {
            toast({ title: '✅ تم اعتماد الرواتب بنجاح' });
            refetchPreview();
            queryClient.invalidateQueries({ queryKey: ['hr', 'payroll-runs'] });
        },
        onError: (error: any) => {
            toast({
                title: '❌ فشل في اعتماد الرواتب',
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
            ['الموظف', 'القسم', 'الراتب الأساسي', 'البدلات', 'العمل الإضافي', 'الاستقطاعات', 'الغياب', 'الإجمالي', 'الصافي'].join(','),
            ...preview.employees.map(emp => [
                emp.name,
                emp.department || '',
                emp.baseSalary,
                emp.allowanceTotal,
                emp.overtimeAmount,
                emp.deductions,
                emp.absenceAmount,
                emp.gross,
                emp.net
            ].join(','))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `payroll_${selectedPeriod.year}_${selectedPeriod.month}.csv`;
        link.click();
        toast({ title: '✅ تم تصدير كشف الرواتب بنجاح' });
    };

    const handlePrintSlip = () => {
        window.print();
    };

    const stats = React.useMemo(() => {
        if (!preview) return { employees: 0, avgSalary: 0, totalCost: 0, deductionRate: 0 };
        
        const employeeCount = preview.employees.length;
        const avgSalary = employeeCount > 0 ? preview.totals.net / employeeCount : 0;
        const deductionRate = preview.totals.gross > 0 
            ? ((preview.totals.deductions / preview.totals.gross) * 100).toFixed(1)
            : '0.0';

        return {
            employees: employeeCount,
            avgSalary,
            totalCost: preview.totals.gross,
            deductionRate,
        };
    }, [preview]);

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">إدارة الرواتب</h1>
                    <p className="text-muted-foreground">
                        معالجة مسيرات الرواتب الشهرية، البدلات، والاستقطاعات
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {preview && preview.employees.length > 0 && (
                        <Button variant="outline" onClick={handleExportPayroll} className="gap-2">
                            <Download className="h-4 w-4" />
                            تصدير
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
                        disabled={processPayrollMutation.isPending || preview?.locked || !preview?.employees.length}
                        className="gap-2 bg-teal-600 hover:bg-teal-700"
                    >
                        {preview?.locked ? (
                            <>
                                <Lock className="h-4 w-4" />
                                معتمد
                            </>
                        ) : processPayrollMutation.isPending ? (
                            'جارٍ المعالجة...'
                        ) : (
                            <>
                                <CheckCircle className="h-4 w-4" />
                                اعتماد الرواتب
                            </>
                        )}
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-4">
                {[
                    {
                        label: 'إجمالي الموظفين',
                        value: stats.employees,
                        icon: Users,
                        color: 'text-blue-500',
                        bgColor: 'bg-blue-500/10',
                    },
                    {
                        label: 'متوسط الراتب',
                        value: `${stats.avgSalary.toLocaleString(undefined, { maximumFractionDigits: 0 })} ريال`,
                        icon: TrendingUp,
                        color: 'text-emerald-500',
                        bgColor: 'bg-emerald-500/10',
                    },
                    {
                        label: 'إجمالي التكلفة',
                        value: `${stats.totalCost.toLocaleString()} ريال`,
                        icon: DollarSign,
                        color: 'text-amber-500',
                        bgColor: 'bg-amber-500/10',
                    },
                    {
                        label: 'معدل الاستقطاعات',
                        value: `${stats.deductionRate}%`,
                        icon: AlertCircle,
                        color: 'text-rose-500',
                        bgColor: 'bg-rose-500/10',
                    },
                ].map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <Card key={stat.label} className="border-border/60 bg-card">
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                                        <p className="text-2xl font-bold mt-1">{stat.value}</p>
                                    </div>
                                    <div className={`${stat.bgColor} p-3 rounded-lg`}>
                                        <Icon className={`h-6 w-6 ${stat.color}`} />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Main Content */}
            <Tabs defaultValue="current" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="current">الدورة الحالية</TabsTrigger>
                    <TabsTrigger value="history">السجل</TabsTrigger>
                    <TabsTrigger value="summary">الملخص</TabsTrigger>
                </TabsList>

                {/* Current Payroll */}
                <TabsContent value="current" className="space-y-4">
                    <Card className="border-border/60 bg-card">
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <div>
                                    <CardTitle>كشف الرواتب</CardTitle>
                                    <CardDescription>
                                        {selectedPeriod.year} - {['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][selectedPeriod.month - 1]}
                                    </CardDescription>
                                </div>
                                {preview?.locked && (
                                    <Badge className="bg-emerald-500/20 text-emerald-400">
                                        <Lock className="h-3 w-3 ml-1" />
                                        معتمد
                                    </Badge>
                                )}
                            </div>
                        </CardHeader>
                        <CardContent>
                            {previewLoading ? (
                                <div className="p-12 text-center">
                                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-teal-500 border-r-transparent"></div>
                                    <p className="mt-4 text-muted-foreground">جارٍ حساب الرواتب...</p>
                                </div>
                            ) : !preview || preview.employees.length === 0 ? (
                                <div className="p-12 text-center text-muted-foreground">
                                    <Calculator className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                    <p className="text-lg font-medium">لا توجد بيانات</p>
                                    <p className="text-sm">لا يوجد موظفون نشطون لهذه الفترة</p>
                                </div>
                            ) : (
                                <>
                                    <div className="grid gap-4 md:grid-cols-3 mb-6">
                                        <div className="p-4 bg-emerald-500/10 rounded-lg border border-emerald-500/30">
                                            <p className="text-sm text-muted-foreground mb-1">إجمالي الرواتب</p>
                                            <p className="text-2xl font-bold text-emerald-400">
                                                {preview.totals.gross.toLocaleString()} <span className="text-sm">ريال</span>
                                            </p>
                                        </div>
                                        <div className="p-4 bg-rose-500/10 rounded-lg border border-rose-500/30">
                                            <p className="text-sm text-muted-foreground mb-1">الاستقطاعات</p>
                                            <p className="text-2xl font-bold text-rose-400">
                                                {preview.totals.deductions.toLocaleString()} <span className="text-sm">ريال</span>
                                            </p>
                                        </div>
                                        <div className="p-4 bg-blue-500/10 rounded-lg border border-blue-500/30">
                                            <p className="text-sm text-muted-foreground mb-1">صافي الدفع</p>
                                            <p className="text-2xl font-bold text-blue-400">
                                                {preview.totals.net.toLocaleString()} <span className="text-sm">ريال</span>
                                            </p>
                                        </div>
                                    </div>

                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead>الموظف</TableHead>
                                                    <TableHead>القسم</TableHead>
                                                    <TableHead className="text-right">الأساسي</TableHead>
                                                    <TableHead className="text-right">البدلات</TableHead>
                                                    <TableHead className="text-right">الإضافي</TableHead>
                                                    <TableHead className="text-right">الخصومات</TableHead>
                                                    <TableHead className="text-right">الإجمالي</TableHead>
                                                    <TableHead className="text-right">الصافي</TableHead>
                                                    <TableHead></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {preview.employees.map((employee) => (
                                                    <TableRow key={employee.employeeId} className="hover:bg-muted/50">
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-xs font-semibold">
                                                                    {employee.name.charAt(0).toUpperCase()}
                                                                </div>
                                                                <div>
                                                                    <div className="font-medium">{employee.name}</div>
                                                                    <div className="text-xs text-muted-foreground">{employee.employeeCode || '—'}</div>
                                                                </div>
                                                            </div>
                                                        </TableCell>
                                                        <TableCell>
                                                            <div className="flex items-center gap-2">
                                                                <Building2 className="h-4 w-4 text-muted-foreground" />
                                                                {employee.department || '—'}
                                                            </div>
                                                        </TableCell>
                                                        <TableCell className="text-right font-medium">
                                                            {employee.baseSalary.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right text-emerald-600">
                                                            +{employee.allowanceTotal.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right text-amber-600">
                                                            +{employee.overtimeAmount.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right text-rose-600">
                                                            -{employee.deductions.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right font-semibold">
                                                            {employee.gross.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell className="text-right font-bold text-blue-600">
                                                            {employee.net.toLocaleString()}
                                                        </TableCell>
                                                        <TableCell>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => handleViewSlip(employee)}
                                                                className="gap-2"
                                                            >
                                                                <Eye className="h-4 w-4" />
                                                                قسيمة
                                                            </Button>
                                                        </TableCell>
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

                {/* Payroll History */}
                <TabsContent value="history">
                    <Card className="border-border/60 bg-card">
                        <CardHeader>
                            <CardTitle>سجل الدورات السابقة</CardTitle>
                            <CardDescription>جميع دورات الرواتب المعتمدة</CardDescription>
                        </CardHeader>
                        <CardContent>
                            {runsLoading ? (
                                <div className="p-12 text-center text-muted-foreground">جارٍ التحميل...</div>
                            ) : payrollRuns.length === 0 ? (
                                <div className="p-12 text-center text-muted-foreground">
                                    <FileText className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                    <p>لا توجد دورات سابقة</p>
                                </div>
                            ) : (
                                <div className="grid gap-3 md:grid-cols-2">
                                    {payrollRuns.map((run) => (
                                        <Card
                                            key={run.id}
                                            className="border-border/60 hover:border-teal-500/50 transition-all cursor-pointer"
                                        >
                                            <CardContent className="p-4">
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className="font-semibold text-lg">{run.periodCode}</p>
                                                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                                            <Clock className="h-3 w-3" />
                                                            {run.processedOn ? format(new Date(run.processedOn), 'PPP', { locale: ar }) : 'غير محدد'}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground mt-1">
                                                            {run.employeeCount || 0} موظف
                                                        </p>
                                                    </div>
                                                    <div className="text-left">
                                                        <p className="font-bold text-xl text-blue-600">
                                                            {run.totalNet?.toLocaleString()}
                                                        </p>
                                                        <p className="text-xs text-muted-foreground">{run.currency || 'SAR'}</p>
                                                        <Badge className={`text-[10px] px-2 py-0.5 mt-2 ${STATUS_BADGES[run.status]}`}>
                                                            {run.status === 'paid' ? 'مدفوع' :
                                                             run.status === 'approved' ? 'معتمد' :
                                                             run.status === 'calculated' ? 'محسوب' : 'مسودة'}
                                                        </Badge>
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

                {/* Summary */}
                <TabsContent value="summary">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Card className="border-border/60 bg-card">
                            <CardHeader>
                                <CardTitle>ملخص البدلات</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
                                    <span className="text-sm font-medium">إجمالي البدلات</span>
                                    <span className="text-lg font-bold text-emerald-500">
                                        {preview?.totals.allowances.toLocaleString() || 0} ريال
                                    </span>
                                </div>
                                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
                                    <span className="text-sm font-medium">العمل الإضافي</span>
                                    <span className="text-lg font-bold text-amber-500">
                                        {preview?.totals.overtime.toLocaleString() || 0} ريال
                                    </span>
                                </div>
                            </CardContent>
                        </Card>

                        <Card className="border-border/60 bg-card">
                            <CardHeader>
                                <CardTitle>ملخص الاستقطاعات</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
                                    <span className="text-sm font-medium">إجمالي الاستقطاعات</span>
                                    <span className="text-lg font-bold text-rose-500">
                                        {preview?.totals.deductions.toLocaleString() || 0} ريال
                                    </span>
                                </div>
                                <div className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
                                    <span className="text-sm font-medium">خصم الغياب</span>
                                    <span className="text-lg font-bold text-rose-500">
                                        {preview?.totals.absence.toLocaleString() || 0} ريال
                                    </span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Salary Slip Dialog */}
            <Dialog open={salarySlipDialogOpen} onOpenChange={setSalarySlipDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Receipt className="h-5 w-5" />
                            قسيمة راتب
                        </DialogTitle>
                        <DialogDescription>
                            {selectedPeriod.year} - {['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'][selectedPeriod.month - 1]}
                        </DialogDescription>
                    </DialogHeader>
                    
                    {selectedEmployee && (
                        <div className="space-y-6 py-4">
                            {/* Employee Info */}
                            <div className="grid grid-cols-2 gap-4 p-4 bg-muted/30 rounded-lg">
                                <div>
                                    <p className="text-xs text-muted-foreground">الموظف</p>
                                    <p className="font-semibold">{selectedEmployee.name}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">القسم</p>
                                    <p className="font-semibold">{selectedEmployee.department || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">الرقم الوظيفي</p>
                                    <p className="font-semibold">{selectedEmployee.employeeCode || '—'}</p>
                                </div>
                                <div>
                                    <p className="text-xs text-muted-foreground">أيام الغياب</p>
                                    <p className="font-semibold">{selectedEmployee.absenceDays}</p>
                                </div>
                            </div>

                            {/* Earnings */}
                            <div>
                                <h3 className="font-semibold mb-3 flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4 text-emerald-500" />
                                    المستحقات
                                </h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between p-2 bg-muted/20 rounded">
                                        <span className="text-sm">الراتب الأساسي</span>
                                        <span className="font-medium">{selectedEmployee.baseSalary.toLocaleString()} ريال</span>
                                    </div>
                                    <div className="flex justify-between p-2 bg-muted/20 rounded">
                                        <span className="text-sm">البدلات</span>
                                        <span className="font-medium text-emerald-600">+{selectedEmployee.allowanceTotal.toLocaleString()} ريال</span>
                                    </div>
                                    <div className="flex justify-between p-2 bg-muted/20 rounded">
                                        <span className="text-sm">العمل الإضافي</span>
                                        <span className="font-medium text-amber-600">+{selectedEmployee.overtimeAmount.toLocaleString()} ريال</span>
                                    </div>
                                </div>
                            </div>

                            {/* Deductions */}
                            <div>
                                <h3 className="font-semibold mb-3 flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4 text-rose-500" />
                                    الاستقطاعات
                                </h3>
                                <div className="space-y-2">
                                    <div className="flex justify-between p-2 bg-muted/20 rounded">
                                        <span className="text-sm">الاستقطاعات العامة</span>
                                        <span className="font-medium text-rose-600">-{selectedEmployee.deductions.toLocaleString()} ريال</span>
                                    </div>
                                    <div className="flex justify-between p-2 bg-muted/20 rounded">
                                        <span className="text-sm">خصم الغياب</span>
                                        <span className="font-medium text-rose-600">-{selectedEmployee.absenceAmount.toLocaleString()} ريال</span>
                                    </div>
                                </div>
                            </div>

                            {/* Totals */}
                            <div className="border-t pt-4 space-y-2">
                                <div className="flex justify-between text-lg">
                                    <span className="font-semibold">الإجمالي</span>
                                    <span className="font-bold">{selectedEmployee.gross.toLocaleString()} ريال</span>
                                </div>
                                <div className="flex justify-between text-xl p-3 bg-blue-500/10 rounded-lg">
                                    <span className="font-bold">صافي الراتب</span>
                                    <span className="font-bold text-blue-600">{selectedEmployee.net.toLocaleString()} ريال</span>
                                </div>
                            </div>

                            <div className="flex gap-2 pt-4">
                                <Button variant="outline" onClick={() => setSalarySlipDialogOpen(false)} className="flex-1">
                                    إغلاق
                                </Button>
                                <Button onClick={handlePrintSlip} className="flex-1 gap-2">
                                    <FileText className="h-4 w-4" />
                                    طباعة
                                </Button>
                            </div>
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};
