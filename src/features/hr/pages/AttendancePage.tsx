import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
  Calendar,
  Clock,
  UserCheck,
  UserX,
  AlertCircle,
  Download,
  Plus,
  TrendingUp,
  CheckCircle,
  XCircle,
  Timer,
  CalendarDays,
  Users,
} from 'lucide-react';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay } from 'date-fns';
import { getHrStatusKey, HR_MONTH_KEYS, useHrTranslation } from '../i18n';
import '../translations/pages';
import '../translations/ui';

export const AttendancePage: React.FC = () => {
  const { toast } = useToast();
  const { t, i18n } = useHrTranslation();
  const isArabic = i18n.resolvedLanguage?.startsWith('ar') ?? true;
  const locale = isArabic ? 'ar-SA' : 'en-US';
  const initialDate = React.useMemo(() => new Date(), []);
  const [selectedPeriod, setSelectedPeriod] = React.useState(() => ({
    year: initialDate.getFullYear(),
    month: initialDate.getMonth() + 1,
  }));
  const [checkInDialogOpen, setCheckInDialogOpen] = React.useState(false);
  const [selectedEmployee, setSelectedEmployee] = React.useState('');
  const [checkInTime, setCheckInTime] = React.useState(format(new Date(), 'HH:mm'));
  const [checkOutTime, setCheckOutTime] = React.useState('');
  const [notes, setNotes] = React.useState('');

  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
    staleTime: 60_000,
  });

  const { data: monthlyAttendance = [], isLoading: monthlyAttendanceLoading } = useQuery({
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
        if (data.status === 'present') totalPresent += 1;
        if (data.status === 'absent') totalAbsent += 1;
        if (data.status === 'late') totalLate += 1;
        if (dateStr === today) {
          if (data.status === 'present') presentToday += 1;
          if (data.status === 'absent') absentToday += 1;
          if (data.status === 'late') lateToday += 1;
        }
      });
    });

    const activeEmployees = employees.filter((employee) => employee.status === 'active').length;
    const attendanceRate = activeEmployees > 0 ? ((presentToday / activeEmployees) * 100).toFixed(1) : '0.0';
    return { presentToday, absentToday, lateToday, totalPresent, totalAbsent, totalLate, attendanceRate, activeEmployees };
  }, [monthlyAttendance, employees, selectedPeriod]);

  const daysInMonth = React.useMemo(
    () => new Date(selectedPeriod.year, selectedPeriod.month, 0).getDate(),
    [selectedPeriod],
  );
  const daysArray = React.useMemo(
    () => Array.from({ length: daysInMonth }, (_, index) => index + 1),
    [daysInMonth],
  );
  const monthlyAttendanceMap = React.useMemo(() => {
    const map = new Map<string, Record<string, any>>();
    monthlyAttendance.forEach((record) => map.set(record.employee_id, record.days ?? {}));
    return map;
  }, [monthlyAttendance]);
  const calendarDays = React.useMemo(() => {
    const start = startOfMonth(new Date(selectedPeriod.year, selectedPeriod.month - 1));
    return eachDayOfInterval({ start, end: endOfMonth(start) });
  }, [selectedPeriod]);

  const translateStatus = React.useCallback(
    (status?: string) => t(getHrStatusKey(status)),
    [t],
  );

  const handleCheckIn = () => {
    if (!selectedEmployee) {
      toast({ title: `⚠️ ${t('attendance.selectEmployeeWarning')}`, variant: 'destructive' });
      return;
    }
    // TODO: Connect the existing attendance mutation when the backend endpoint is enabled.
    toast({ title: `✅ ${t('attendance.saved')}` });
    setCheckInDialogOpen(false);
    setSelectedEmployee('');
    setCheckInTime(format(new Date(), 'HH:mm'));
    setCheckOutTime('');
    setNotes('');
  };

  const handleExport = () => {
    const csvContent = [
      [t('attendance.csvEmployee'), ...daysArray.map((day) => t('attendance.csvDay', { day }))].join(','),
      ...employees.map((employee) => {
        const employeeAttendance = monthlyAttendanceMap.get(employee.id) || {};
        return [
          employee.name,
          ...daysArray.map((day) => {
            const dayData = employeeAttendance[day.toString()];
            return dayData?.status ? translateStatus(dayData.status) : '-';
          }),
        ].join(',');
      }),
    ].join('\n');

    const blob = new Blob([`\ufeff${csvContent}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `attendance_${selectedPeriod.year}_${selectedPeriod.month}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast({ title: `✅ ${t('attendance.exported')}` });
  };

  const stickySide = isArabic ? 'right-0 border-l' : 'left-0 border-r';
  const iconSpacing = isArabic ? 'ml-2' : 'mr-2';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('attendance.title')}</h1>
          <p className="text-muted-foreground">{t('attendance.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExport} className="gap-2">
            <Download className="h-4 w-4" />
            {t('attendance.export')}
          </Button>
          <Button onClick={() => setCheckInDialogOpen(true)} className="gap-2 bg-teal-600 hover:bg-teal-700">
            <Plus className="h-4 w-4" />
            {t('attendance.record')}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[
          { label: t('attendance.presentToday'), value: stats.presentToday, total: stats.activeEmployees, icon: UserCheck, color: 'text-emerald-500', bgColor: 'bg-emerald-500/10' },
          { label: t('attendance.absentToday'), value: stats.absentToday, total: stats.activeEmployees, icon: UserX, color: 'text-rose-500', bgColor: 'bg-rose-500/10' },
          { label: t('attendance.lateToday'), value: stats.lateToday, total: stats.activeEmployees, icon: AlertCircle, color: 'text-amber-500', bgColor: 'bg-amber-500/10' },
          { label: t('attendance.attendanceRate'), value: `${stats.attendanceRate}%`, total: t('common.today'), icon: TrendingUp, color: 'text-blue-500', bgColor: 'bg-blue-500/10' },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="border-border/60 bg-card">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">{stat.label}</p>
                    <div className="mt-1 flex items-baseline gap-2">
                      <p className="text-2xl font-bold">{stat.value}</p>
                      <p className="text-xs text-muted-foreground">
                        {typeof stat.total === 'number' ? `/ ${stat.total}` : stat.total}
                      </p>
                    </div>
                  </div>
                  <div className={`${stat.bgColor} rounded-lg p-3`}>
                    <Icon className={`h-6 w-6 ${stat.color}`} />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-border/60 bg-card">
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <CalendarDays className="h-5 w-5 text-muted-foreground" />
            <div className="flex flex-1 gap-2">
              <Select
                value={selectedPeriod.month.toString()}
                onValueChange={(value) => setSelectedPeriod((previous) => ({ ...previous, month: Number.parseInt(value, 10) }))}
              >
                <SelectTrigger className="w-[180px]"><SelectValue placeholder={t('common.month')} /></SelectTrigger>
                <SelectContent>
                  {HR_MONTH_KEYS.map((monthKey, index) => (
                    <SelectItem key={monthKey} value={(index + 1).toString()}>{t(`months.${monthKey}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={selectedPeriod.year.toString()}
                onValueChange={(value) => setSelectedPeriod((previous) => ({ ...previous, year: Number.parseInt(value, 10) }))}
              >
                <SelectTrigger className="w-[120px]"><SelectValue placeholder={t('common.year')} /></SelectTrigger>
                <SelectContent>
                  {[2024, 2025, 2026].map((year) => <SelectItem key={year} value={year.toString()}>{year}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="text-sm text-muted-foreground">
              {t('attendance.employeeDaySummary', { employees: employees.length, days: daysInMonth })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="grid" className="space-y-4">
        <TabsList>
          <TabsTrigger value="grid">{t('attendance.grid')}</TabsTrigger>
          <TabsTrigger value="calendar">{t('attendance.calendar')}</TabsTrigger>
          <TabsTrigger value="summary">{t('attendance.summary')}</TabsTrigger>
        </TabsList>

        <TabsContent value="grid" className="space-y-4">
          <Card className="overflow-hidden border-border/60 bg-card shadow-sm">
            <CardHeader>
              <CardTitle>{t('attendance.monthlyTable')}</CardTitle>
              <CardDescription>{t('attendance.monthlyDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <div className="min-w-[1200px]">
                  <div className="sticky top-0 z-10 flex border-b bg-muted/50">
                    <div className={`sticky z-20 w-48 bg-muted/50 p-3 text-sm font-semibold ${stickySide}`}>
                      {t('attendance.employeeColumn')}
                    </div>
                    {daysArray.map((day) => <div key={day} className="w-10 border-l p-2 text-center text-xs font-medium last:border-l-0">{day}</div>)}
                  </div>
                  <div className="max-h-[600px] overflow-y-auto">
                    {monthlyAttendanceLoading ? (
                      <div className="p-12 text-center text-muted-foreground">
                        <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-teal-500 border-r-transparent" />
                        <p className="mt-4">{t('attendance.loading')}</p>
                      </div>
                    ) : employees.length === 0 ? (
                      <div className="p-12 text-center text-muted-foreground">
                        <Users className="mx-auto mb-4 h-16 w-16 opacity-50" />
                        <p>{t('attendance.noEmployees')}</p>
                      </div>
                    ) : employees.map((employee) => {
                      const employeeAttendance = monthlyAttendanceMap.get(employee.id) || {};
                      return (
                        <div key={employee.id} className="flex border-b transition-colors hover:bg-muted/30">
                          <div className={`sticky z-10 w-48 bg-card p-3 text-sm font-medium hover:bg-muted/30 ${stickySide}`}>
                            <div className="flex items-center gap-2">
                              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 text-xs font-semibold text-white">
                                {employee.name.charAt(0).toUpperCase()}
                              </div>
                              <span className="truncate">{employee.name}</span>
                            </div>
                          </div>
                          {daysArray.map((day) => {
                            const dayData = employeeAttendance[day.toString()];
                            const status = dayData?.status || 'off';
                            const colorClass = ATTENDANCE_COLORS[status] || 'border border-border bg-muted/50 text-muted-foreground';
                            return (
                              <div key={day} className="flex w-10 items-center justify-center border-l p-1 last:border-l-0">
                                <div
                                  className={`flex h-7 w-7 cursor-help items-center justify-center rounded-md text-xs transition-all hover:scale-110 ${colorClass}`}
                                  title={t('attendance.dayTooltip', { status: translateStatus(status), inTime: dayData?.in || '--', outTime: dayData?.out || '--' })}
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
                    })}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="calendar">
          <Card className="border-border/60 bg-card">
            <CardHeader>
              <CardTitle>{t('attendance.calendar')}</CardTitle>
              <CardDescription>{t('attendance.calendarDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-7 gap-2">
                {Array.from({ length: 7 }, (_, index) => {
                  const reference = new Date(2026, 0, 4 + index);
                  const dayName = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(reference);
                  return <div key={dayName} className="rounded bg-muted/50 p-2 text-center text-sm font-semibold">{dayName}</div>;
                })}
                {calendarDays.map((day) => {
                  const dayNumber = format(day, 'd');
                  let presentCount = 0;
                  let absentCount = 0;
                  monthlyAttendance.forEach((record: any) => {
                    const dayData = record.days?.[dayNumber];
                    if (dayData?.status === 'present') presentCount += 1;
                    if (dayData?.status === 'absent') absentCount += 1;
                  });
                  return (
                    <Card key={day.toISOString()} className={`p-3 ${isSameDay(day, new Date()) ? 'border-2 border-teal-500' : 'border-border/60'}`}>
                      <div className="mb-2 text-start text-sm font-semibold">{dayNumber}</div>
                      <div className="space-y-1">
                        <div className="flex items-center gap-1 text-xs"><div className="h-2 w-2 rounded-full bg-emerald-500" /><span>{presentCount}</span></div>
                        <div className="flex items-center gap-1 text-xs"><div className="h-2 w-2 rounded-full bg-rose-500" /><span>{absentCount}</span></div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="summary">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-border/60 bg-card">
              <CardHeader><CardTitle>{t('attendance.attendanceStats')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {[
                  { label: t('attendance.totalPresent'), value: stats.totalPresent, color: 'text-emerald-500' },
                  { label: t('attendance.totalAbsent'), value: stats.totalAbsent, color: 'text-rose-500' },
                  { label: t('attendance.totalLate'), value: stats.totalLate, color: 'text-amber-500' },
                ].map((item) => (
                  <div key={item.label} className="flex items-center justify-between rounded-lg bg-muted/30 p-3">
                    <span className="text-sm font-medium">{item.label}</span>
                    <span className={`text-xl font-bold ${item.color}`}>{item.value.toLocaleString(locale)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card className="border-border/60 bg-card">
              <CardHeader><CardTitle>{t('attendance.legend')}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {[
                  { status: 'present', icon: CheckCircle },
                  { status: 'absent', icon: XCircle },
                  { status: 'late', icon: Timer },
                  { status: 'leave', icon: Calendar },
                ].map((item) => {
                  const Icon = item.icon;
                  return (
                    <div key={item.status} className="flex items-center gap-3">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-md ${ATTENDANCE_COLORS[item.status]}`}><Icon className="h-4 w-4" /></div>
                      <span className="text-sm font-medium">{translateStatus(item.status)}</span>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog open={checkInDialogOpen} onOpenChange={setCheckInDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('attendance.dialogTitle')}</DialogTitle>
            <DialogDescription>{t('attendance.dialogDescription')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('common.employee')}</Label>
              <Select value={selectedEmployee} onValueChange={setSelectedEmployee}>
                <SelectTrigger><SelectValue placeholder={t('attendance.selectEmployee')} /></SelectTrigger>
                <SelectContent>{employees.map((employee) => <SelectItem key={employee.id} value={employee.id}>{employee.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('attendance.checkIn')}</Label>
                <Input type="time" value={checkInTime} onChange={(event) => setCheckInTime(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t('attendance.checkOut')}</Label>
                <Input type="time" value={checkOutTime} onChange={(event) => setCheckOutTime(event.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('common.notes')}</Label>
              <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={t('attendance.notesPlaceholder')} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCheckInDialogOpen(false)}>{t('common.cancel')}</Button>
            <Button onClick={handleCheckIn} className="bg-teal-600 hover:bg-teal-700">
              <Clock className={`h-4 w-4 ${iconSpacing}`} />
              {t('attendance.submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
