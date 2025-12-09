// src/features/hr/pages/DashboardPage.tsx
// بسم الله الرحمن الرحيم
// لوحة تحكم الموارد البشرية المحسنة

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
    getHrDashboardMetrics, 
    getAttendanceLogs, 
    getPayrollRuns,
    getEmployees,
    getLeaveRequests 
} from '@/services/hr/hr-service';
import { ATTENDANCE_COLORS, STATUS_BADGES } from '../types';
import { 
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts';
import {
    Users, UserCheck, UserX, Clock, TrendingUp, TrendingDown,
    Calendar, DollarSign, AlertCircle
} from 'lucide-react';
import { format, subDays } from 'date-fns';
import { ar } from 'date-fns/locale';

const CHART_COLORS = {
    primary: '#14b8a6', // teal-500
    secondary: '#06b6d4', // cyan-500
    success: '#10b981', // emerald-500
    warning: '#f59e0b', // amber-500
    danger: '#ef4444', // rose-500
    info: '#3b82f6', // blue-500
    purple: '#a855f7', // purple-500
    pink: '#ec4899', // pink-500
};

const PIE_COLORS = [
    CHART_COLORS.success,
    CHART_COLORS.danger,
    CHART_COLORS.warning,
    CHART_COLORS.info,
    CHART_COLORS.purple,
    CHART_COLORS.secondary,
];

export const DashboardPage: React.FC = () => {
    // جلب البيانات
    const { data: metrics, isLoading: metricsLoading } = useQuery({
        queryKey: ['hr', 'metrics'],
        queryFn: getHrDashboardMetrics,
        staleTime: 60_000,
    });

    const { data: attendanceLogs = [], isLoading: attendanceLoading } = useQuery({
        queryKey: ['hr', 'attendance', 'all'],
        queryFn: () => getAttendanceLogs(90), // آخر 90 يوم
    });

    const { data: employees = [] } = useQuery({
        queryKey: ['hr', 'employees'],
        queryFn: getEmployees,
    });

    const { data: payrollRuns = [] } = useQuery({
        queryKey: ['hr', 'payroll-runs'],
        queryFn: () => getPayrollRuns(12), // آخر 12 شهر
    });

    const { data: leaveRequests = [] } = useQuery({
        queryKey: ['hr', 'leaves'],
        queryFn: () => getLeaveRequests(100),
    });

    // حساب الإحصائيات المتقدمة
    const dashboardStats = React.useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        const todaysAttendance = attendanceLogs.filter(log => log.date?.startsWith(today));
        
        const activeEmployees = employees.filter(e => e.status === 'active').length;
        const totalEmployees = employees.length;
        const attendanceRate = todaysAttendance.length > 0 
            ? ((todaysAttendance.filter(a => a.status === 'present').length / activeEmployees) * 100).toFixed(1)
            : '0.0';

        const pendingLeaves = leaveRequests.filter(l => l.status === 'pending').length;
        const approvedLeaves = leaveRequests.filter(l => l.status === 'approved').length;

        return {
            totalEmployees,
            activeEmployees,
            inactiveEmployees: totalEmployees - activeEmployees,
            attendanceRate,
            todaysPresent: todaysAttendance.filter(a => a.status === 'present').length,
            todaysAbsent: todaysAttendance.filter(a => a.status === 'absent').length,
            todaysLate: todaysAttendance.filter(a => a.status === 'late').length,
            pendingLeaves,
            approvedLeaves,
            totalLeaveRequests: leaveRequests.length,
        };
    }, [employees, attendanceLogs, leaveRequests]);

    // بيانات الحضور حسب الأسبوع
    const weeklyAttendanceData = React.useMemo(() => {
        const last7Days = Array.from({ length: 7 }, (_, i) => {
            const date = subDays(new Date(), 6 - i);
            const dateStr = format(date, 'yyyy-MM-dd');
            const dayLogs = attendanceLogs.filter(log => log.date?.startsWith(dateStr));
            
            return {
                date: format(date, 'EEE', { locale: ar }),
                fullDate: dateStr,
                present: dayLogs.filter(l => l.status === 'present').length,
                absent: dayLogs.filter(l => l.status === 'absent').length,
                late: dayLogs.filter(l => l.status === 'late').length,
                leave: dayLogs.filter(l => l.status === 'leave').length,
            };
        });
        return last7Days;
    }, [attendanceLogs]);

    // بيانات الرواتب حسب الشهر (آخر 6 أشهر)
    const monthlyPayrollData = React.useMemo(() => {
        return payrollRuns.slice(0, 6).reverse().map(run => ({
            period: run.periodCode,
            gross: run.totalGross || 0,
            deductions: run.totalDeductions || 0,
            net: run.totalNet || 0,
        }));
    }, [payrollRuns]);

    // توزيع حالة الموظفين
    const employeeStatusData = React.useMemo(() => {
        const statusCount: Record<string, number> = {};
        employees.forEach(emp => {
            statusCount[emp.status] = (statusCount[emp.status] || 0) + 1;
        });
        return Object.entries(statusCount).map(([name, value]) => ({ name, value }));
    }, [employees]);

    // توزيع الحضور
    const attendanceDistributionData = React.useMemo(() => {
        const statusCount: Record<string, number> = {};
        attendanceLogs.forEach(log => {
            statusCount[log.status] = (statusCount[log.status] || 0) + 1;
        });
        return Object.entries(statusCount).map(([name, value]) => ({ name, value }));
    }, [attendanceLogs]);

    const todaysAttendance = React.useMemo(() => {
        const today = new Date().toISOString().split('T')[0];
        return attendanceLogs.filter((log) => log.date?.startsWith(today)).slice(0, 10);
    }, [attendanceLogs]);

    // KPI Cards
    const kpiCards = [
        {
            label: 'إجمالي الموظفين',
            value: dashboardStats.totalEmployees,
            change: '+0%',
            trend: 'up' as const,
            icon: Users,
            color: 'text-teal-500',
            bgColor: 'bg-teal-500/10',
        },
        {
            label: 'الموظفون النشطون',
            value: dashboardStats.activeEmployees,
            change: `${((dashboardStats.activeEmployees / dashboardStats.totalEmployees) * 100).toFixed(0)}%`,
            trend: 'up' as const,
            icon: UserCheck,
            color: 'text-emerald-500',
            bgColor: 'bg-emerald-500/10',
        },
        {
            label: 'معدل الحضور اليوم',
            value: `${dashboardStats.attendanceRate}%`,
            change: dashboardStats.todaysPresent.toString(),
            trend: Number(dashboardStats.attendanceRate) > 90 ? 'up' : 'down',
            icon: Clock,
            color: 'text-blue-500',
            bgColor: 'bg-blue-500/10',
        },
        {
            label: 'طلبات الإجازة',
            value: dashboardStats.pendingLeaves,
            change: `${dashboardStats.totalLeaveRequests} إجمالي`,
            trend: 'neutral' as const,
            icon: Calendar,
            color: 'text-amber-500',
            bgColor: 'bg-amber-500/10',
        },
    ];

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-2">
                <h1 className="text-3xl font-bold tracking-tight">لوحة التحكم - الموارد البشرية</h1>
                <p className="text-muted-foreground">
                    نظرة شاملة على أداء الموارد البشرية، الحضور، والرواتب.
                </p>
            </div>

            {/* KPI Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {kpiCards.map((card) => {
                    const Icon = card.icon;
                    const TrendIcon = card.trend === 'up' ? TrendingUp : card.trend === 'down' ? TrendingDown : AlertCircle;
                    
                    return (
                        <Card key={card.label} className="border-border/60 bg-card shadow-sm hover:shadow-lg transition-all duration-300">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium text-muted-foreground">
                                    {card.label}
                                </CardTitle>
                                <div className={`${card.bgColor} p-2 rounded-lg`}>
                                    <Icon className={`h-4 w-4 ${card.color}`} />
                                </div>
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">
                                    {metricsLoading ? '...' : card.value}
                                </div>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                    <TrendIcon className={`h-3 w-3 ${
                                        card.trend === 'up' ? 'text-emerald-500' : 
                                        card.trend === 'down' ? 'text-rose-500' : 
                                        'text-amber-500'
                                    }`} />
                                    <span>{card.change}</span>
                                </div>
                            </CardContent>
                        </Card>
                    );
                })}
            </div>

            {/* Charts Section */}
            <Tabs defaultValue="attendance" className="space-y-4">
                <TabsList className="grid w-full grid-cols-3 lg:w-[600px]">
                    <TabsTrigger value="attendance">الحضور</TabsTrigger>
                    <TabsTrigger value="payroll">الرواتب</TabsTrigger>
                    <TabsTrigger value="distribution">التوزيع</TabsTrigger>
                </TabsList>

                {/* Attendance Charts */}
                <TabsContent value="attendance" className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                        <Card className="border-border/60 bg-card">
                            <CardHeader>
                                <CardTitle>الحضور الأسبوعي</CardTitle>
                                <CardDescription>آخر 7 أيام</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <AreaChart data={weeklyAttendanceData}>
                                        <defs>
                                            <linearGradient id="colorPresent" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={CHART_COLORS.success} stopOpacity={0.8}/>
                                                <stop offset="95%" stopColor={CHART_COLORS.success} stopOpacity={0}/>
                                            </linearGradient>
                                            <linearGradient id="colorAbsent" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={CHART_COLORS.danger} stopOpacity={0.8}/>
                                                <stop offset="95%" stopColor={CHART_COLORS.danger} stopOpacity={0}/>
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} />
                                        <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                                        <YAxis stroke="#94a3b8" fontSize={12} />
                                        <Tooltip 
                                            contentStyle={{ 
                                                backgroundColor: '#1e293b', 
                                                border: '1px solid #334155',
                                                borderRadius: '8px' 
                                            }} 
                                        />
                                        <Legend />
                                        <Area type="monotone" dataKey="present" stroke={CHART_COLORS.success} fillOpacity={1} fill="url(#colorPresent)" name="حاضر" />
                                        <Area type="monotone" dataKey="absent" stroke={CHART_COLORS.danger} fillOpacity={1} fill="url(#colorAbsent)" name="غائب" />
                                        <Area type="monotone" dataKey="late" stroke={CHART_COLORS.warning} fill={CHART_COLORS.warning} fillOpacity={0.3} name="متأخر" />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-border/60 bg-card">
                            <CardHeader>
                                <CardTitle>حضور اليوم</CardTitle>
                                <CardDescription>{todaysAttendance.length} سجل</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                                    {todaysAttendance.length === 0 && (
                                        <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                                            <div className="text-center">
                                                <Clock className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                                <p>لا توجد سجلات حضور لليوم</p>
                                            </div>
                                        </div>
                                    )}
                                    {todaysAttendance.map((log) => (
                                        <div
                                            key={log.id}
                                            className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-sm hover:bg-muted/50 transition-colors"
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className={`w-2 h-2 rounded-full ${
                                                    log.status === 'present' ? 'bg-emerald-500' :
                                                    log.status === 'absent' ? 'bg-rose-500' :
                                                    log.status === 'late' ? 'bg-amber-500' :
                                                    'bg-blue-500'
                                                }`} />
                                                <div>
                                                    <p className="font-medium">
                                                        {log.employeeName || log.employeeId || '—'}
                                                    </p>
                                                    <p className="text-xs text-muted-foreground">
                                                        {log.checkIn ? format(new Date(log.checkIn), 'hh:mm a') : '--'}
                                                    </p>
                                                </div>
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
                    </div>
                </TabsContent>

                {/* Payroll Charts */}
                <TabsContent value="payroll" className="space-y-4">
                    <Card className="border-border/60 bg-card">
                        <CardHeader>
                            <CardTitle>تحليل الرواتب الشهري</CardTitle>
                            <CardDescription>آخر 6 أشهر</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={350}>
                                <BarChart data={monthlyPayrollData}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.1} />
                                    <XAxis dataKey="period" stroke="#94a3b8" fontSize={12} />
                                    <YAxis stroke="#94a3b8" fontSize={12} />
                                    <Tooltip 
                                        contentStyle={{ 
                                            backgroundColor: '#1e293b', 
                                            border: '1px solid #334155',
                                            borderRadius: '8px' 
                                        }}
                                        formatter={(value: number) => [`${value.toLocaleString()} ريال`, '']}
                                    />
                                    <Legend />
                                    <Bar dataKey="gross" fill={CHART_COLORS.primary} name="الإجمالي" radius={[8, 8, 0, 0]} />
                                    <Bar dataKey="deductions" fill={CHART_COLORS.warning} name="الخصومات" radius={[8, 8, 0, 0]} />
                                    <Bar dataKey="net" fill={CHART_COLORS.success} name="الصافي" radius={[8, 8, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Distribution Charts */}
                <TabsContent value="distribution" className="space-y-4">
                    <div className="grid gap-4 lg:grid-cols-2">
                        <Card className="border-border/60 bg-card">
                            <CardHeader>
                                <CardTitle>توزيع حالة الموظفين</CardTitle>
                                <CardDescription>{employees.length} موظف</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <PieChart>
                                        <Pie
                                            data={employeeStatusData}
                                            cx="50%"
                                            cy="50%"
                                            labelLine={false}
                                            label={(entry) => `${entry.name}: ${entry.value}`}
                                            outerRadius={80}
                                            fill="#8884d8"
                                            dataKey="value"
                                        >
                                            {employeeStatusData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ 
                                                backgroundColor: '#1e293b', 
                                                border: '1px solid #334155',
                                                borderRadius: '8px' 
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>

                        <Card className="border-border/60 bg-card">
                            <CardHeader>
                                <CardTitle>توزيع الحضور</CardTitle>
                                <CardDescription>آخر 90 يوم</CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <PieChart>
                                        <Pie
                                            data={attendanceDistributionData}
                                            cx="50%"
                                            cy="50%"
                                            labelLine={false}
                                            label={(entry) => `${entry.name}: ${entry.value}`}
                                            outerRadius={80}
                                            fill="#8884d8"
                                            dataKey="value"
                                        >
                                            {attendanceDistributionData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ 
                                                backgroundColor: '#1e293b', 
                                                border: '1px solid #334155',
                                                borderRadius: '8px' 
                                            }}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Recent Payroll Runs */}
            <Card className="border-border/60 bg-card shadow-sm">
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle>دورات الرواتب الأخيرة</CardTitle>
                        <CardDescription>آخر 6 دورات</CardDescription>
                    </div>
                    <Button variant="outline" size="sm">
                        <DollarSign className="h-4 w-4 ml-2" />
                        تشغيل دورة جديدة
                    </Button>
                </CardHeader>
                <CardContent>
                    <div className="space-y-3">
                        {payrollRuns.length === 0 && (
                            <div className="flex items-center justify-center h-32 text-muted-foreground">
                                <div className="text-center">
                                    <DollarSign className="h-12 w-12 mx-auto mb-2 opacity-50" />
                                    <p>لا توجد دورات رواتب مسجلة</p>
                                </div>
                            </div>
                        )}
                        {payrollRuns.slice(0, 6).map((run) => (
                            <div
                                key={run.id}
                                className="flex items-center justify-between rounded-md border border-border/60 p-3 text-sm hover:bg-muted/50 transition-colors"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`w-2 h-2 rounded-full ${
                                        run.status === 'paid' ? 'bg-emerald-500' :
                                        run.status === 'approved' ? 'bg-blue-500' :
                                        run.status === 'calculated' ? 'bg-amber-500' :
                                        'bg-slate-500'
                                    }`} />
                                    <div>
                                        <p className="font-semibold">{run.periodCode}</p>
                                        <p className="text-xs text-muted-foreground">
                                            {run.employeeCount || 0} موظف · {run.totalNet?.toLocaleString() ?? 0} {run.currency || 'SAR'}
                                        </p>
                                    </div>
                                </div>
                                <Badge
                                    className={`capitalize ${STATUS_BADGES[run.status] ?? 'bg-muted text-muted-foreground'}`}
                                >
                                    {run.status}
                                </Badge>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
