// src/features/hr/pages/AttendancePage.tsx
// بسم الله الرحمن الرحيم
// صفحة الحضور والانصراف المحسّنة

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { getEmployees } from '@/services/hr/hr-service';
import { listAttendanceForPeriod } from '@/services/hr/attendance-service';
import { ATTENDANCE_COLORS } from '../types';
import { 
    Calendar, Clock, UserCheck, UserX, AlertCircle, 
    Download, Plus, TrendingUp, CheckCircle, 
    XCircle, Timer, CalendarDays, Users
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';

export const AttendancePage: React.FC = () => {
    const { toast } = useToast();
    const initialDate = React.useMemo(() => new Date(), []);
    const [selectedPeriod, setSelectedPeriod] = React.useState(() => ({
        year: initialDate.getFullYear(),
        month: initialDate.getMonth() + 1,
    }));
    const [checkInDialogOpen, setCheckInDialogOpen] = React.useState(false);
    const [selectedEmployee, setSelectedEmployee] = React.useState<string>('');
    const [checkInTime, setCheckInTime] = React.useState(format(new Date(), 'HH:mm'));
    const [checkOutTime, setCheckOutTime] = React.useState('');
    const [notes, setNotes] = React.useState('');

    const { data: employees = [] } = useQuery({
        queryKey: ['hr', 'employees'],
        queryFn: getEmployees,
        staleTime: 60_000,
    });

    const {
        data: monthlyAttendance = [],
        isLoading: monthlyAttendanceLoading,
    } = useQuery({
        queryKey: ['hr', 'attendance-monthly', selectedPeriod.year, selectedPeriod.month],
        queryFn: async () => {
            if (!employees.length) return [];
            return listAttendanceForPeriod(
                employees.map((employee) => employee.id),
                selectedPeriod.year,
                selectedPeriod.month,
            );
        },
        enabled: employees.length > 0,
    });

    // Statistics
    const stats = React.useMemo(() => {
        const today = format(new Date(), 'yyyy-MM-dd');
        let presentToday = 0;
        let absentToday = 0;
        let lateToday = 0;
        let totalPresent = 0;
        let totalAbsent = 0;
        let totalLate = 0;

        monthlyAttendance.forEach((record: any) => {
            const days = record.days || {};
            Object.entries(days).forEach(([day, data]: [string, any]) => {
                const dateStr = `${selectedPeriod.year}-${String(selectedPeriod.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                
                if (data.status === 'present') totalPresent++;
                if (data.status === 'absent') totalAbsent++;
                if (data.status === 'late') totalLate++;

                if (dateStr === today) {
                    if (data.status === 'present') presentToday++;
                    if (data.status === 'absent') absentToday++;
                    if (data.status === 'late') lateToday++;
                }
            });
        });

        const activeEmployees = employees.filter(e => e.status === 'active').length;
        const attendanceRate = activeEmployees > 0 
            ? ((presentToday / activeEmployees) * 100).toFixed(1)
            : '0.0';

        return {
            presentToday,
            absentToday,
            lateToday,
            totalPresent,
            totalAbsent,
            totalLate,
            attendanceRate,
            activeEmployees,
        };
    }, [monthlyAttendance, employees, selectedPeriod]);

    const daysInMonth = React.useMemo(() => {
        const { year, month } = selectedPeriod;
        return new Date(year, month, 0).getDate();
    }, [selectedPeriod]);

    const daysArray = React.useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth]);

    const monthlyAttendanceMap = React.useMemo(() => {
        const map = new Map<string, Record<string, any>>();
        (monthlyAttendance ?? []).forEach((record) => {
            map.set(record.employee_id, record.days ?? {});
        });
        return map;
    }, [monthlyAttendance]);

    // Calendar view data
    const calendarDays = React.useMemo(() => {
        const start = startOfMonth(new Date(selectedPeriod.year, selectedPeriod.month - 1));
        const end = endOfMonth(start);
        return eachDayOfInterval({ start, end });
    }, [selectedPeriod]);

    const handleCheckIn = () => {
        if (!selectedEmployee) {
            toast({ title: '⚠️ يرجى اختيار موظف', variant: 'destructive' });
            return;
        }
        
        // TODO: Implement actual check-in mutation
        toast({ title: '✅ تم تسجيل الحضور بنجاح' });
        setCheckInDialogOpen(false);
        setSelectedEmployee('');
        setCheckInTime(format(new Date(), 'HH:mm'));
        setCheckOutTime('');
        setNotes('');
    };

    const handleExport = () => {
        const csvContent = [
            ['الموظف', ...daysArray.map(d => `يوم ${d}`)].join(','),
            ...employees.map(emp => {
                const empAttendance = monthlyAttendanceMap.get(emp.id) || {};
                return [
                    emp.name,
                    ...daysArray.map(day => {
                        const dayData = empAttendance[day.toString()];
                        return dayData?.status || '-';
                    })
                ].join(',');
            })
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `attendance_${selectedPeriod.year}_${selectedPeriod.month}.csv`;
        link.click();
        toast({ title: '✅ تم تصدير البيانات بنجاح' });
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">إدارة الحضور والانصراف</h1>
                    <p className="text-muted-foreground">
                        متابعة وإدارة حضور الموظفين بشكل يومي وشهري
                    </p>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" onClick={handleExport} className="gap-2">
                        <Download className="h-4 w-4" />
                        تصدير
                    </Button>
                    <Button onClick={() => setCheckInDialogOpen(true)} className="gap-2 bg-teal-600 hover:bg-teal-700">
                        <Plus className="h-4 w-4" />
                        تسجيل حضور
                    </Button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {[
                    {
                        label: 'حضور اليوم',
                        value: stats.presentToday,
                        total: stats.activeEmployees,
                        icon: UserCheck,
                        color: 'text-emerald-500',
                        bgColor: 'bg-emerald-500/10',
                    },
                    {
                        label: 'غياب اليوم',
                        value: stats.absentToday,
                        total: stats.activeEmployees,
                        icon: UserX,
                        color: 'text-rose-500',
                        bgColor: 'bg-rose-500/10',
                    },
                    {
                        label: 'تأخير اليوم',
                        value: stats.lateToday,
                        total: stats.activeEmployees,
                        icon: AlertCircle,
                        color: 'text-amber-500',
                        bgColor: 'bg-amber-500/10',
                    },
                    {
                        label: 'معدل الحضور',
                        value: `${stats.attendanceRate}%`,
                        total: 'اليوم',
                        icon: TrendingUp,
                        color: 'text-blue-500',
                        bgColor: 'bg-blue-500/10',
                    },
                ].map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <Card key={stat.label} className="border-border/60 bg-card">
                            <CardContent className="p-6">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm text-muted-foreground">{stat.label}</p>
                                        <div className="flex items-baseline gap-2 mt-1">
                                            <p className="text-2xl font-bold">{stat.value}</p>
                                            {typeof stat.total === 'number' && (
                                                <p className="text-xs text-muted-foreground">/ {stat.total}</p>
                                            )}
                                            {typeof stat.total === 'string' && (
                                                <p className="text-xs text-muted-foreground">{stat.total}</p>
                                            )}
                                        </div>
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

            {/* Period Selector */}
            <Card className="border-border/60 bg-card">
                <CardContent className="p-4">
                    <div className="flex items-center gap-4">
                        <CalendarDays className="h-5 w-5 text-muted-foreground" />
                        <div className="flex gap-2 flex-1">
                            <Select
                                value={selectedPeriod.month.toString()}
                                onValueChange={(v) => setSelectedPeriod(prev => ({ ...prev, month: Number.parseInt(v, 10) }))}
                            >
                                <SelectTrigger className="w-[180px]">
                                    <SelectValue placeholder="الشهر" />
                                </SelectTrigger>
                                <SelectContent>
                                    {[
                                        'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
                                        'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
                                    ].map((name, i) => (
                                        <SelectItem key={i + 1} value={(i + 1).toString()}>
                                            {name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <Select
                                value={selectedPeriod.year.toString()}
                                onValueChange={(v) => setSelectedPeriod(prev => ({ ...prev, year: Number.parseInt(v, 10) }))}
                            >
                                <SelectTrigger className="w-[120px]">
                                    <SelectValue placeholder="السنة" />
                                </SelectTrigger>
                                <SelectContent>
                                    {[2024, 2025, 2026].map((y) => (
                                        <SelectItem key={y} value={y.toString()}>
                                            {y}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="text-sm text-muted-foreground">
                            {employees.length} موظف · {daysInMonth} يوم
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Tabs */}
            <Tabs defaultValue="grid" className="space-y-4">
                <TabsList>
                    <TabsTrigger value="grid">عرض الشبكة</TabsTrigger>
                    <TabsTrigger value="calendar">العرض التقويمي</TabsTrigger>
                    <TabsTrigger value="summary">الملخص</TabsTrigger>
                </TabsList>

                {/* Grid View */}
                <TabsContent value="grid" className="space-y-4">
                    <Card className="border-border/60 bg-card shadow-sm overflow-hidden">
                        <CardHeader>
                            <CardTitle>جدول الحضور الشهري</CardTitle>
                            <CardDescription>
                                سجل حضور شامل لجميع الموظفين خلال الشهر
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-0">
                            <div className="overflow-x-auto">
                                <div className="min-w-[1200px]">
                                    <div className="flex border-b bg-muted/50 sticky top-0 z-10">
                                        <div className="w-48 p-3 font-semibold text-sm border-l sticky right-0 bg-muted/50 z-20">
                                            الموظف
                                        </div>
                                        {daysArray.map((day) => (
                                            <div key={day} className="w-10 p-2 text-center text-xs font-medium border-l last:border-l-0">
                                                {day}
                                            </div>
                                        ))}
                                    </div>

                                    <div className="max-h-[600px] overflow-y-auto">
                                        {monthlyAttendanceLoading ? (
                                            <div className="p-12 text-center text-muted-foreground">
                                                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-teal-500 border-r-transparent"></div>
                                                <p className="mt-4">جارٍ التحميل...</p>
                                            </div>
                                        ) : employees.length === 0 ? (
                                            <div className="p-12 text-center text-muted-foreground">
                                                <Users className="h-16 w-16 mx-auto mb-4 opacity-50" />
                                                <p>لا يوجد موظفون</p>
                                            </div>
                                        ) : (
                                            employees.map((employee) => {
                                                const empAttendance = monthlyAttendanceMap.get(employee.id) || {};
                                                return (
                                                    <div key={employee.id} className="flex border-b hover:bg-muted/30 transition-colors">
                                                        <div className="w-48 p-3 text-sm font-medium border-l sticky right-0 bg-card hover:bg-muted/30 z-10">
                                                            <div className="flex items-center gap-2">
                                                                <div className="h-8 w-8 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center text-white text-xs font-semibold">
                                                                    {employee.name.charAt(0).toUpperCase()}
                                                                </div>
                                                                <span className="truncate">{employee.name}</span>
                                                            </div>
                                                        </div>
                                                        {daysArray.map((day) => {
                                                            const dayData = empAttendance[day.toString()];
                                                            const status = dayData?.status || 'off';
                                                            const colorClass = ATTENDANCE_COLORS[status] || 'bg-muted/50 text-muted-foreground border border-border';

                                                            return (
                                                                <div key={day} className="w-10 p-1 border-l last:border-l-0 flex items-center justify-center">
                                                                    <div
                                                                        className={`w-7 h-7 rounded-md flex items-center justify-center text-xs cursor-help transition-all hover:scale-110 ${colorClass}`}
                                                                        title={`${status} - دخول: ${dayData?.in || '--'} / خروج: ${dayData?.out || '--'}`}
                                                                    >
                                                                        {status === 'present' && <CheckCircle className="h-3 w-3" />}
                                                                        {status === 'absent' && <XCircle className="h-3 w-3" />}
                                                                        {status === 'late' && <Timer className="h-3 w-3" />}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                );
                                            })
                                        )}
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Calendar View */}
                <TabsContent value="calendar">
                    <Card className="border-border/60 bg-card">
                        <CardHeader>
                            <CardTitle>العرض التقويمي</CardTitle>
                            <CardDescription>عرض الحضور بشكل تقويم شهري</CardDescription>
                        </CardHeader>
                        <CardContent>
                            <div className="grid grid-cols-7 gap-2">
                                {['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map(day => (
                                    <div key={day} className="text-center font-semibold text-sm p-2 bg-muted/50 rounded">
                                        {day}
                                    </div>
                                ))}
                                {calendarDays.map((day, idx) => {
                                    const dayNum = format(day, 'd');
                                    const isToday = isSameDay(day, new Date());
                                    
                                    let presentCount = 0;
                                    let absentCount = 0;
                                    
                                    monthlyAttendance.forEach((record: any) => {
                                        const dayData = record.days?.[dayNum];
                                        if (dayData?.status === 'present') presentCount++;
                                        if (dayData?.status === 'absent') absentCount++;
                                    });

                                    return (
                                        <Card 
                                            key={idx} 
                                            className={`p-3 ${isToday ? 'border-teal-500 border-2' : 'border-border/60'}`}
                                        >
                                            <div className="text-right font-semibold text-sm mb-2">{dayNum}</div>
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-1 text-xs">
                                                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                                                    <span>{presentCount}</span>
                                                </div>
                                                <div className="flex items-center gap-1 text-xs">
                                                    <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                                                    <span>{absentCount}</span>
                                                </div>
                                            </div>
                                        </Card>
                                    );
                                })}
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Summary View */}
                <TabsContent value="summary">
                    <div className="grid gap-4 md:grid-cols-2">
                        <Card className="border-border/60 bg-card">
                            <CardHeader>
                                <CardTitle>إحصائيات الحضور</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-4">
                                {[
                                    { label: 'إجمالي الحضور', value: stats.totalPresent, color: 'text-emerald-500' },
                                    { label: 'إجمالي الغياب', value: stats.totalAbsent, color: 'text-rose-500' },
                                    { label: 'إجمالي التأخير', value: stats.totalLate, color: 'text-amber-500' },
                                ].map(item => (
                                    <div key={item.label} className="flex justify-between items-center p-3 rounded-lg bg-muted/30">
                                        <span className="text-sm font-medium">{item.label}</span>
                                        <span className={`text-xl font-bold ${item.color}`}>{item.value}</span>
                                    </div>
                                ))}
                            </CardContent>
                        </Card>

                        <Card className="border-border/60 bg-card">
                            <CardHeader>
                                <CardTitle>Legend - دليل الألوان</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                {[
                                    { status: 'present', label: 'حاضر', icon: CheckCircle },
                                    { status: 'absent', label: 'غائب', icon: XCircle },
                                    { status: 'late', label: 'متأخر', icon: Timer },
                                    { status: 'leave', label: 'إجازة', icon: Calendar },
                                ].map(item => {
                                    const Icon = item.icon;
                                    return (
                                        <div key={item.status} className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-md flex items-center justify-center ${ATTENDANCE_COLORS[item.status]}`}>
                                                <Icon className="h-4 w-4" />
                                            </div>
                                            <span className="text-sm font-medium">{item.label}</span>
                                        </div>
                                    );
                                })}
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>

            {/* Check-in Dialog */}
            <Dialog open={checkInDialogOpen} onOpenChange={setCheckInDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>تسجيل حضور</DialogTitle>
                        <DialogDescription>
                            تسجيل حضور أو انصراف موظف
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="space-y-2">
                            <Label>الموظف</Label>
                            <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                                <SelectTrigger>
                                    <SelectValue placeholder="اختر موظف" />
                                </SelectTrigger>
                                <SelectContent>
                                    {employees.map(emp => (
                                        <SelectItem key={emp.id} value={emp.id}>
                                            {emp.name}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                                <Label>وقت الدخول</Label>
                                <Input
                                    type="time"
                                    value={checkInTime}
                                    onChange={(e) => setCheckInTime(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>وقت الخروج (اختياري)</Label>
                                <Input
                                    type="time"
                                    value={checkOutTime}
                                    onChange={(e) => setCheckOutTime(e.target.value)}
                                />
                            </div>
                        </div>
                        <div className="space-y-2">
                            <Label>ملاحظات</Label>
                            <Input
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="ملاحظات إضافية..."
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCheckInDialogOpen(false)}>
                            إلغاء
                        </Button>
                        <Button onClick={handleCheckIn} className="bg-teal-600 hover:bg-teal-700">
                            <Clock className="h-4 w-4 ml-2" />
                            تسجيل
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};
