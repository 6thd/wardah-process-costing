import React from 'react';
import { useQuery } from '@tanstack/react-query';
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from '@/components/ui/card';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getEmployees } from '@/services/hr/hr-service';
import { listAttendanceForPeriod } from '@/services/hr/attendance-service';
import { ATTENDANCE_COLORS } from '../types';

export const AttendancePage: React.FC = () => {
    const initialDate = React.useMemo(() => new Date(), []);
    const [selectedPeriod, setSelectedPeriod] = React.useState(() => ({
        year: initialDate.getFullYear(),
        month: initialDate.getMonth() + 1,
    }));

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

    return (
        <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">سجل الحضور</h1>
                    <p className="text-muted-foreground">
                        متابعة الحضور والانصراف اليومي للموظفين.
                    </p>
                </div>
                <div className="flex gap-2">
                    <Select
                        value={selectedPeriod.month.toString()}
                        onValueChange={(v) => setSelectedPeriod(prev => ({ ...prev, month: parseInt(v) }))}
                    >
                        <SelectTrigger className="w-[180px]">
                            <SelectValue placeholder="الشهر" />
                        </SelectTrigger>
                        <SelectContent>
                            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                <SelectItem key={m} value={m.toString()}>
                                    شهر {m}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Select
                        value={selectedPeriod.year.toString()}
                        onValueChange={(v) => setSelectedPeriod(prev => ({ ...prev, year: parseInt(v) }))}
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
            </div>

            <Card className="border-border/60 shadow-sm overflow-hidden">
                <CardHeader>
                    <CardTitle>جدول الحضور الشهري</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    <ScrollArea className="h-[600px] w-full">
                        <div className="min-w-[1200px]">
                            <div className="flex border-b bg-slate-50 sticky top-0 z-10">
                                <div className="w-48 p-3 font-semibold text-sm border-l sticky right-0 bg-slate-50 z-20 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                                    الموظف
                                </div>
                                {daysArray.map((day) => (
                                    <div key={day} className="w-10 p-2 text-center text-xs font-medium border-l last:border-l-0">
                                        {day}
                                    </div>
                                ))}
                            </div>

                            {employees.map((employee) => {
                                const empAttendance = monthlyAttendanceMap.get(employee.id) || {};
                                return (
                                    <div key={employee.id} className="flex border-b hover:bg-slate-50/50 transition-colors">
                                        <div className="w-48 p-3 text-sm font-medium border-l sticky right-0 bg-white hover:bg-slate-50 z-10 shadow-[4px_0_8px_-4px_rgba(0,0,0,0.1)]">
                                            {employee.name}
                                        </div>
                                        {daysArray.map((day) => {
                                            const dayData = empAttendance[day.toString()];
                                            const status = dayData?.status || 'off';
                                            const colorClass = ATTENDANCE_COLORS[status] || 'bg-slate-50';

                                            return (
                                                <div key={day} className="w-10 p-1 border-l last:border-l-0 flex items-center justify-center">
                                                    <div
                                                        className={`w-6 h-6 rounded-sm flex items-center justify-center text-[10px] cursor-help ${colorClass}`}
                                                        title={`${status} - ${dayData?.in || '--'} / ${dayData?.out || '--'}`}
                                                    >
                                                        {status === 'present' ? '✓' : status === 'absent' ? '✕' : ''}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    </ScrollArea>
                </CardContent>
            </Card>
        </div>
    );
};
