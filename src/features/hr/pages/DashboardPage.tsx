import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { getHrDashboardMetrics, getAttendanceLogs, getPayrollRuns } from '@/services/hr/hr-service';
import { ATTENDANCE_COLORS, STATUS_BADGES } from '../types';

export const DashboardPage: React.FC = () => {
    const { data: metrics, isLoading: metricsLoading } = useQuery({
        queryKey: ['hr', 'metrics'],
        queryFn: getHrDashboardMetrics,
        staleTime: 60_000,
    });

    const { data: attendanceLogs = [], isLoading: attendanceLoading } = useQuery({
        queryKey: ['hr', 'attendance'],
        queryFn: () => getAttendanceLogs(60),
    });

    const { data: payrollRuns = [], isLoading: payrollLoading } = useQuery({
        queryKey: ['hr', 'payroll-runs'],
        queryFn: () => getPayrollRuns(6),
    });

    const todaysAttendance = React.useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return attendanceLogs.filter((log) => log.date?.startsWith(today)).slice(0, 10);
    }, [attendanceLogs]);

    const attendanceStats = React.useMemo(() => {
        return attendanceLogs.reduce(
            (acc, log) => {
                acc[log.status] = (acc[log.status] || 0) + 1;
                return acc;
            },
            {} as Record<string, number>,
        );
    }, [attendanceLogs]);

    return (
        <div className="space-y-6">
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">لوحة التحكم</h1>
                <p className="text-muted-foreground">
                    نظرة عامة على أداء الموارد البشرية، الحضور، والرواتب.
                </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[
                    {
                        label: 'إجمالي الموظفين',
                        value: metrics?.totalEmployees ?? 0,
                        description: 'جميع الحالات والمواقع',
                    },
                    {
                        label: 'الموظفون النشطون',
                        value: metrics?.activeEmployees ?? 0,
                        description: 'على رأس العمل',
                    },
                    {
                        label: 'طلبات إجازة معلقة',
                        value: metrics?.pendingLeaves ?? 0,
                        description: 'تحتاج لاعتماد',
                    },
                    {
                        label: 'تنبيهات مفتوحة',
                        value: metrics?.openAlerts ?? 0,
                        description: 'أولوية المراجعة',
                    },
                ].map((card) => (
                    <Card key={card.label} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
                        <CardHeader className="space-y-1">
                            <p className="text-sm text-muted-foreground">{card.label}</p>
                            <p className="text-3xl font-semibold">
                                {metricsLoading ? '...' : card.value.toLocaleString()}
                            </p>
                        </CardHeader>
                        <CardContent>
                            <p className="text-xs text-muted-foreground">{card.description}</p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
                <Card className="border-border/60 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-lg">حضور اليوم</CardTitle>
                        <Badge variant="outline" className="font-normal">
                            {attendanceLoading ? 'جارٍ التحميل' : `${todaysAttendance.length} سجلات`}
                        </Badge>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex flex-wrap gap-3">
                            {Object.entries(attendanceStats).map(([status, count]) => (
                                <div
                                    key={status}
                                    className={`rounded-full px-3 py-1 text-xs font-medium ${ATTENDANCE_COLORS[status] ?? 'bg-muted text-muted-foreground border border-border'}`}
                                >
                                    {status} • {count}
                                </div>
                            ))}
                        </div>
                        <div className="space-y-2">
                            {todaysAttendance.length === 0 && (
                                <p className="text-sm text-muted-foreground">
                                    لا توجد سجلات حضور لليوم الحالي.
                                </p>
                            )}
                            {todaysAttendance.map((log) => (
                                <div
                                    key={log.id}
                                    className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                                >
                                    <div>
                                        <p className="font-medium">
                                            {log.employeeName || log.employeeId || '—'}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            دخول {log.checkIn ? new Date(log.checkIn).toLocaleTimeString() : '--'} ·
                                            خروج {log.checkOut ? new Date(log.checkOut).toLocaleTimeString() : '--'}
                                        </p>
                                    </div>
                                    <Badge
                                        className={`capitalize ${ATTENDANCE_COLORS[log.status] ?? 'bg-muted text-muted-foreground'}`}
                                    >
                                        {log.status}
                                    </Badge>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>

                <Card className="border-border/60 shadow-sm">
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle className="text-lg">حالة الرواتب</CardTitle>
                        <Button variant="outline" size="sm">
                            تشغيل دورة جديدة
                        </Button>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        {payrollLoading && <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>}
                        {!payrollLoading && payrollRuns.length === 0 && (
                            <p className="text-sm text-muted-foreground">لا توجد دورات رواتب مسجلة.</p>
                        )}
                        {payrollRuns.map((run) => (
                            <div
                                key={run.id}
                                className="flex items-start justify-between rounded-md border border-border/60 p-3 text-sm hover:bg-muted/50 transition-colors"
                            >
                                <div>
                                    <p className="font-semibold">{run.periodCode}</p>
                                    <p className="text-xs text-muted-foreground">
                                        صافي الرواتب {run.totalNet?.toLocaleString() ?? 0} {run.currency || 'SAR'}
                                    </p>
                                </div>
                                <Badge
                                    className={`capitalize ${STATUS_BADGES[run.status] ?? 'bg-muted text-muted-foreground'}`}
                                >
                                    {run.status}
                                </Badge>
                            </div>
                        ))}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};
