import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  getAttendanceLogs,
  getPayrollRuns,
  getEmployees,
  getLeaveRequests,
} from '@/services/hr/hr-service';
import { ATTENDANCE_COLORS, STATUS_BADGES } from '../types';
import { Users, UserCheck, Clock, Calendar, DollarSign } from 'lucide-react';
import { getHrStatusKey, useHrTranslation } from '../i18n';
import '../translations/pages';
import { usePermissions } from '@/hooks/usePermissions';

export const DashboardPage: React.FC = () => {
  const { t, i18n } = useHrTranslation();
  const locale = i18n.resolvedLanguage?.startsWith('ar') ? 'ar-SA' : 'en-US';
  const { hasPermissionKey } = usePermissions();
  // متطلب دخول هذه الشاشة عند ModuleGuard هو anyOf بين موارد HR؛ كل استعلام
  // ومقطع هنا مشروط بمفتاح قراءته الفعلي — enabled يمنع React Query من الجلب
  // أصلاً، لا مجرد إخفاء العرض بعد التحميل.
  const canReadEmployees = hasPermissionKey('hr.employees.read');
  const canReadAttendance = hasPermissionKey('hr.attendance.read');
  const canReadPayroll = hasPermissionKey('hr.payroll.read');
  const canReadLeaves = hasPermissionKey('hr.leaves.read');

  const { data: attendanceLogs = [], isLoading: attendanceLoading } = useQuery({
    queryKey: ['hr', 'attendance', 'all'],
    queryFn: () => getAttendanceLogs(90),
    enabled: canReadAttendance,
  });
  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
    enabled: canReadEmployees,
  });
  const { data: payrollRuns = [], isLoading: payrollLoading } = useQuery({
    queryKey: ['hr', 'payroll-runs'],
    queryFn: () => getPayrollRuns(12),
    enabled: canReadPayroll,
  });
  const { data: leaveRequests = [] } = useQuery({
    queryKey: ['hr', 'leaves'],
    queryFn: () => getLeaveRequests(100),
    enabled: canReadLeaves,
  });

  const today = new Date().toISOString().split('T')[0];
  const todaysAttendance = React.useMemo(
    () => attendanceLogs.filter((log) => log.date?.startsWith(today)),
    [attendanceLogs, today],
  );

  const stats = React.useMemo(() => {
    const active = employees.filter((employee) => employee.status === 'active').length;
    const present = todaysAttendance.filter((log) => log.status === 'present').length;
    return {
      total: employees.length,
      active,
      attendanceRate: active > 0 ? (present / active) * 100 : 0,
      pendingLeaves: leaveRequests.filter((request) => request.status === 'pending').length,
    };
  }, [employees, leaveRequests, todaysAttendance]);

  const employeeStatus = React.useMemo(() => {
    const counts: Record<string, number> = {};
    employees.forEach((employee) => {
      counts[employee.status] = (counts[employee.status] ?? 0) + 1;
    });
    return counts;
  }, [employees]);

  const attendanceStatus = React.useMemo(() => {
    const counts: Record<string, number> = {};
    attendanceLogs.forEach((log) => {
      counts[log.status] = (counts[log.status] ?? 0) + 1;
    });
    return counts;
  }, [attendanceLogs]);

  type StatCard = { label: string; value: string | number; icon: typeof Users; loading: boolean };
  const cards: Array<StatCard | false> = [
    canReadEmployees && { label: t('dashboard.totalEmployees'), value: stats.total, icon: Users, loading: employeesLoading },
    canReadEmployees && { label: t('dashboard.activeEmployees'), value: stats.active, icon: UserCheck, loading: employeesLoading },
    // النسبة تحتاج كلا الموردين معًا (الحاضرون اليوم/الموظفون النشطون).
    canReadEmployees && canReadAttendance && {
      label: t('dashboard.attendanceRate'),
      value: `${stats.attendanceRate.toFixed(1)}%`,
      icon: Clock,
      loading: employeesLoading || attendanceLoading,
    },
    canReadLeaves && { label: t('dashboard.leaveRequests'), value: stats.pendingLeaves, icon: Calendar, loading: false },
  ];
  const visibleCards = cards.filter((card): card is StatCard => Boolean(card));

  // تبويب التوزيع يعرض بطاقتين مستقلتين (حالة الموظفين من hr.employees.read،
  // وحالة الحضور من hr.attendance.read)؛ يبقى التبويب نفسه ظاهرًا إن ملك
  // المستخدم أيًّا منهما، وكل بطاقة داخله مشروطة بمفتاحها وحده.
  const visibleTabs = [
    canReadAttendance && 'attendance',
    canReadPayroll && 'payroll',
    (canReadEmployees || canReadAttendance) && 'distribution',
  ].filter((tab): tab is string => Boolean(tab));
  const defaultTab = visibleTabs[0];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {visibleCards.map(({ label, value, icon: Icon, loading }) => (
          <Card key={label} className="border-border/60">
            <CardContent className="flex items-center justify-between p-6">
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-bold">{loading ? '…' : value}</p>
              </div>
              <Icon className="h-8 w-8 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      {defaultTab && (
        // key بمجموعة التبويبات الظاهرة: أي تغيّر صلاحية يعيد بناء Tabs بقيمة
        // افتراضية صالحة بدل الاحتفاظ داخليًا بتبويب لم يعد له زر أو محتوى.
        <Tabs key={visibleTabs.join(',')} defaultValue={defaultTab} className="space-y-4">
          <TabsList>
            {canReadAttendance && <TabsTrigger value="attendance">{t('dashboard.attendance')}</TabsTrigger>}
            {canReadPayroll && <TabsTrigger value="payroll">{t('dashboard.payroll')}</TabsTrigger>}
            {(canReadEmployees || canReadAttendance) && (
              <TabsTrigger value="distribution">{t('dashboard.distribution')}</TabsTrigger>
            )}
          </TabsList>

          {canReadAttendance && (
            <TabsContent value="attendance">
              <Card>
                <CardHeader>
                  <CardTitle>{t('dashboard.todayAttendance')}</CardTitle>
                  <CardDescription>{t('dashboard.records', { count: todaysAttendance.length })}</CardDescription>
                </CardHeader>
                <CardContent>
                  {attendanceLoading ? (
                    <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
                  ) : todaysAttendance.length === 0 ? (
                    <p className="py-8 text-center text-muted-foreground">{t('dashboard.noAttendance')}</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>{t('common.employee')}</TableHead>
                          <TableHead>{t('common.status')}</TableHead>
                          <TableHead>{t('dashboard.checkIn')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {todaysAttendance.slice(0, 10).map((log) => (
                          <TableRow key={log.id}>
                            <TableCell>{log.employeeName || log.employeeId || '—'}</TableCell>
                            <TableCell>
                              <Badge className={ATTENDANCE_COLORS[log.status] ?? ''}>
                                {t(getHrStatusKey(log.status))}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {log.checkIn ? new Date(log.checkIn).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) : '—'}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {canReadPayroll && (
            <TabsContent value="payroll">
              <Card>
                <CardHeader>
                  <CardTitle>{t('dashboard.recentPayroll')}</CardTitle>
                </CardHeader>
                <CardContent>
                  {payrollLoading ? (
                    <p className="py-8 text-center text-muted-foreground">{t('common.loading')}</p>
                  ) : payrollRuns.length === 0 ? (
                    <p className="py-8 text-center text-muted-foreground">{t('dashboard.noPayroll')}</p>
                  ) : (
                    <div className="space-y-3">
                      {payrollRuns.slice(0, 6).map((run) => (
                        <div key={run.id} className="flex items-center justify-between rounded-lg border p-4">
                          <div>
                            <p className="font-semibold">{run.periodCode}</p>
                            <p className="text-xs text-muted-foreground">
                              {t('dashboard.employeeCount', { count: run.employeeCount ?? 0 })}
                            </p>
                          </div>
                          <div className="text-end">
                            <p className="font-bold">
                              {(run.totalNet ?? 0).toLocaleString(locale)} {run.currency || t('common.currency')}
                            </p>
                            <Badge className={STATUS_BADGES[run.status] ?? ''}>{t(getHrStatusKey(run.status))}</Badge>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          )}

          {(canReadEmployees || canReadAttendance) && (
            <TabsContent value="distribution">
              <div className="grid gap-4 md:grid-cols-2">
                {canReadEmployees && (
                  <Card>
                    <CardHeader><CardTitle>{t('dashboard.employeeStatus')}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {Object.entries(employeeStatus).map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between rounded-lg border p-3">
                          <span>{t(getHrStatusKey(status))}</span><Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {canReadAttendance && (
                  <Card>
                    <CardHeader><CardTitle>{t('dashboard.attendanceStatus')}</CardTitle></CardHeader>
                    <CardContent className="space-y-3">
                      {Object.entries(attendanceStatus).map(([status, count]) => (
                        <div key={status} className="flex items-center justify-between rounded-lg border p-3">
                          <span>{t(getHrStatusKey(status))}</span><Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          )}
        </Tabs>
      )}

      {canReadPayroll && (
        <Card>
          <CardContent className="flex items-center justify-between p-4">
            <span className="text-sm text-muted-foreground">{t('dashboard.netAmount')}</span>
            <span className="flex items-center gap-2 font-semibold">
              <DollarSign className="h-4 w-4" />
              {payrollRuns.reduce((sum, run) => sum + (run.totalNet ?? 0), 0).toLocaleString(locale)}
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
