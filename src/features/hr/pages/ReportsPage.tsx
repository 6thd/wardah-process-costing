import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BarChart3, Building2, Calendar, Clock, DollarSign, Download,
  FileSpreadsheet, FileText, PieChart, TrendingUp, UserCheck, Users,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { getEffectiveTenantId } from '@/lib/supabase';
import { listAttendanceForPeriod } from '@/services/hr/attendance-service';
import { listLeaveBalances } from '@/services/hr/leave-service';
import {
  listEmployeesForReports,
  listPayrollRunsForReport,
  type ReportEmployee,
  type ReportPayrollRun,
} from '@/services/hr/reports-service';
import { useHrTranslation } from '../i18n';
import '../translations/reports';
import {
  buildAttendanceSummaryReport,
  buildDepartmentAnalysis,
  buildEmployeeListReport,
  buildLeaveBalanceReport,
  buildPayrollSummaryReport,
  buildTurnoverReport,
  exportReportToExcel,
  UNASSIGNED_DEPARTMENT,
  type BuiltReport,
  type ReportValue,
  type ResolvedReportColumn,
} from './reports/report-builders';

type ReportId =
  | 'employee_list'
  | 'attendance_summary'
  | 'payroll_summary'
  | 'department_analysis'
  | 'turnover_report'
  | 'leave_balance';

type ReportDefinition = {
  id: ReportId;
  nameKey: string;
  descriptionKey: string;
  icon: LucideIcon;
};

type SubmittedReport = {
  reportType: ReportId;
  orgId: string;
  dateFrom: string;
  dateTo: string;
  attendanceMonth: string;
  department: string;
};

const REPORT_TYPES: ReportDefinition[] = [
  { id: 'employee_list', nameKey: 'reports.types.employeeList.name', descriptionKey: 'reports.types.employeeList.description', icon: Users },
  { id: 'attendance_summary', nameKey: 'reports.types.attendanceSummary.name', descriptionKey: 'reports.types.attendanceSummary.description', icon: Clock },
  { id: 'payroll_summary', nameKey: 'reports.types.payrollSummary.name', descriptionKey: 'reports.types.payrollSummary.description', icon: DollarSign },
  { id: 'department_analysis', nameKey: 'reports.types.departmentAnalysis.name', descriptionKey: 'reports.types.departmentAnalysis.description', icon: Building2 },
  { id: 'turnover_report', nameKey: 'reports.types.turnoverReport.name', descriptionKey: 'reports.types.turnoverReport.description', icon: TrendingUp },
  { id: 'leave_balance', nameKey: 'reports.types.leaveBalance.name', descriptionKey: 'reports.types.leaveBalance.description', icon: Calendar },
];

const REPORT_PERMISSIONS: Record<ReportId, readonly string[]> = {
  employee_list: ['hr.employees.read'],
  department_analysis: ['hr.employees.read'],
  turnover_report: ['hr.employees.read'],
  payroll_summary: ['hr.payroll.read'],
  attendance_summary: ['hr.employees.read', 'hr.attendance.read'],
  leave_balance: ['hr.employees.read', 'hr.leaves.read', 'hr.payroll.read'],
};

const now = new Date();
const DEFAULT_TO_DATE = now.toISOString().slice(0, 10);
const DEFAULT_FROM_DATE = `${now.getUTCFullYear()}-01-01`;
const DEFAULT_ATTENDANCE_MONTH = DEFAULT_TO_DATE.slice(0, 7);
const dashboardFromDate = new Date(Date.UTC(
  now.getUTCFullYear(), now.getUTCMonth() - 5, 1,
)).toISOString().slice(0, 10);

const DATE_FILTER_REPORTS = new Set<ReportId>([
  'employee_list', 'payroll_summary', 'turnover_report',
]);
const DEPARTMENT_FILTER_REPORTS = new Set<ReportId>([
  'employee_list', 'department_analysis',
]);

const reportIsPermitted = (
  reportId: ReportId,
  hasPermissionKey: (key: string) => boolean,
) => REPORT_PERMISSIONS[reportId].every(hasPermissionKey);

const formatReportValue = (value: ReportValue, numberLocale: string) =>
  typeof value === 'number' ? value.toLocaleString(numberLocale) : value;

type Translate = (key: string) => string;

async function generateSubmittedReport(
  submittedReport: SubmittedReport | null,
): Promise<BuiltReport> {
  if (!submittedReport) throw new Error('Report criteria were not submitted.');
  const { reportType, orgId } = submittedReport;

  if (reportType === 'payroll_summary') {
    const runs = await listPayrollRunsForReport({
      orgId,
      from: submittedReport.dateFrom,
      to: submittedReport.dateTo,
    });
    return buildPayrollSummaryReport(runs);
  }

  const employees = await listEmployeesForReports({ orgId });
  if (reportType === 'employee_list') {
    return buildEmployeeListReport(employees, {
      from: submittedReport.dateFrom,
      to: submittedReport.dateTo,
      department: submittedReport.department,
    });
  }
  if (reportType === 'department_analysis') {
    return buildDepartmentAnalysis(employees, submittedReport.department);
  }
  if (reportType === 'turnover_report') {
    return buildTurnoverReport(employees, {
      from: submittedReport.dateFrom,
      to: submittedReport.dateTo,
    });
  }
  if (reportType === 'attendance_summary') {
    const [year, month] = submittedReport.attendanceMonth.split('-').map(Number);
    const attendance = await listAttendanceForPeriod(
      employees.map((employee) => employee.id), year, month,
    );
    return buildAttendanceSummaryReport(employees, attendance);
  }

  const balances = await listLeaveBalances(
    employees.map((employee) => employee.id), orgId,
  );
  return buildLeaveBalanceReport(employees, balances);
}

function useReportState() {
  const [selectedReport, setSelectedReport] = useState<ReportId | ''>('');
  const [dateFrom, setDateFrom] = useState(DEFAULT_FROM_DATE);
  const [dateTo, setDateTo] = useState(DEFAULT_TO_DATE);
  const [attendanceMonth, setAttendanceMonth] = useState(DEFAULT_ATTENDANCE_MONTH);
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const [submittedReport, setSubmittedReport] = useState<SubmittedReport | null>(null);
  const [generation, setGeneration] = useState(0);
  return { selectedReport, setSelectedReport, dateFrom, setDateFrom, dateTo, setDateTo,
    attendanceMonth, setAttendanceMonth, selectedDepartment, setSelectedDepartment,
    submittedReport, setSubmittedReport, generation, setGeneration };
}

function useReportDashboard(
  currentOrgId: string | null,
  hasPermissionKey: (key: string) => boolean,
  t: Translate,
) {
  const canReadEmployees = hasPermissionKey('hr.employees.read');
  const canReadPayroll = hasPermissionKey('hr.payroll.read');
  const { data: rawEmployees = [] } = useQuery({
    queryKey: ['hr', 'reports', 'employees', currentOrgId],
    queryFn: () => listEmployeesForReports({ orgId: currentOrgId ?? undefined }),
    enabled: canReadEmployees && Boolean(currentOrgId),
  });
  const { data: rawPayrollRuns = [] } = useQuery({
    queryKey: ['hr', 'reports', 'payroll-trends', currentOrgId],
    queryFn: () => listPayrollRunsForReport({
      orgId: currentOrgId ?? undefined, from: dashboardFromDate, to: DEFAULT_TO_DATE,
    }),
    enabled: canReadPayroll && Boolean(currentOrgId),
  });
  const employees = useMemo(
    () => canReadEmployees ? rawEmployees : [], [canReadEmployees, rawEmployees],
  );
  const payrollRuns = useMemo(
    () => canReadPayroll ? rawPayrollRuns : [], [canReadPayroll, rawPayrollRuns],
  );
  const reportTypes = useMemo(() => REPORT_TYPES
    .filter((report) => reportIsPermitted(report.id, hasPermissionKey))
    .map((report) => ({ ...report, name: t(report.nameKey),
      description: t(report.descriptionKey) })), [hasPermissionKey, t]);
  const departmentDistribution = useMemo(
    () => toDepartmentDistribution(employees, t), [employees, t],
  );
  const quickStats = useMemo(
    () => calculateQuickStats(employees, payrollRuns), [employees, payrollRuns],
  );
  return { payrollRuns, reportTypes, departmentDistribution, quickStats };
}

function useReportLifecycle(
  state: ReturnType<typeof useReportState>,
  currentOrgId: string | null,
  selectedAllowed: boolean,
  submittedAllowed: boolean,
) {
  const queryClient = useQueryClient();
  useEffect(() => {
    const selectionRevoked = Boolean(state.selectedReport) && !selectedAllowed;
    const resultRevoked = Boolean(state.submittedReport) && !submittedAllowed;
    if (!selectionRevoked && !resultRevoked) return;
    if (selectionRevoked) state.setSelectedReport('');
    state.setSubmittedReport(null);
    void queryClient.cancelQueries({ queryKey: ['hr-report'] });
    queryClient.removeQueries({ queryKey: ['hr-report'] });
  }, [queryClient, selectedAllowed, state, submittedAllowed]);
  useEffect(() => {
    if (!state.submittedReport || state.submittedReport.orgId === currentOrgId) return;
    state.setSubmittedReport(null);
    void queryClient.cancelQueries({ queryKey: ['hr-report'] });
    queryClient.removeQueries({ queryKey: ['hr-report'] });
  }, [currentOrgId, queryClient, state]);
}

function useReportOutput(
  state: ReturnType<typeof useReportState>,
  submittedAllowed: boolean,
  t: Translate,
) {
  const query = useQuery<BuiltReport>({
    queryKey: ['hr-report', state.submittedReport?.orgId, state.generation,
      state.submittedReport],
    enabled: Boolean(state.submittedReport && submittedAllowed),
    queryFn: () => generateSubmittedReport(state.submittedReport),
  });
  const columns: ResolvedReportColumn[] = useMemo(
    () => (submittedAllowed ? query.data?.columns ?? [] : [])
      .map((column) => ({ ...column, label: t(column.labelKey) })),
    [query.data?.columns, submittedAllowed, t],
  );
  const rows = useMemo(
    () => localizeReportRows(submittedAllowed ? query.data?.rows ?? [] : [], t),
    [query.data?.rows, submittedAllowed, t],
  );
  return { query, columns, rows };
}

function useReportActions(
  state: ReturnType<typeof useReportState>,
  output: ReturnType<typeof useReportOutput>,
  selectedAllowed: boolean,
  submittedAllowed: boolean,
  t: Translate,
) {
  const { toast } = useToast();
  const generate = async () => {
    if (!state.selectedReport || !selectedAllowed) return;
    const orgId = await getEffectiveTenantId();
    if (!orgId) {
      toast({ title: t('reports.errors.organizationMissing'), variant: 'destructive' });
      return;
    }
    state.setSubmittedReport({ reportType: state.selectedReport, orgId,
      dateFrom: state.dateFrom, dateTo: state.dateTo,
      attendanceMonth: state.attendanceMonth, department: state.selectedDepartment });
    state.setGeneration((value) => value + 1);
  };
  const exportReport = async () => {
    if (!output.query.data || !submittedAllowed || !output.rows.length) return;
    try {
      await exportReportToExcel(
        output.columns, output.rows, output.query.data.filenamePrefix,
      );
      toast({ title: t('reports.export.success') });
    } catch (error) {
      console.error('Failed to export HR report:', error);
      toast({ title: t('reports.export.failure'), variant: 'destructive' });
    }
  };
  return { generate, exportReport };
}

function toDepartmentDistribution(
  employees: ReportEmployee[],
  t: Translate,
): DepartmentDistribution[] {
  return buildDepartmentAnalysis(employees).rows.map((row) => ({
    key: String(row.department),
    name: row.department === UNASSIGNED_DEPARTMENT
      ? t('reports.unassignedDepartment')
      : String(row.department),
    count: Number(row.count),
    percentage: Number(row.percentage),
  }));
}

function calculateQuickStats(
  employees: ReportEmployee[],
  payrollRuns: ReportPayrollRun[],
) {
  const activeEmployees = employees.filter((employee) => employee.status === 'active').length;
  const totalPayroll = payrollRuns.reduce(
    (sum, run) => sum + Number(run.total_net ?? 0), 0,
  );
  return { totalEmployees: employees.length, activeEmployees, totalPayroll,
    avgSalary: activeEmployees ? totalPayroll / activeEmployees : 0 };
}

function localizeReportRows(
  rows: Array<Record<string, ReportValue>>,
  t: Translate,
): Array<Record<string, ReportValue>> {
  return rows.map((row) => Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value === UNASSIGNED_DEPARTMENT ? t('reports.unassignedDepartment') : value,
    ]),
  ) as Record<string, ReportValue>);
}

export const ReportsPage: React.FC = () => {
  const { t, i18n } = useHrTranslation();
  const { currentOrgId } = useAuth();
  const { hasPermissionKey } = usePermissions();
  const state = useReportState();
  const isRtl = i18n.dir() === 'rtl';
  const numberLocale = isRtl ? 'ar-SA' : 'en-US';
  const dashboard = useReportDashboard(currentOrgId, hasPermissionKey, t);
  const submittedAllowed = state.submittedReport
    ? reportIsPermitted(state.submittedReport.reportType, hasPermissionKey)
    : false;
  const selectedAllowed = state.selectedReport
    ? reportIsPermitted(state.selectedReport, hasPermissionKey)
    : true;
  useReportLifecycle(state, currentOrgId, selectedAllowed, submittedAllowed);
  const output = useReportOutput(state, submittedAllowed, t);
  const actions = useReportActions(state, output, selectedAllowed, submittedAllowed, t);
  return <ReportsPageLayout t={t} isRtl={isRtl} numberLocale={numberLocale}
    state={state} dashboard={dashboard} output={output} actions={actions}
    selectedAllowed={selectedAllowed} submittedAllowed={submittedAllowed} />;
};

type ReportsPageLayoutProps = {
  t: Translate;
  isRtl: boolean;
  numberLocale: string;
  state: ReturnType<typeof useReportState>;
  dashboard: ReturnType<typeof useReportDashboard>;
  output: ReturnType<typeof useReportOutput>;
  actions: ReturnType<typeof useReportActions>;
  selectedAllowed: boolean;
  submittedAllowed: boolean;
};

const ReportsPageLayout = (props: ReportsPageLayoutProps) => {
  const { t, isRtl, numberLocale, state, dashboard, output, actions,
    selectedAllowed, submittedAllowed } = props;
  const showDates = Boolean(state.selectedReport
    && DATE_FILTER_REPORTS.has(state.selectedReport));
  const showDepartment = Boolean(state.selectedReport
    && DEPARTMENT_FILTER_REPORTS.has(state.selectedReport));
  const iconSpacing = isRtl ? 'ml-2' : 'mr-2';
  return <div className="space-y-6">
    <div className="flex flex-col gap-2"><h1 className="text-3xl font-bold tracking-tight">{t('reports.title')}</h1><p className="text-muted-foreground">{t('reports.subtitle')}</p></div>
    <div className="grid gap-4 md:grid-cols-4">
      <StatCard color="blue" label={t('reports.stats.totalEmployees')} value={dashboard.quickStats.totalEmployees.toLocaleString(numberLocale)} icon={Users} />
      <StatCard color="emerald" label={t('reports.stats.activeEmployees')} value={dashboard.quickStats.activeEmployees.toLocaleString(numberLocale)} icon={UserCheck} />
      <StatCard color="purple" label={t('reports.stats.totalPayroll')} value={dashboard.quickStats.totalPayroll.toLocaleString(numberLocale)} suffix={t('reports.currencyShort')} icon={DollarSign} />
      <StatCard color="amber" label={t('reports.stats.averageSalary')} value={Math.round(dashboard.quickStats.avgSalary).toLocaleString(numberLocale)} suffix={t('reports.currencyShort')} icon={TrendingUp} />
    </div>
    <div className="grid gap-6 lg:grid-cols-3"><ReportGeneratorCard t={t}
      reportTypes={dashboard.reportTypes} selectedReport={state.selectedReport}
      setSelectedReport={state.setSelectedReport} showDepartmentFilter={showDepartment}
      selectedDepartment={state.selectedDepartment} setSelectedDepartment={state.setSelectedDepartment}
      departmentDistribution={dashboard.departmentDistribution} showDateFilters={showDates}
      dateFrom={state.dateFrom} setDateFrom={state.setDateFrom} dateTo={state.dateTo}
      setDateTo={state.setDateTo} attendanceMonth={state.attendanceMonth}
      setAttendanceMonth={state.setAttendanceMonth} selectedAllowed={selectedAllowed}
      submittedAllowed={submittedAllowed} isFetching={output.query.isFetching}
      hasRows={Boolean(output.rows.length)} iconSpacing={iconSpacing}
      onGenerate={actions.generate} onExport={actions.exportReport} />
      <QuickReportsCard t={t} reports={dashboard.reportTypes} isRtl={isRtl}
        onSelect={state.setSelectedReport} />
    </div>
    <ReportResultsCard visible={Boolean(state.submittedReport && submittedAllowed)}
      reportType={state.submittedReport?.reportType} t={t} numberLocale={numberLocale}
      columns={output.columns} rows={output.rows} isFetching={output.query.isFetching}
      isError={output.query.isError} isSuccess={output.query.isSuccess}
      error={output.query.error} />
    <DepartmentDistributionCard distribution={dashboard.departmentDistribution} numberLocale={numberLocale} emptyLabel={t('reports.results.empty')} title={t('reports.departmentDistribution')} />
    <PayrollTrendsCard payrollRuns={dashboard.payrollRuns} numberLocale={numberLocale} currency={t('reports.currencyShort')} title={t('reports.payrollTrends')} description={t('reports.payrollTrendsDescription')} emptyLabel={t('reports.noPayrollData')} />
  </div>;
};

const QuickReportsCard = ({ t, reports, isRtl, onSelect }: {
  t: Translate;
  reports: Array<ReportDefinition & { name: string; description: string }>;
  isRtl: boolean;
  onSelect: React.Dispatch<React.SetStateAction<ReportId | ''>>;
}) => <Card><CardHeader><CardTitle className="text-lg">{t('reports.quickReports')}</CardTitle></CardHeader><CardContent className="space-y-2">
  {reports.slice(0, 4).map((report) => <Button key={report.id} variant="outline" className="w-full justify-start h-auto py-3" onClick={() => onSelect(report.id)}>
    <report.icon className={`h-4 w-4 ${isRtl ? 'ml-3' : 'mr-3'} text-muted-foreground`} />
    <div className={isRtl ? 'text-right' : 'text-left'}><p className="font-medium">{report.name}</p><p className="text-xs text-muted-foreground">{report.description}</p></div>
  </Button>)}
</CardContent></Card>;

type ReportGeneratorCardProps = {
  t: (key: string) => string;
  reportTypes: Array<ReportDefinition & { name: string; description: string }>;
  selectedReport: ReportId | '';
  setSelectedReport: React.Dispatch<React.SetStateAction<ReportId | ''>>;
  showDepartmentFilter: boolean;
  selectedDepartment: string;
  setSelectedDepartment: React.Dispatch<React.SetStateAction<string>>;
  departmentDistribution: DepartmentDistribution[];
  showDateFilters: boolean;
  dateFrom: string;
  setDateFrom: React.Dispatch<React.SetStateAction<string>>;
  dateTo: string;
  setDateTo: React.Dispatch<React.SetStateAction<string>>;
  attendanceMonth: string;
  setAttendanceMonth: React.Dispatch<React.SetStateAction<string>>;
  selectedAllowed: boolean;
  submittedAllowed: boolean;
  isFetching: boolean;
  hasRows: boolean;
  iconSpacing: string;
  onGenerate: () => Promise<void>;
  onExport: () => Promise<void>;
};

const ReportGeneratorCard = (props: ReportGeneratorCardProps) => {
  const { t, reportTypes, selectedReport, setSelectedReport, showDepartmentFilter,
    selectedDepartment, setSelectedDepartment, departmentDistribution, showDateFilters,
    dateFrom, setDateFrom, dateTo, setDateTo, attendanceMonth, setAttendanceMonth,
    selectedAllowed, submittedAllowed, isFetching, hasRows, iconSpacing,
    onGenerate, onExport } = props;
  return <Card className="lg:col-span-2"><CardHeader>
    <CardTitle className="flex items-center gap-2"><FileSpreadsheet className="h-5 w-5 text-teal-600" />{t('reports.generator.title')}</CardTitle>
    <CardDescription>{t('reports.generator.description')}</CardDescription>
  </CardHeader><CardContent className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2"><div className="space-y-2">
      <Label htmlFor="hr-report-type">{t('reports.generator.reportType')}</Label>
      <Select value={selectedReport} onValueChange={(value) => setSelectedReport(value as ReportId)}><SelectTrigger id="hr-report-type"><SelectValue placeholder={t('reports.generator.selectReportType')} /></SelectTrigger><SelectContent>{reportTypes.map((report) => <SelectItem key={report.id} value={report.id}><div className="flex items-center gap-2"><report.icon className="h-4 w-4" />{report.name}</div></SelectItem>)}</SelectContent></Select>
    </div>{showDepartmentFilter && <div className="space-y-2">
      <Label htmlFor="hr-report-department">{t('reports.generator.department')}</Label>
      <Select value={selectedDepartment} onValueChange={setSelectedDepartment}><SelectTrigger id="hr-report-department"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t('common.allDepartments')}</SelectItem>{departmentDistribution.map((department) => <SelectItem key={department.key} value={department.key}>{department.name}</SelectItem>)}</SelectContent></Select>
    </div>}</div>
    {showDateFilters && <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2"><Label htmlFor="hr-report-from">{t('reports.generator.fromDate')}</Label><Input id="hr-report-from" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></div>
      <div className="space-y-2"><Label htmlFor="hr-report-to">{t('reports.generator.toDate')}</Label><Input id="hr-report-to" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></div>
    </div>}
    {selectedReport === 'attendance_summary' && <div className="space-y-2"><Label htmlFor="hr-report-month">{t('reports.generator.month')}</Label><Input id="hr-report-month" type="month" value={attendanceMonth} onChange={(event) => setAttendanceMonth(event.target.value)} /></div>}
    <div className="flex gap-3">
      <Button className="flex-1 bg-teal-600 hover:bg-teal-700" onClick={() => void onGenerate()} disabled={!selectedReport || !selectedAllowed || isFetching}><FileText className={`h-4 w-4 ${iconSpacing}`} />{t('reports.generator.generate')}</Button>
      <Button variant="outline" onClick={() => void onExport()} disabled={!submittedAllowed || isFetching || !hasRows}><Download className={`h-4 w-4 ${iconSpacing}`} />{t('reports.generator.exportExcel')}</Button>
    </div>
  </CardContent></Card>;
};

type ReportResultsCardProps = {
  visible: boolean;
  reportType?: ReportId;
  t: (key: string) => string;
  numberLocale: string;
  columns: ResolvedReportColumn[];
  rows: Array<Record<string, ReportValue>>;
  isFetching: boolean;
  isError: boolean;
  isSuccess: boolean;
  error: unknown;
};

const ReportResultsCard = (props: ReportResultsCardProps) => {
  const { visible, reportType, t, numberLocale, columns, rows,
    isFetching, isError, isSuccess, error } = props;
  if (!visible) return null;
  return <Card data-testid="report-results">
    <CardHeader><CardTitle>{t('reports.results.title')}</CardTitle><CardDescription>{t('reports.results.description')}</CardDescription></CardHeader>
    <CardContent>
      {isFetching && <div className="space-y-3"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-full" /></div>}
      {!isFetching && isError && <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-destructive">{t('reports.results.error')}: {error instanceof Error ? error.message : ''}</div>}
      {!isFetching && isSuccess && !rows.length && <div className="py-10 text-center text-muted-foreground">{t('reports.results.empty')}</div>}
      {!isFetching && rows.length > 0 && <div className="overflow-x-auto"><Table><TableHeader><TableRow>{columns.map((column) => <TableHead key={column.key}>{column.label}</TableHead>)}</TableRow></TableHeader><TableBody>{rows.map((row, index) => <TableRow key={`${reportType}-${index}`}>{columns.map((column) => <TableCell key={column.key}>{formatReportValue(row[column.key] ?? '', numberLocale)}</TableCell>)}</TableRow>)}</TableBody></Table></div>}
    </CardContent>
  </Card>;
};

type StatCardProps = {
  color: 'blue' | 'emerald' | 'purple' | 'amber';
  label: string;
  value: string;
  suffix?: string;
  icon: LucideIcon;
};

const statColors = {
  blue: ['from-blue-500 to-blue-600', 'text-blue-100', 'text-blue-200'],
  emerald: ['from-emerald-500 to-emerald-600', 'text-emerald-100', 'text-emerald-200'],
  purple: ['from-purple-500 to-purple-600', 'text-purple-100', 'text-purple-200'],
  amber: ['from-amber-500 to-amber-600', 'text-amber-100', 'text-amber-200'],
} as const;

const StatCard = ({ color, label, value, suffix, icon: Icon }: StatCardProps) => {
  const [gradient, muted, iconColor] = statColors[color];
  return <Card className={`bg-gradient-to-br ${gradient} text-white`}><CardContent className="p-4"><div className="flex items-center justify-between"><div><p className={`${muted} text-sm`}>{label}</p><p className="text-2xl font-bold">{value}</p>{suffix && <p className={`text-xs ${muted}`}>{suffix}</p>}</div><Icon className={`h-10 w-10 ${iconColor}`} /></div></CardContent></Card>;
};

type DepartmentDistribution = { key: string; name: string; count: number; percentage: number };

const DepartmentDistributionCard = ({ distribution, numberLocale, emptyLabel, title }: { distribution: DepartmentDistribution[]; numberLocale: string; emptyLabel: string; title: string }) => (
  <Card>
    <CardHeader><CardTitle className="flex items-center gap-2"><PieChart className="h-5 w-5 text-blue-600" />{title}</CardTitle></CardHeader>
    <CardContent>
      {distribution.length ? <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{distribution.map((department, index) => {
        const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-purple-500', 'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'];
        return <div key={department.key} className="flex items-center gap-4 rounded-lg border p-4 hover:bg-muted/50 transition-colors"><div className={`h-12 w-12 rounded-lg ${colors[index % colors.length]} flex items-center justify-center text-white`}><Building2 className="h-6 w-6" /></div><div className="flex-1"><div className="flex items-center justify-between"><span className="font-medium">{department.name}</span><Badge variant="secondary">{department.count.toLocaleString(numberLocale)}</Badge></div><div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden"><div className={`h-full rounded-full ${colors[index % colors.length]}`} style={{ width: `${department.percentage}%` }} /></div><p className="text-xs text-muted-foreground mt-1">{department.percentage.toLocaleString(numberLocale)}%</p></div></div>;
      })}</div> : <p className="py-8 text-center text-muted-foreground">{emptyLabel}</p>}
    </CardContent>
  </Card>
);

type PayrollTrendsProps = {
  payrollRuns: Awaited<ReturnType<typeof listPayrollRunsForReport>>;
  numberLocale: string;
  currency: string;
  title: string;
  description: string;
  emptyLabel: string;
};

const PayrollTrendsCard = ({ payrollRuns, numberLocale, currency, title, description, emptyLabel }: PayrollTrendsProps) => {
  let maxAmount = 0;
  for (const run of payrollRuns) {
    maxAmount = Math.max(maxAmount, Number(run.total_net ?? 0));
  }

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><BarChart3 className="h-5 w-5 text-emerald-600" />{title}</CardTitle><CardDescription>{description}</CardDescription></CardHeader>
      <CardContent><div className="space-y-4">
        {payrollRuns.slice(0, 6).map((run) => {
        const amount = Number(run.total_net ?? 0);
        const percentage = maxAmount > 0 ? (amount / maxAmount) * 100 : 0;
        return <div key={run.id} className="space-y-2"><div className="flex items-center justify-between text-sm"><span className="font-medium">{run.run_date}</span><span className="text-muted-foreground">{amount.toLocaleString(numberLocale)} {currency}</span></div><div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500" style={{ width: `${percentage}%` }} /></div></div>;
        })}
        {!payrollRuns.length && <div className="text-center py-8 text-muted-foreground"><BarChart3 className="h-12 w-12 mx-auto text-slate-300 mb-3" /><p>{emptyLabel}</p></div>}
      </div></CardContent>
    </Card>
  );
};
