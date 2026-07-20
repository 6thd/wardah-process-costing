// src/features/hr/pages/ReportsPage.tsx
// بسم الله الرحمن الرحيم
// صفحة تقارير الموارد البشرية

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  BarChart3,
  PieChart,
  TrendingUp,
  Users,
  Calendar,
  DollarSign,
  Download,
  FileSpreadsheet,
  FileText,
  Clock,
  Building2,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import { getEmployees, getPayrollRuns } from '@/services/hr/hr-service';
import { useHrTranslation } from '../i18n';
import '../translations/reports';

type ReportDefinition = {
  id: string;
  nameKey: string;
  descriptionKey: string;
  icon: LucideIcon;
  category: string;
};

const REPORT_TYPES: ReportDefinition[] = [
  {
    id: 'employee_list',
    nameKey: 'reports.types.employeeList.name',
    descriptionKey: 'reports.types.employeeList.description',
    icon: Users,
    category: 'employees',
  },
  {
    id: 'attendance_summary',
    nameKey: 'reports.types.attendanceSummary.name',
    descriptionKey: 'reports.types.attendanceSummary.description',
    icon: Clock,
    category: 'attendance',
  },
  {
    id: 'payroll_summary',
    nameKey: 'reports.types.payrollSummary.name',
    descriptionKey: 'reports.types.payrollSummary.description',
    icon: DollarSign,
    category: 'payroll',
  },
  {
    id: 'department_analysis',
    nameKey: 'reports.types.departmentAnalysis.name',
    descriptionKey: 'reports.types.departmentAnalysis.description',
    icon: Building2,
    category: 'analytics',
  },
  {
    id: 'turnover_report',
    nameKey: 'reports.types.turnoverReport.name',
    descriptionKey: 'reports.types.turnoverReport.description',
    icon: TrendingUp,
    category: 'analytics',
  },
  {
    id: 'leave_balance',
    nameKey: 'reports.types.leaveBalance.name',
    descriptionKey: 'reports.types.leaveBalance.description',
    icon: Calendar,
    category: 'leaves',
  },
];

const DEPARTMENT_DISTRIBUTION = [
  { key: 'production', count: 45, percentage: 35 },
  { key: 'finance', count: 20, percentage: 15 },
  { key: 'humanResources', count: 10, percentage: 8 },
  { key: 'sales', count: 25, percentage: 19 },
  { key: 'informationTechnology', count: 15, percentage: 12 },
  { key: 'administration', count: 14, percentage: 11 },
];

export const ReportsPage: React.FC = () => {
  const { t, i18n } = useHrTranslation();
  const [selectedReport, setSelectedReport] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');
  const isRtl = i18n.dir() === 'rtl';
  const numberLocale = isRtl ? 'ar-SA' : 'en-US';

  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: getEmployees,
  });

  const { data: payrollRuns = [] } = useQuery({
    queryKey: ['hr', 'payroll-runs'],
    queryFn: () => getPayrollRuns(12),
  });

  const quickStats = React.useMemo(() => {
    const activeCount = employees.filter((employee: any) => employee.status === 'active').length;
    const totalPayroll = payrollRuns.reduce(
      (sum: number, run: any) => sum + (run.totalNet || 0),
      0,
    );
    const avgSalary = activeCount > 0 ? totalPayroll / activeCount : 0;

    return {
      totalEmployees: employees.length,
      activeEmployees: activeCount,
      totalPayroll,
      avgSalary,
    };
  }, [employees, payrollRuns]);

  const reportTypes = React.useMemo(
    () => REPORT_TYPES.map((report) => ({
      ...report,
      name: t(report.nameKey),
      description: t(report.descriptionKey),
    })),
    [t],
  );

  const departmentDistribution = React.useMemo(
    () => DEPARTMENT_DISTRIBUTION.map((department) => ({
      ...department,
      name: t(`reports.departments.${department.key}`),
    })),
    [t],
  );

  const handleGenerateReport = () => {
    if (!selectedReport) return;
    // TODO: Implement report generation
    console.log('Generating report:', selectedReport, { dateFrom, dateTo, selectedDepartment });
  };

  const iconSpacing = isRtl ? 'ml-2' : 'mr-2';
  const wideIconSpacing = isRtl ? 'ml-3' : 'mr-3';

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">{t('reports.title')}</h1>
        <p className="text-muted-foreground">{t('reports.subtitle')}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">{t('reports.stats.totalEmployees')}</p>
                <p className="text-3xl font-bold">{quickStats.totalEmployees.toLocaleString(numberLocale)}</p>
              </div>
              <Users className="h-10 w-10 text-blue-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-emerald-100 text-sm">{t('reports.stats.activeEmployees')}</p>
                <p className="text-3xl font-bold">{quickStats.activeEmployees.toLocaleString(numberLocale)}</p>
              </div>
              <UserCheck className="h-10 w-10 text-emerald-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm">{t('reports.stats.totalPayroll')}</p>
                <p className="text-2xl font-bold">{quickStats.totalPayroll.toLocaleString(numberLocale)}</p>
                <p className="text-xs text-purple-200">{t('reports.currencyShort')}</p>
              </div>
              <DollarSign className="h-10 w-10 text-purple-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-amber-100 text-sm">{t('reports.stats.averageSalary')}</p>
                <p className="text-2xl font-bold">{Math.round(quickStats.avgSalary).toLocaleString(numberLocale)}</p>
                <p className="text-xs text-amber-200">{t('reports.currencyShort')}</p>
              </div>
              <TrendingUp className="h-10 w-10 text-amber-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-teal-600" />
              {t('reports.generator.title')}
            </CardTitle>
            <CardDescription>{t('reports.generator.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('reports.generator.reportType')}</Label>
                <Select value={selectedReport} onValueChange={setSelectedReport}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('reports.generator.selectReportType')} />
                  </SelectTrigger>
                  <SelectContent>
                    {reportTypes.map((report) => (
                      <SelectItem key={report.id} value={report.id}>
                        <div className="flex items-center gap-2">
                          <report.icon className="h-4 w-4" />
                          {report.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('reports.generator.department')}</Label>
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.allDepartments')}</SelectItem>
                    {departmentDistribution.map((department) => (
                      <SelectItem key={department.key} value={department.key}>{department.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('reports.generator.fromDate')}</Label>
                <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>{t('reports.generator.toDate')}</Label>
                <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
              </div>
            </div>
            <div className="flex gap-3">
              <Button
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={handleGenerateReport}
                disabled={!selectedReport}
              >
                <FileText className={`h-4 w-4 ${iconSpacing}`} />
                {t('reports.generator.generate')}
              </Button>
              <Button variant="outline">
                <Download className={`h-4 w-4 ${iconSpacing}`} />
                {t('reports.generator.exportExcel')}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">{t('reports.quickReports')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {reportTypes.slice(0, 4).map((report) => (
              <Button
                key={report.id}
                variant="outline"
                className="w-full justify-start h-auto py-3"
                onClick={() => setSelectedReport(report.id)}
              >
                <report.icon className={`h-4 w-4 ${wideIconSpacing} text-muted-foreground`} />
                <div className={isRtl ? 'text-right' : 'text-left'}>
                  <p className="font-medium">{report.name}</p>
                  <p className="text-xs text-muted-foreground">{report.description}</p>
                </div>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5 text-blue-600" />
            {t('reports.departmentDistribution')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {departmentDistribution.map((department, index) => {
              const colors = [
                'bg-blue-500', 'bg-emerald-500', 'bg-purple-500',
                'bg-amber-500', 'bg-rose-500', 'bg-cyan-500',
              ];
              return (
                <div
                  key={department.key}
                  className="flex items-center gap-4 rounded-lg border p-4 hover:bg-muted/50 transition-colors"
                >
                  <div className={`h-12 w-12 rounded-lg ${colors[index % colors.length]} flex items-center justify-center text-white`}>
                    <Building2 className="h-6 w-6" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{department.name}</span>
                      <Badge variant="secondary">{department.count.toLocaleString(numberLocale)}</Badge>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full ${colors[index % colors.length]}`}
                        style={{ width: `${department.percentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{department.percentage.toLocaleString(numberLocale)}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-600" />
            {t('reports.payrollTrends')}
          </CardTitle>
          <CardDescription>{t('reports.payrollTrendsDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {payrollRuns.slice(0, 6).map((run: any, index: number) => {
              const maxAmount = Math.max(...payrollRuns.map((item: any) => item.totalNet || 0));
              const percentage = maxAmount > 0 ? ((run.totalNet || 0) / maxAmount) * 100 : 0;

              return (
                <div key={run.id || index} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">
                      {run.periodCode || t('reports.fallbackMonth', { count: index + 1 })}
                    </span>
                    <span className="text-muted-foreground">
                      {(run.totalNet || 0).toLocaleString(numberLocale)} {t('reports.currencyShort')}
                    </span>
                  </div>
                  <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-500"
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {payrollRuns.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                <BarChart3 className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                <p>{t('reports.noPayrollData')}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
