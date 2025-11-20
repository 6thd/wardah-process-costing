// src/features/hr/index.tsx
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { useTranslation } from 'react-i18next';
import {
  getAttendanceLogs,
  getEmployees,
  getHrDashboardMetrics,
  getHrInsights,
  getLeaveRequests,
  getPayrollRuns,
  getSettlementRecords,
  getSmartAlerts,
} from '@/services/hr/hr-service';
import {
  getHrPolicies,
  updateHrPolicies,
  HrPolicies,
} from '@/services/hr/policies-service';
import {
  getPayrollAccountMappings,
  listPostingAccounts,
  upsertPayrollAccountMapping,
  PayrollAccountType,
} from '@/services/hr/payroll-account-service';
import {
  calculatePayrollPreview,
  processPayrollRun,
} from '@/services/hr/payroll-engine';
import {
  listAttendanceForPeriod,
  AttendanceDayPayload,
} from '@/services/hr/attendance-service';
import { createEmployee } from '@/services/hr/employee-service';

const statusBadges: Record<string, string> = {
  active: 'bg-emerald-100 text-emerald-800',
  inactive: 'bg-slate-100 text-slate-800',
  terminated: 'bg-rose-100 text-rose-800',
  probation: 'bg-amber-100 text-amber-800',
  pending: 'bg-amber-100 text-amber-800',
  approved: 'bg-emerald-100 text-emerald-800',
  rejected: 'bg-rose-100 text-rose-800',
  draft: 'bg-slate-100 text-slate-800',
  calculated: 'bg-blue-100 text-blue-800',
  paid: 'bg-emerald-100 text-emerald-800',
};

const attendanceColors: Record<string, string> = {
  present: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
  absent: 'bg-rose-50 text-rose-700 border border-rose-100',
  late: 'bg-amber-50 text-amber-700 border border-amber-100',
  leave: 'bg-blue-50 text-blue-700 border border-blue-100',
  remote: 'bg-violet-50 text-violet-700 border border-violet-100',
  off: 'bg-slate-50 text-slate-600 border border-slate-100',
};

export const HRModule: React.FC = () => {
  const [activeTab, setActiveTab] = React.useState('dashboard');
  const initialDate = React.useMemo(() => new Date(), []);
  const [selectedPeriod, setSelectedPeriod] = React.useState(() => ({
    year: initialDate.getFullYear(),
    month: initialDate.getMonth() + 1,
  }));
  const [policyForm, setPolicyForm] = React.useState<Partial<HrPolicies> | null>(null);
  const [employeeDialogOpen, setEmployeeDialogOpen] = React.useState(false);
  const [employeeForm, setEmployeeForm] = React.useState({
    firstName: '',
    lastName: '',
    employeeCode: '',
    department: '',
    position: '',
    salary: '',
    hireDate: '',
  });
  const [attendanceModal, setAttendanceModal] = React.useState<{
    open: boolean;
    employeeId?: string;
    employeeName?: string;
    date?: string;
    status?: string;
    inTime?: string;
    outTime?: string;
    notes?: string;
  }>({ open: false });
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['hr', 'metrics'],
    queryFn: getHrDashboardMetrics,
    staleTime: 60_000,
  });

  const { data: employees = [], isLoading: employeesLoading } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
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
  const {
    data: payrollPreview,
    isLoading: previewLoading,
    refetch: refetchPayrollPreview,
  } = useQuery({
    queryKey: ['hr', 'payroll-preview', selectedPeriod.year, selectedPeriod.month],
    queryFn: () => calculatePayrollPreview(selectedPeriod.year, selectedPeriod.month),
  });


  const { data: leaveRequests = [], isLoading: leavesLoading } = useQuery({
    queryKey: ['hr', 'leave-requests'],
    queryFn: () => getLeaveRequests(25),
  });

  const { data: settlements = [], isLoading: settlementsLoading } = useQuery({
    queryKey: ['hr', 'settlements'],
    queryFn: () => getSettlementRecords(15),
  });

  const { data: alerts = [], isLoading: alertsLoading } = useQuery({
    queryKey: ['hr', 'alerts'],
    queryFn: () => getSmartAlerts(20),
  });

  const { data: insights = [], isLoading: insightsLoading } = useQuery({
    queryKey: ['hr', 'insights'],
    queryFn: getHrInsights,
    staleTime: 120_000,
  });

  const { data: hrPolicies, isLoading: policiesLoading } = useQuery({
    queryKey: ['hr', 'policies'],
    queryFn: getHrPolicies,
  });

  const { data: glAccounts = [], isLoading: glAccountsLoading } = useQuery({
    queryKey: ['hr', 'glAccounts'],
    queryFn: listPostingAccounts,
  });

  const { data: payrollAccountMappings = [], isLoading: mappingsLoading } = useQuery({
    queryKey: ['hr', 'payroll-account-mappings'],
    queryFn: getPayrollAccountMappings,
  });

  React.useEffect(() => {
    if (hrPolicies) {
      setPolicyForm(hrPolicies);
    }
  }, [hrPolicies]);

  const policyMutation = useMutation({
    mutationFn: (payload: Partial<HrPolicies>) => updateHrPolicies(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'policies'] });
      toast({ title: t('messages.saveSuccess') });
    },
    onError: (error: any) => {
      toast({
        title: t('messages.operationFailed'),
        description: error?.message ?? '',
        variant: 'destructive',
      });
    },
  });

  const accountMutation = useMutation({
    mutationFn: ({ accountType, glAccountId }: { accountType: PayrollAccountType; glAccountId: string }) =>
      upsertPayrollAccountMapping(accountType, glAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'payroll-account-mappings'] });
      toast({ title: t('messages.saveSuccess') });
    },
    onError: (error: any) => {
      toast({
        title: t('messages.operationFailed'),
        description: error?.message ?? '',
        variant: 'destructive',
      });
    },
  });

  const processPayrollMutation = useMutation({
    mutationFn: () => processPayrollRun(selectedPeriod.year, selectedPeriod.month),
    onSuccess: () => {
      toast({ title: t('hr.payrollProcessing.lockSuccess') });
      refetchPayrollPreview();
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

  const createEmployeeMutation = useMutation({
    mutationFn: () =>
      createEmployee({
        firstName: employeeForm.firstName.trim(),
        lastName: employeeForm.lastName.trim(),
        employeeCode: employeeForm.employeeCode.trim(),
        hireDate: employeeForm.hireDate,
        department: employeeForm.department.trim() || undefined,
        position: employeeForm.position.trim() || undefined,
        salary: employeeForm.salary ? Number(employeeForm.salary) : 0,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['hr', 'employees'] });
      toast({ title: t('messages.saveSuccess') });
      setEmployeeDialogOpen(false);
      setEmployeeForm({
        firstName: '',
        lastName: '',
        employeeCode: '',
        department: '',
        position: '',
        salary: '',
        hireDate: '',
      });
    },
    onError: (error: any) => {
      toast({
        title: t('messages.operationFailed'),
        description: error?.message ?? '',
        variant: 'destructive',
      });
    },
  });

  const weekendOptions = React.useMemo(
    () => [
      { value: 'thursday', label: t('hr.policies.weekendOptions.thursday') },
      { value: 'friday', label: t('hr.policies.weekendOptions.friday') },
      { value: 'saturday', label: t('hr.policies.weekendOptions.saturday') },
    ],
    [t],
  );

  const payrollAccountTypes: Array<{
    key: PayrollAccountType;
    label: string;
    description: string;
  }> = [
    { key: 'basic_salary', label: t('hr.payrollAccounts.basic_salary'), description: t('hr.payrollAccounts.descriptions.basic_salary') },
    { key: 'housing_allowance', label: t('hr.payrollAccounts.housing_allowance'), description: t('hr.payrollAccounts.descriptions.housing_allowance') },
    { key: 'transport_allowance', label: t('hr.payrollAccounts.transport_allowance'), description: t('hr.payrollAccounts.descriptions.transport_allowance') },
    { key: 'other_allowance', label: t('hr.payrollAccounts.other_allowance'), description: t('hr.payrollAccounts.descriptions.other_allowance') },
    { key: 'deductions', label: t('hr.payrollAccounts.deductions'), description: t('hr.payrollAccounts.descriptions.deductions') },
    { key: 'loans', label: t('hr.payrollAccounts.loans'), description: t('hr.payrollAccounts.descriptions.loans') },
    { key: 'payable', label: t('hr.payrollAccounts.payable'), description: t('hr.payrollAccounts.descriptions.payable') },
    { key: 'net_payable', label: t('hr.payrollAccounts.net_payable'), description: t('hr.payrollAccounts.descriptions.net_payable') },
  ];

  const handlePolicyFieldChange = (field: keyof HrPolicies, value: number | string | string[]) => {
    setPolicyForm((prev) => {
      if (!prev) return prev;
      return { ...prev, [field]: value } as HrPolicies;
    });
  };

  const handleWeekendToggle = (value: string, checked: boolean) => {
    setPolicyForm((prev) => {
      if (!prev) return prev;
      const current = new Set(prev.weekend_days ?? []);
      if (checked) current.add(value);
      else current.delete(value);
      return { ...prev, weekend_days: Array.from(current) };
    });
  };

  const handlePoliciesSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!policyForm) return;
    policyMutation.mutate({
      employee_daily_hours: Number(policyForm.employee_daily_hours || 0),
      worker_daily_hours: Number(policyForm.worker_daily_hours || 0),
      worker_shifts: Number(policyForm.worker_shifts || 0),
      overtime_multiplier: Number(policyForm.overtime_multiplier || 0),
      overtime_grace_minutes: Number(policyForm.overtime_grace_minutes || 0),
      weekend_days: policyForm.weekend_days ?? ['friday'],
    });
  };

  const getMappingValue = (type: PayrollAccountType) =>
    payrollAccountMappings.find((mapping) => mapping.account_type === type)?.gl_account_id ?? undefined;

  const selectedMonthValue = `${selectedPeriod.year}-${String(selectedPeriod.month).padStart(2, '0')}`;

  const handlePeriodChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (!value) return;
    const [yearPart, monthPart] = value.split('-').map((part) => parseInt(part, 10));
    if (!Number.isNaN(yearPart) && !Number.isNaN(monthPart)) {
      setSelectedPeriod({ year: yearPart, month: monthPart });
    }
  };

  // Sync URL (/hr/overview, /hr/attendance, ...) with internal tabs
  React.useEffect(() => {
    const segments = location.pathname.split('/').filter(Boolean);
    // segments: ['hr', 'overview']
    const section = segments[1] || 'overview';
    const pathToTab: Record<string, string> = {
      overview: 'dashboard',
      employees: 'employees',
      departments: 'employees',
      positions: 'employees',
      payroll: 'payroll',
      attendance: 'attendance',
      'leave-types': 'leaves',
      reports: 'alerts',
    };
    const mapped = pathToTab[section] ?? 'dashboard';
    setActiveTab(mapped);
  }, [location.pathname]);

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const tabToPath: Record<string, string> = {
      dashboard: '/hr/overview',
      employees: '/hr/employees',
      attendance: '/hr/attendance',
      payroll: '/hr/payroll',
      leaves: '/hr/leave-types',
      settlements: '/hr/overview',
      alerts: '/hr/reports',
      settings: '/hr/payroll', // settings lives under HR but not in sidebar, keep URL stable
    };
    const target = tabToPath[value] ?? '/hr/overview';
    if (location.pathname !== target) {
      navigate(target);
    }
  };

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

  const monthlyAttendanceMap = React.useMemo(() => {
    const map = new Map<string, Record<string, AttendanceDayPayload>>();
    (monthlyAttendance ?? []).forEach((record) => {
      map.set(record.employee_id, record.days ?? {});
    });
    return map;
  }, [monthlyAttendance]);

  const daysInSelectedMonth = React.useMemo(() => {
    const { year, month } = selectedPeriod;
    if (month === 2) {
      const isLeap =
        (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
      return isLeap ? 29 : 28;
    }
    const days = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return days[month - 1];
  }, [selectedPeriod]);

  const openAttendanceEditor = (
    employeeId: string,
    employeeName: string,
    day: number,
  ) => {
    const days = monthlyAttendanceMap.get(employeeId) ?? {};
    const payload = days[String(day)] as AttendanceDayPayload | undefined;
    const date = new Date(
      selectedPeriod.year,
      selectedPeriod.month - 1,
      day,
    )
      .toISOString()
      .split('T')[0];

    setAttendanceModal({
      open: true,
      employeeId,
      employeeName,
      date,
      status: payload?.status ?? 'present',
      inTime: payload?.in ?? '',
      outTime: payload?.out ?? '',
      notes: payload?.notes ?? '',
    });
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium text-emerald-600">
          نظام الرواتب والموارد البشرية وفق معايير «حاسبني»
        </p>
        <h1 className="text-3xl font-bold tracking-tight">إدارة الموارد البشرية المتقدمة</h1>
        <p className="text-muted-foreground max-w-3xl">
          دورة موارد بشرية متكاملة تشمل التوظيف، الحضور، الرواتب، الإجازات، التسويات والتنبيهات
          الذكية، مع تحليلات تنبؤية لضمان الامتثال وتقليل المخاطر التشغيلية.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 gap-2 lg:grid-cols-8">
          <TabsTrigger value="dashboard">لوحة التحكم</TabsTrigger>
          <TabsTrigger value="employees">الموظفون</TabsTrigger>
          <TabsTrigger value="attendance">الحضور</TabsTrigger>
          <TabsTrigger value="payroll">الرواتب</TabsTrigger>
          <TabsTrigger value="leaves">الإجازات</TabsTrigger>
          <TabsTrigger value="settlements">التسويات</TabsTrigger>
          <TabsTrigger value="alerts">التنبيهات والتحليلات</TabsTrigger>
          <TabsTrigger value="settings">{t('hr.settings')}</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-6">
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
              <Card key={card.label} className="border-border/60">
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
            <Card className="border-border/60">
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
                      className={`rounded-full px-3 py-1 text-xs font-medium ${attendanceColors[status] ?? 'bg-slate-50 text-slate-700 border border-slate-100'}`}
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
                      className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 text-sm"
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
                        className={`capitalize ${attendanceColors[log.status] ?? 'bg-slate-100 text-slate-700'}`}
                      >
                        {log.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60">
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
                    className="flex items-start justify-between rounded-md border border-border/60 p-3 text-sm"
                  >
                    <div>
                      <p className="font-semibold">{run.periodCode}</p>
                      <p className="text-xs text-muted-foreground">
                        صافي الرواتب {run.totalNet?.toLocaleString() ?? 0} {run.currency || 'SAR'}
                      </p>
                    </div>
                    <Badge
                      className={`capitalize ${statusBadges[run.status] ?? 'bg-slate-100 text-slate-700'}`}
                    >
                      {run.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="employees">
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>سجل الموظفين</CardTitle>
                <p className="text-sm text-muted-foreground">
                  قائمة الموظفين مع الوظائف، الأقسام، العقود والرواتب الأساسية.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">استيراد بيانات</Button>
                <Button onClick={() => setEmployeeDialogOpen(true)}>إضافة موظف</Button>
              </div>
            </CardHeader>
            <CardContent>
              {employeesLoading ? (
                <p className="text-sm text-muted-foreground">جارٍ تحميل بيانات الموظفين...</p>
              ) : employees.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  لم يتم العثور على موظفين. ابدأ بإضافة أول سجل.
                </p>
              ) : (
                <ScrollArea className="h-[520px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الموظف</TableHead>
                        <TableHead>القسم</TableHead>
                        <TableHead>الوظيفة</TableHead>
                        <TableHead>تاريخ التعيين</TableHead>
                        <TableHead>انتهاء العقد</TableHead>
                        <TableHead className="text-right">الراتب</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employees.map((employee) => (
                        <TableRow key={employee.id}>
                          <TableCell>
                            <div className="font-semibold">{employee.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {employee.code || '—'}
                            </div>
                          </TableCell>
                          <TableCell>{employee.department || '—'}</TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <span>{employee.jobTitle || '—'}</span>
                              <Badge
                                variant="outline"
                                className={`text-xs ${statusBadges[employee.status] ?? 'bg-slate-100 text-slate-800'}`}
                              >
                                {employee.status === 'active'
                                  ? 'نشط'
                                  : employee.status === 'probation'
                                    ? 'تحت التجربة'
                                    : 'غير نشط'}
                              </Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            {employee.hiringDate
                              ? new Date(employee.hiringDate).toLocaleDateString()
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {employee.contractEndDate
                              ? new Date(employee.contractEndDate).toLocaleDateString()
                              : 'مفتوح'}
                          </TableCell>
                          <TableCell className="text-right">
                            {employee.salary?.toLocaleString() ?? '—'}{' '}
                            <span className="text-xs text-muted-foreground">
                              {employee.currency}
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Dialog open={employeeDialogOpen} onOpenChange={setEmployeeDialogOpen}>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>إضافة موظف جديد</DialogTitle>
                <DialogDescription>
                  إدخال بيانات الموظف وربطها تلقائياً بالمؤسسة الحالية (org_id) في Supabase.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1 md:col-span-2">
                  <label className="text-sm font-medium">الاسم الأول</label>
                  <Input
                    value={employeeForm.firstName}
                    onChange={(event) =>
                      setEmployeeForm((prev) => ({ ...prev, firstName: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-sm font-medium">اسم العائلة</label>
                  <Input
                    value={employeeForm.lastName}
                    onChange={(event) =>
                      setEmployeeForm((prev) => ({ ...prev, lastName: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">الرقم الوظيفي / الكود</label>
                  <Input
                    value={employeeForm.employeeCode}
                    onChange={(event) =>
                      setEmployeeForm((prev) => ({ ...prev, employeeCode: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">تاريخ التعيين</label>
                  <Input
                    type="date"
                    value={employeeForm.hireDate}
                    onChange={(event) =>
                      setEmployeeForm((prev) => ({ ...prev, hireDate: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">القسم</label>
                  <Input
                    value={employeeForm.department}
                    onChange={(event) =>
                      setEmployeeForm((prev) => ({ ...prev, department: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">المسمى الوظيفي</label>
                  <Input
                    value={employeeForm.position}
                    onChange={(event) =>
                      setEmployeeForm((prev) => ({ ...prev, position: event.target.value }))
                    }
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">الراتب الأساسي</label>
                  <Input
                    type="number"
                    min={0}
                    value={employeeForm.salary}
                    onChange={(event) =>
                      setEmployeeForm((prev) => ({ ...prev, salary: event.target.value }))
                    }
                  />
                </div>
              </div>
              <DialogFooter className="mt-4 flex flex-row justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEmployeeDialogOpen(false)}
                >
                  إلغاء
                </Button>
                <Button
                  type="button"
                  disabled={createEmployeeMutation.isPending}
                  onClick={() => createEmployeeMutation.mutate()}
                >
                  {createEmployeeMutation.isPending ? t('messages.loading') : 'حفظ الموظف'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="attendance">
          <Card className="border-border/60">
            <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <CardTitle>جدول الحضور الشهري</CardTitle>
                <p className="text-sm text-muted-foreground">
                  اختر الشهر واستعرض حضور الموظفين مع إمكانية تعديل حالة كل يوم.
                </p>
              </div>
              <div className="flex flex-col gap-2 md:flex-row md:items-center">
                <label className="text-sm font-medium" htmlFor="attendance-period">
                  شهر الحضور
                </label>
                <Input
                  id="attendance-period"
                  type="month"
                  value={selectedMonthValue}
                  onChange={handlePeriodChange}
                  className="w-[200px]"
                />
              </div>
            </CardHeader>
            <CardContent>
              {monthlyAttendanceLoading ? (
                <p className="text-sm text-muted-foreground">{t('messages.loading')}</p>
              ) : !employees.length ? (
                <p className="text-sm text-muted-foreground">لا توجد بيانات موظفين لعرض الحضور.</p>
              ) : (
                <ScrollArea className="h-[460px] w-full">
                  <Table className="min-w-[900px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky right-0 bg-background z-10">الموظف</TableHead>
                        {Array.from({ length: daysInSelectedMonth }, (_, index) => index + 1).map(
                          (day) => (
                            <TableHead key={day} className="text-center">
                              {day}
                            </TableHead>
                          ),
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employees.map((employee) => {
                        const days = monthlyAttendanceMap.get(employee.id) ?? {};
                        return (
                          <TableRow key={employee.id}>
                            <TableCell className="whitespace-nowrap sticky right-0 bg-background z-10">
                              <div className="font-semibold">{employee.name}</div>
                              <p className="text-xs text-muted-foreground">
                                {employee.code || employee.id}
                              </p>
                            </TableCell>
                            {Array.from({ length: daysInSelectedMonth }, (_, index) => index + 1).map(
                              (day) => {
                                const payload = days[String(day)] as AttendanceDayPayload | undefined;
                                const symbol =
                                  payload?.status === 'absent'
                                    ? 'غ'
                                    : payload?.status === 'leave' &&
                                      (payload?.notes || '').includes('sick')
                                      ? 'م'
                                      : payload?.status === 'leave'
                                        ? 'إ'
                                        : payload?.status === 'present'
                                          ? 'ح'
                                          : '•';
                                const statusKey = payload?.status || 'off';
                                return (
                                  <TableCell
                                    key={day}
                                    className="p-0 text-center align-middle"
                                  >
                                    <button
                                      type="button"
                                      className={`m-[1px] flex h-8 w-8 items-center justify-center rounded text-xs font-medium ${attendanceColors[statusKey] ?? 'bg-slate-50 text-slate-600 border border-slate-100'}`}
                                      onClick={() =>
                                        openAttendanceEditor(employee.id, employee.name, day)
                                      }
                                    >
                                      {symbol}
                                    </button>
                                  </TableCell>
                                );
                              },
                            )}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </ScrollArea>
              )}
            </CardContent>
          </Card>

          <Dialog
            open={attendanceModal.open}
            onOpenChange={(open) =>
              setAttendanceModal((prev) => ({
                ...prev,
                open,
              }))
            }
          >
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>
                  تعديل حالة اليوم: {attendanceModal.employeeName ?? ''}
                </DialogTitle>
                <DialogDescription>
                  {attendanceModal.date
                    ? new Date(attendanceModal.date).toLocaleDateString('ar-SA', {
                        weekday: 'long',
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })
                    : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="grid gap-2 md:grid-cols-2">
                  <Button
                    type="button"
                    variant={attendanceModal.status === 'present' ? 'default' : 'outline'}
                    onClick={() =>
                      setAttendanceModal((prev) => ({ ...prev, status: 'present' }))
                    }
                  >
                    حاضر
                  </Button>
                  <Button
                    type="button"
                    variant={attendanceModal.status === 'absent' ? 'default' : 'outline'}
                    onClick={() =>
                      setAttendanceModal((prev) => ({ ...prev, status: 'absent' }))
                    }
                  >
                    غائب
                  </Button>
                  <Button
                    type="button"
                    variant={attendanceModal.status === 'sick' ? 'default' : 'outline'}
                    onClick={() =>
                      setAttendanceModal((prev) => ({ ...prev, status: 'sick' }))
                    }
                  >
                    مرضية
                  </Button>
                  <Button
                    type="button"
                    variant={attendanceModal.status === 'leave' ? 'default' : 'outline'}
                    onClick={() =>
                      setAttendanceModal((prev) => ({ ...prev, status: 'leave' }))
                    }
                  >
                    إجازة سنوية
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">وقت الحضور</label>
                    <Input
                      type="time"
                      value={attendanceModal.inTime ?? ''}
                      onChange={(event) =>
                        setAttendanceModal((prev) => ({
                          ...prev,
                          inTime: event.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">وقت الانصراف</label>
                    <Input
                      type="time"
                      value={attendanceModal.outTime ?? ''}
                      onChange={(event) =>
                        setAttendanceModal((prev) => ({
                          ...prev,
                          outTime: event.target.value,
                        }))
                      }
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-sm font-medium">ملاحظات</label>
                  <Input
                    value={attendanceModal.notes ?? ''}
                    onChange={(event) =>
                      setAttendanceModal((prev) => ({
                        ...prev,
                        notes: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>
              <DialogFooter className="mt-4 flex flex-row justify-between gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setAttendanceModal({
                      open: false,
                    })
                  }
                >
                  إلغاء
                </Button>
                <Button
                  type="button"
                  onClick={async () => {
                    try {
                      if (!attendanceModal.employeeId || !attendanceModal.date) return;
                      const payload: AttendanceDayPayload = {
                        status: attendanceModal.status ?? 'present',
                        in: attendanceModal.inTime || null,
                        out: attendanceModal.outTime || null,
                        notes: attendanceModal.notes || null,
                        source: 'manual',
                      };
                      await setDayStatusFallback(
                        attendanceModal.employeeId,
                        attendanceModal.date,
                        payload,
                      );
                      await queryClient.invalidateQueries({
                        queryKey: ['hr', 'attendance-monthly', selectedPeriod.year, selectedPeriod.month],
                      });
                      toast({ title: t('messages.saveSuccess') });
                      setAttendanceModal({ open: false });
                    } catch (error: any) {
                      toast({
                        title: t('messages.operationFailed'),
                        description: error?.message ?? '',
                        variant: 'destructive',
                      });
                    }
                  }}
                >
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </TabsContent>

        <TabsContent value="payroll">
          <div className="grid gap-4">
            <Card className="border-border/60">
              <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle>{t('hr.payrollProcessing.title')}</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {t('hr.payrollProcessing.description')}
                  </p>
                </div>
                <div className="flex flex-col gap-2 md:flex-row md:items-center">
                  <label className="text-sm font-medium" htmlFor="payroll-period">
                    {t('hr.payrollProcessing.periodLabel')}
                  </label>
                  <Input
                    id="payroll-period"
                    type="month"
                    value={selectedMonthValue}
                    onChange={handlePeriodChange}
                    className="w-[200px]"
                  />
                  <Button variant="outline" onClick={() => refetchPayrollPreview()}>
                    {t('hr.payrollProcessing.refresh')}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {previewLoading ? (
                  <p className="text-sm text-muted-foreground">{t('messages.loading')}</p>
                ) : payrollPreview ? (
                  <>
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <SummaryCard
                        label={t('hr.payrollProcessing.cards.gross')}
                        value={payrollPreview.totals.gross}
                      />
                      <SummaryCard
                        label={t('hr.payrollProcessing.cards.allowances')}
                        value={payrollPreview.totals.allowances}
                      />
                      <SummaryCard
                        label={t('hr.payrollProcessing.cards.deductions')}
                        value={payrollPreview.totals.deductions + payrollPreview.totals.absence}
                      />
                      <SummaryCard
                        label={t('hr.payrollProcessing.cards.net')}
                        value={payrollPreview.totals.net}
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                      <Badge variant={payrollPreview.locked ? 'destructive' : 'outline'}>
                        {payrollPreview.locked
                          ? t('hr.payrollProcessing.locked')
                          : t('hr.payrollProcessing.unlocked')}
                      </Badge>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={!payrollPreview.employees.length}
                          onClick={() => {
                            const rows = [
                              [
                                t('hr.payrollProcessing.table.employee'),
                                t('hr.payrollProcessing.table.base'),
                                t('hr.payrollProcessing.table.allowances'),
                                t('hr.payrollProcessing.table.overtime'),
                                t('hr.payrollProcessing.table.deductions'),
                                t('hr.payrollProcessing.table.absence'),
                                t('hr.payrollProcessing.table.net'),
                              ],
                              ...payrollPreview.employees.map((employee) => [
                                employee.name,
                                employee.baseSalary,
                                employee.allowanceTotal,
                                employee.overtimeAmount,
                                employee.deductions,
                                employee.absenceAmount,
                                employee.net,
                              ]),
                            ];
                            const csv = rows
                              .map((row) =>
                                row
                                  .map((cell) =>
                                    typeof cell === 'number'
                                      ? cell
                                      : `"${String(cell).replace(/"/g, '""')}"`,
                                  )
                                  .join(','),
                              )
                              .join('\n');
                            const blob = new Blob(['\uFEFF' + csv], {
                              type: 'text/csv;charset=utf-8;',
                            });
                            const url = URL.createObjectURL(blob);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = `payroll_${selectedPeriod.year}_${String(
                              selectedPeriod.month,
                            ).padStart(2, '0')}.csv`;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);
                          }}
                        >
                          {t('hr.payrollProcessing.exportExcel')}
                        </Button>
                        <Button
                          disabled={
                            payrollPreview.locked ||
                            processPayrollMutation.isPending ||
                            !payrollPreview.employees.length
                          }
                          onClick={() => processPayrollMutation.mutate()}
                        >
                          {processPayrollMutation.isPending
                            ? t('messages.loading')
                            : t('hr.payrollProcessing.lockButton')}
                        </Button>
                      </div>
                    </div>
                    <ScrollArea className="h-[360px]">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>{t('hr.payrollProcessing.table.employee')}</TableHead>
                            <TableHead>{t('hr.payrollProcessing.table.base')}</TableHead>
                            <TableHead>{t('hr.payrollProcessing.table.allowances')}</TableHead>
                            <TableHead>{t('hr.payrollProcessing.table.overtime')}</TableHead>
                            <TableHead>{t('hr.payrollProcessing.table.deductions')}</TableHead>
                            <TableHead>{t('hr.payrollProcessing.table.absence')}</TableHead>
                            <TableHead>{t('hr.payrollProcessing.table.net')}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {payrollPreview.employees.map((employee) => (
                            <TableRow key={employee.employeeId}>
                              <TableCell>
                                <div className="font-semibold">{employee.name}</div>
                                <p className="text-xs text-muted-foreground">
                                  {employee.employeeCode || '—'}
                                </p>
                              </TableCell>
                              <TableCell>{employee.baseSalary.toLocaleString()}</TableCell>
                              <TableCell>{employee.allowanceTotal.toLocaleString()}</TableCell>
                              <TableCell>{employee.overtimeAmount.toLocaleString()}</TableCell>
                              <TableCell>{employee.deductions.toLocaleString()}</TableCell>
                              <TableCell>
                                {employee.absenceAmount.toLocaleString()} ({employee.absenceDays})
                              </TableCell>
                              <TableCell className="font-semibold">
                                {employee.net.toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </ScrollArea>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('hr.payrollProcessing.noData')}</p>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>دورات الرواتب المتعاقبة</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    متابعة صافي الرواتب، الخصومات، حالة الاعتماد لكل دورة.
                  </p>
                </div>
              </CardHeader>
              <CardContent>
                {payrollLoading ? (
                  <p className="text-sm text-muted-foreground">جارٍ تحميل بيانات الرواتب...</p>
                ) : payrollRuns.length === 0 ? (
                  <p className="text-sm text-muted-foreground">لا توجد دورات رواتب حتى الآن.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الدورة</TableHead>
                        <TableHead>الفترة</TableHead>
                        <TableHead>عدد الموظفين</TableHead>
                        <TableHead>صافي الرواتب</TableHead>
                        <TableHead>الخصومات</TableHead>
                        <TableHead>الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {payrollRuns.map((run) => (
                        <TableRow key={run.id}>
                          <TableCell className="font-semibold">{run.periodCode}</TableCell>
                          <TableCell>
                            {run.periodStart && run.periodEnd
                              ? `${new Date(run.periodStart).toLocaleDateString()} - ${new Date(run.periodEnd).toLocaleDateString()}`
                              : '—'}
                          </TableCell>
                          <TableCell>{run.employeeCount ?? '—'}</TableCell>
                          <TableCell>{run.totalNet?.toLocaleString() ?? '—'}</TableCell>
                          <TableCell>{run.totalDeductions?.toLocaleString() ?? '—'}</TableCell>
                          <TableCell>
                            <Badge
                              className={`capitalize ${statusBadges[run.status] ?? 'bg-slate-100 text-slate-700'}`}
                            >
                              {run.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="leaves">
          <Card className="border-border/60">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>طلبات الإجازة</CardTitle>
                <p className="text-sm text-muted-foreground">
                  موافقات فورية، سعة استهلاك الرصيد، ونطاق التغطية التشغيلية.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline">تقويم الإجازات</Button>
                <Button>اعتماد جماعي</Button>
              </div>
            </CardHeader>
            <CardContent>
              {leavesLoading ? (
                <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
              ) : leaveRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  لا توجد طلبات إجازة مسجلة خلال الفترة المحددة.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>الموظف</TableHead>
                      <TableHead>نوع الإجازة</TableHead>
                      <TableHead>الفترة</TableHead>
                      <TableHead>الأيام</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaveRequests.map((request) => (
                      <TableRow key={request.id}>
                        <TableCell>{request.employeeName || request.employeeId}</TableCell>
                        <TableCell>{request.leaveType || '—'}</TableCell>
                        <TableCell>
                          {new Date(request.startDate).toLocaleDateString()} -{' '}
                          {new Date(request.endDate).toLocaleDateString()}
                        </TableCell>
                        <TableCell>{request.totalDays ?? '—'}</TableCell>
                        <TableCell>
                          <Badge
                            className={`capitalize ${statusBadges[request.status] ?? 'bg-slate-100 text-slate-700'}`}
                          >
                            {request.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settlements">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>تسويات نهاية الخدمة</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    حساب مستحقات نهاية الخدمة، مكافآت، مخالفات، سلفيات.
                  </p>
                </div>
                <Button variant="outline" size="sm">
                  احتساب تسوية جديدة
                </Button>
              </CardHeader>
              <CardContent>
                {settlementsLoading ? (
                  <p className="text-sm text-muted-foreground">جارٍ التحميل...</p>
                ) : settlements.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    لا توجد تسويات مسجلة في المدة الحالية.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>الموظف</TableHead>
                        <TableHead>النوع</TableHead>
                        <TableHead>المبلغ المستحق</TableHead>
                        <TableHead>المبلغ الدافع</TableHead>
                        <TableHead>الحالة</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {settlements.map((settlement) => (
                        <TableRow key={settlement.id}>
                          <TableCell>{settlement.employeeName || settlement.employeeId}</TableCell>
                          <TableCell>{settlement.settlementType}</TableCell>
                          <TableCell>{settlement.calculatedAmount.toLocaleString()}</TableCell>
                          <TableCell>{settlement.payableAmount.toLocaleString()}</TableCell>
                          <TableCell>
                            <Badge
                              className={`capitalize ${statusBadges[settlement.status] ?? 'bg-slate-100 text-slate-700'}`}
                            >
                              {settlement.status}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader>
                <CardTitle>حاسبة التسويات الفورية</CardTitle>
                <p className="text-sm text-muted-foreground">
                  أدخل بيانات الموظف لاستخراج صافي الاستحقاق حسب نظام العمل السعودي.
                </p>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="space-y-1">
                  <p className="text-muted-foreground">الراتب الشهري</p>
                  <div className="rounded-md border border-border/60 px-3 py-2">5,500.00 SAR</div>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">مدة الخدمة</p>
                  <div className="rounded-md border border-border/60 px-3 py-2">4 سنوات و 2 شهر</div>
                </div>
                <div className="space-y-1">
                  <p className="text-muted-foreground">نوع انتهاء العلاقة</p>
                  <div className="rounded-md border border-border/60 px-3 py-2">استقالة نظامية</div>
                </div>
                <div className="rounded-lg border border-dashed border-emerald-300 bg-emerald-50/60 p-4 text-center">
                  <p className="text-xs uppercase text-emerald-600">الاستحقاق التقريبي</p>
                  <p className="text-3xl font-bold text-emerald-700">18,350 SAR</p>
                  <p className="text-xs text-emerald-700/80">
                    يشمل مكافأة نهاية الخدمة + الراتب المتبقي + رصيد الإجازات
                  </p>
                </div>
                <Button className="w-full">توليد كشف تفصيلي</Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="alerts">
          <div className="grid gap-4 md:grid-cols-2">
            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>التنبيهات الذكية</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    نظام تحذيرات يعتمد على التواريخ الحساسة، الحدود الائتمانية، وسياسات الشركة.
                  </p>
                </div>
                <Button variant="outline" size="sm">
                  تصدير
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {alertsLoading ? (
                  <p className="text-sm text-muted-foreground">جارٍ تحميل التنبيهات...</p>
                ) : alerts.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    لا توجد تنبيهات مفتوحة. كل المعايير ضمن الحدود.
                  </p>
                ) : (
                  alerts.map((alert) => (
                    <div
                      key={alert.id}
                      className="rounded-md border border-border/60 p-3 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-semibold">{alert.title}</p>
                        <Badge
                          className={
                            alert.severity === 'critical'
                              ? 'bg-rose-100 text-rose-800'
                              : alert.severity === 'warning'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-slate-100 text-slate-700'
                          }
                        >
                          {alert.category}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{alert.description}</p>
                      <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                        <span>{alert.employeeName || '—'}</span>
                        <span>
                          {alert.dueDate
                            ? new Date(alert.dueDate).toLocaleDateString()
                            : 'بدون موعد'}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle>تحليلات تنبؤية</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    خلاصة تنفيذية تعتمد على مؤشرات حيوية لتقليل المخاطر واتخاذ قرار أسرع.
                  </p>
                </div>
                <Button variant="outline" size="sm">
                  تحديث التوقعات
                </Button>
              </CardHeader>
              <CardContent className="space-y-3">
                {insightsLoading ? (
                  <p className="text-sm text-muted-foreground">جارٍ تحليل البيانات...</p>
                ) : (
                  insights.map((insight) => (
                    <div
                      key={insight.id}
                      className="rounded-lg border border-border/60 bg-muted/40 p-4 text-sm"
                    >
                      <div className="flex items-center justify-between">
                        <p className="font-semibold">{insight.title}</p>
                        <Badge
                          className={
                            insight.impact === 'critical'
                              ? 'bg-rose-100 text-rose-800'
                              : insight.impact === 'warning'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-emerald-100 text-emerald-800'
                          }
                        >
                          {insight.metric}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{insight.description}</p>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="settings" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>{t('hr.policies.title')}</CardTitle>
              <p className="text-sm text-muted-foreground">{t('hr.policies.description')}</p>
            </CardHeader>
            <CardContent>
              {policiesLoading && <p className="text-sm text-muted-foreground">{t('messages.loading') ?? '...'}</p>}
              {!policiesLoading && policyForm && (
                <form onSubmit={handlePoliciesSubmit} className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('hr.policies.employeeHours')}</label>
                      <Input
                        type="number"
                        min={0}
                        step={0.25}
                        value={policyForm.employee_daily_hours ?? ''}
                        onChange={(event) =>
                          handlePolicyFieldChange('employee_daily_hours', Number(event.target.value))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('hr.policies.workerHours')}</label>
                      <Input
                        type="number"
                        min={0}
                        step={0.25}
                        value={policyForm.worker_daily_hours ?? ''}
                        onChange={(event) =>
                          handlePolicyFieldChange('worker_daily_hours', Number(event.target.value))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('hr.policies.workerShifts')}</label>
                      <Input
                        type="number"
                        min={1}
                        step={1}
                        value={policyForm.worker_shifts ?? ''}
                        onChange={(event) =>
                          handlePolicyFieldChange('worker_shifts', Number(event.target.value))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('hr.policies.overtimeMultiplier')}</label>
                      <Input
                        type="number"
                        min={1}
                        step={0.1}
                        value={policyForm.overtime_multiplier ?? ''}
                        onChange={(event) =>
                          handlePolicyFieldChange('overtime_multiplier', Number(event.target.value))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('hr.policies.overtimeGrace')}</label>
                      <Input
                        type="number"
                        min={0}
                        step={5}
                        value={policyForm.overtime_grace_minutes ?? ''}
                        onChange={(event) =>
                          handlePolicyFieldChange('overtime_grace_minutes', Number(event.target.value))
                        }
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-sm font-medium">{t('hr.policies.weekendDays')}</label>
                      <div className="flex flex-wrap gap-3">
                        {weekendOptions.map((option) => (
                          <label key={option.value} className="flex items-center gap-2 text-sm">
                            <Checkbox
                              checked={policyForm.weekend_days?.includes(option.value)}
                              onCheckedChange={(checked) => handleWeekendToggle(option.value, Boolean(checked))}
                            />
                            {option.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                  <Button type="submit" disabled={policyMutation.isPending}>
                    {policyMutation.isPending ? t('messages.loading') ?? '...' : t('hr.policies.save')}
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader>
              <CardTitle>{t('hr.payrollAccounts.title')}</CardTitle>
              <p className="text-sm text-muted-foreground">
                {t('hr.payrollAccounts.description')}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {glAccountsLoading && (
                <p className="text-sm text-muted-foreground">{t('messages.loading') ?? '...'}</p>
              )}
              {!glAccountsLoading && glAccounts.length === 0 && (
                <p className="text-sm text-muted-foreground">{t('hr.payrollAccounts.noAccounts')}</p>
              )}
              {!!glAccounts.length && (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('hr.payrollAccounts.component')}</TableHead>
                      <TableHead className="w-[320px]">{t('hr.payrollAccounts.account')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payrollAccountTypes.map((type) => {
                      const selectedAccount = getMappingValue(type.key);
                      return (
                        <TableRow key={type.key}>
                          <TableCell>
                            <div className="font-medium">{type.label}</div>
                            <p className="text-xs text-muted-foreground">{type.description}</p>
                          </TableCell>
                          <TableCell>
                            <Select
                              value={selectedAccount ?? undefined}
                              onValueChange={(value) =>
                                accountMutation.mutate({ accountType: type.key, glAccountId: value })
                              }
                              disabled={accountMutation.isPending || glAccountsLoading || mappingsLoading}
                            >
                              <SelectTrigger>
                                <SelectValue placeholder={t('hr.payrollAccounts.accountPlaceholder')} />
                              </SelectTrigger>
                              <SelectContent>
                                {glAccounts.map((account) => (
                                  <SelectItem key={account.id} value={account.id}>
                                    {account.code} — {account.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <Card className="border-border/60">
    <CardHeader className="space-y-1">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value.toLocaleString()}</p>
    </CardHeader>
  </Card>
);
