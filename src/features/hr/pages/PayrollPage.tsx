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
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { getPayrollRuns } from '@/services/hr/hr-service';
import { calculatePayrollPreview, processPayrollRun } from '@/services/hr/payroll-engine';
import { STATUS_BADGES } from '../types';

export const PayrollPage: React.FC = () => {
    const { t } = useTranslation();
    const { toast } = useToast();
    const queryClient = useQueryClient();
    const initialDate = React.useMemo(() => new Date(), []);
    const [selectedPeriod, setSelectedPeriod] = React.useState(() => ({
        year: initialDate.getFullYear(),
        month: initialDate.getMonth() + 1,
    }));

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
            toast({ title: t('hr.payrollProcessing.lockSuccess') });
            refetchPreview();
            queryClient.invalidateQueries({ queryKey: ['hr', 'payroll-runs'] });
        },
        onError: (error: any) => {
            toast({
                title: t('messages.operationFailed'),
                description: error?.message ?? '',
                variant: 'destructive',
            });
        },
    });

    const handlePeriodChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.target.value;
        if (!value) return;
        const [yearPart, monthPart] = value.split('-').map((part) => parseInt(part, 10));
        if (!Number.isNaN(yearPart) && !Number.isNaN(monthPart)) {
            setSelectedPeriod({ year: yearPart, month: monthPart });
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">إدارة الرواتب</h1>
                    <p className="text-muted-foreground">
                        معالجة مسيرات الرواتب الشهرية، البدلات، والاستقطاعات.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Input
                        type="month"
                        className="w-48"
                        value={`${selectedPeriod.year}-${String(selectedPeriod.month).padStart(2, '0')}`}
                        onChange={handlePeriodChange}
                    />
                    <Button
                        onClick={() => processPayrollMutation.mutate()}
                        disabled={processPayrollMutation.isPending || preview?.locked}
                    >
                        {processPayrollMutation.isPending ? 'جارٍ المعالجة...' : 'اعتماد الرواتب'}
                    </Button>
                </div>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <Card className="border-border/60">
                    <CardHeader>
                        <CardTitle>ملخص الدورة الحالية</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="p-4 bg-slate-50 rounded-lg">
                                <p className="text-sm text-muted-foreground">إجمالي الرواتب</p>
                                <p className="text-2xl font-bold text-emerald-600">
                                    {preview?.totals?.gross?.toLocaleString() ?? 0}
                                </p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg">
                                <p className="text-sm text-muted-foreground">صافي الدفع</p>
                                <p className="text-2xl font-bold text-blue-600">
                                    {preview?.totals?.net?.toLocaleString() ?? 0}
                                </p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg">
                                <p className="text-sm text-muted-foreground">الاستقطاعات</p>
                                <p className="text-xl font-semibold text-rose-600">
                                    {preview?.totals?.deductions?.toLocaleString() ?? 0}
                                </p>
                            </div>
                            <div className="p-4 bg-slate-50 rounded-lg">
                                <p className="text-sm text-muted-foreground">العمل الإضافي</p>
                                <p className="text-xl font-semibold text-amber-600">
                                    {preview?.totals?.overtime?.toLocaleString() ?? 0}
                                </p>
                            </div>
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-border/60">
                    <CardHeader>
                        <CardTitle>سجل الدورات السابقة</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {runsLoading ? (
                                <p className="text-muted-foreground text-sm">جارٍ التحميل...</p>
                            ) : payrollRuns.length === 0 ? (
                                <p className="text-muted-foreground text-sm">لا توجد دورات سابقة.</p>
                            ) : (
                                payrollRuns.map((run) => (
                                    <div
                                        key={run.id}
                                        className="flex items-center justify-between p-3 border rounded-md hover:bg-slate-50"
                                    >
                                        <div>
                                            <p className="font-medium">{run.periodCode}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {run.runDate ? format(new Date(run.runDate), 'PPP', { locale: ar }) : ''}
                                            </p>
                                        </div>
                                        <div className="text-left">
                                            <p className="font-medium text-sm">{run.totalNet?.toLocaleString()} {run.currency}</p>
                                            <Badge className={`text-[10px] px-1.5 py-0 ${STATUS_BADGES[run.status]}`}>
                                                {run.status}
                                            </Badge>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
