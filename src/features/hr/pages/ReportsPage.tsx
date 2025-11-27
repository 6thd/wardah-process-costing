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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
  Filter,
  Clock,
  Building2,
  Briefcase,
  UserCheck,
  UserMinus,
  AlertTriangle,
} from 'lucide-react';
import { getHrDashboardMetrics, getEmployees, getPayrollRuns, getAttendanceLogs } from '@/services/hr/hr-service';

// أنواع التقارير
const REPORT_TYPES = [
  { 
    id: 'employee_list', 
    name: 'قائمة الموظفين',
    description: 'تقرير شامل بجميع الموظفين وبياناتهم',
    icon: Users,
    category: 'employees'
  },
  { 
    id: 'attendance_summary', 
    name: 'ملخص الحضور',
    description: 'تقرير الحضور والغياب الشهري',
    icon: Clock,
    category: 'attendance'
  },
  { 
    id: 'payroll_summary', 
    name: 'ملخص الرواتب',
    description: 'تقرير إجمالي الرواتب والبدلات',
    icon: DollarSign,
    category: 'payroll'
  },
  { 
    id: 'department_analysis', 
    name: 'تحليل الأقسام',
    description: 'توزيع الموظفين حسب الأقسام',
    icon: Building2,
    category: 'analytics'
  },
  { 
    id: 'turnover_report', 
    name: 'تقرير الدوران الوظيفي',
    description: 'معدل الاستقالات والتعيينات',
    icon: TrendingUp,
    category: 'analytics'
  },
  { 
    id: 'leave_balance', 
    name: 'أرصدة الإجازات',
    description: 'تقرير أرصدة الإجازات للموظفين',
    icon: Calendar,
    category: 'leaves'
  },
];

export const ReportsPage: React.FC = () => {
  const [selectedReport, setSelectedReport] = useState<string>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('all');

  // جلب البيانات
  const { data: metrics } = useQuery({
    queryKey: ['hr', 'metrics'],
    queryFn: getHrDashboardMetrics,
  });

  const { data: employees = [] } = useQuery({
    queryKey: ['hr', 'employees'],
    queryFn: () => getEmployees(500),
  });

  const { data: payrollRuns = [] } = useQuery({
    queryKey: ['hr', 'payroll-runs'],
    queryFn: () => getPayrollRuns(12),
  });

  // إحصائيات سريعة
  const quickStats = React.useMemo(() => {
    const activeCount = employees.filter((e: any) => e.status === 'active').length;
    const totalPayroll = payrollRuns.reduce((sum: number, r: any) => sum + (r.totalNet || 0), 0);
    const avgSalary = activeCount > 0 ? totalPayroll / activeCount : 0;
    
    return {
      totalEmployees: employees.length,
      activeEmployees: activeCount,
      totalPayroll,
      avgSalary,
    };
  }, [employees, payrollRuns]);

  // توزيع الموظفين حسب القسم (محاكاة)
  const departmentDistribution = [
    { name: 'الإنتاج', count: 45, percentage: 35 },
    { name: 'المالية', count: 20, percentage: 15 },
    { name: 'الموارد البشرية', count: 10, percentage: 8 },
    { name: 'المبيعات', count: 25, percentage: 19 },
    { name: 'تقنية المعلومات', count: 15, percentage: 12 },
    { name: 'الإدارة', count: 14, percentage: 11 },
  ];

  const handleGenerateReport = () => {
    if (!selectedReport) return;
    // TODO: Implement report generation
    console.log('Generating report:', selectedReport, { dateFrom, dateTo, selectedDepartment });
  };

  return (
    <div className="space-y-6">
      {/* العنوان */}
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold tracking-tight">التقارير والتحليلات</h1>
        <p className="text-muted-foreground">
          تقارير شاملة وتحليلات متقدمة للموارد البشرية
        </p>
      </div>

      {/* إحصائيات سريعة */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="bg-gradient-to-br from-blue-500 to-blue-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm">إجمالي الموظفين</p>
                <p className="text-3xl font-bold">{quickStats.totalEmployees}</p>
              </div>
              <Users className="h-10 w-10 text-blue-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-emerald-500 to-emerald-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-emerald-100 text-sm">الموظفون النشطون</p>
                <p className="text-3xl font-bold">{quickStats.activeEmployees}</p>
              </div>
              <UserCheck className="h-10 w-10 text-emerald-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-purple-500 to-purple-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-purple-100 text-sm">إجمالي الرواتب</p>
                <p className="text-2xl font-bold">{quickStats.totalPayroll.toLocaleString()}</p>
                <p className="text-xs text-purple-200">ر.س</p>
              </div>
              <DollarSign className="h-10 w-10 text-purple-200" />
            </div>
          </CardContent>
        </Card>
        <Card className="bg-gradient-to-br from-amber-500 to-amber-600 text-white">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-amber-100 text-sm">متوسط الراتب</p>
                <p className="text-2xl font-bold">{Math.round(quickStats.avgSalary).toLocaleString()}</p>
                <p className="text-xs text-amber-200">ر.س</p>
              </div>
              <TrendingUp className="h-10 w-10 text-amber-200" />
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* مولد التقارير */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-teal-600" />
              إنشاء تقرير
            </CardTitle>
            <CardDescription>
              اختر نوع التقرير وحدد المعايير لتوليد التقرير
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>نوع التقرير</Label>
                <Select value={selectedReport} onValueChange={setSelectedReport}>
                  <SelectTrigger>
                    <SelectValue placeholder="اختر نوع التقرير" />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPES.map((report) => (
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
                <Label>القسم</Label>
                <Select value={selectedDepartment} onValueChange={setSelectedDepartment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">جميع الأقسام</SelectItem>
                    {departmentDistribution.map((dept) => (
                      <SelectItem key={dept.name} value={dept.name}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label>من تاريخ</Label>
                <Input 
                  type="date" 
                  value={dateFrom} 
                  onChange={(e) => setDateFrom(e.target.value)} 
                />
              </div>
              <div className="space-y-2">
                <Label>إلى تاريخ</Label>
                <Input 
                  type="date" 
                  value={dateTo} 
                  onChange={(e) => setDateTo(e.target.value)} 
                />
              </div>
            </div>
            <div className="flex gap-3">
              <Button 
                className="flex-1 bg-teal-600 hover:bg-teal-700"
                onClick={handleGenerateReport}
                disabled={!selectedReport}
              >
                <FileText className="h-4 w-4 ml-2" />
                إنشاء التقرير
              </Button>
              <Button variant="outline">
                <Download className="h-4 w-4 ml-2" />
                تصدير Excel
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* التقارير السريعة */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">تقارير سريعة</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {REPORT_TYPES.slice(0, 4).map((report) => (
              <Button
                key={report.id}
                variant="outline"
                className="w-full justify-start h-auto py-3"
                onClick={() => setSelectedReport(report.id)}
              >
                <report.icon className="h-4 w-4 ml-3 text-muted-foreground" />
                <div className="text-right">
                  <p className="font-medium">{report.name}</p>
                  <p className="text-xs text-muted-foreground">{report.description}</p>
                </div>
              </Button>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* توزيع الموظفين حسب القسم */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PieChart className="h-5 w-5 text-blue-600" />
            توزيع الموظفين حسب الأقسام
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {departmentDistribution.map((dept, index) => {
              const colors = [
                'bg-blue-500', 'bg-emerald-500', 'bg-purple-500',
                'bg-amber-500', 'bg-rose-500', 'bg-cyan-500'
              ];
              return (
                <div
                  key={dept.name}
                  className="flex items-center gap-4 rounded-lg border p-4 hover:bg-slate-50 transition-colors"
                >
                  <div className={`w-3 h-3 rounded-full ${colors[index % colors.length]}`} />
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{dept.name}</span>
                      <Badge variant="secondary">{dept.count}</Badge>
                    </div>
                    <div className="mt-2 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div 
                        className={`h-full rounded-full ${colors[index % colors.length]}`}
                        style={{ width: `${dept.percentage}%` }}
                      />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{dept.percentage}%</p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* اتجاهات الرواتب */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-emerald-600" />
            اتجاهات الرواتب الشهرية
          </CardTitle>
          <CardDescription>
            إجمالي الرواتب المدفوعة خلال آخر 6 أشهر
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {payrollRuns.slice(0, 6).map((run: any, index: number) => {
              const maxAmount = Math.max(...payrollRuns.map((r: any) => r.totalNet || 0));
              const percentage = maxAmount > 0 ? ((run.totalNet || 0) / maxAmount) * 100 : 0;
              
              return (
                <div key={run.id || index} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{run.periodCode || `شهر ${index + 1}`}</span>
                    <span className="text-muted-foreground">
                      {(run.totalNet || 0).toLocaleString()} ر.س
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
                <p>لا توجد بيانات رواتب متاحة</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

