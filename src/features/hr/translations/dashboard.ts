import i18n from '@/i18n';

const ar = {
  dashboard: {
    title: 'لوحة التحكم - الموارد البشرية',
    subtitle: 'نظرة شاملة على أداء الموارد البشرية، الحضور، والرواتب.',
    kpi: {
      totalEmployees: 'إجمالي الموظفين',
      activeEmployees: 'الموظفون النشطون',
      attendanceRateToday: 'معدل الحضور اليوم',
      leaveRequests: 'طلبات الإجازة',
      totalRequests: '{{count}} إجمالي',
    },
    tabs: {
      attendance: 'الحضور',
      payroll: 'الرواتب',
      distribution: 'التوزيع',
    },
    weeklyAttendance: 'الحضور الأسبوعي',
    last7Days: 'آخر 7 أيام',
    todayAttendance: 'حضور اليوم',
    records: '{{count}} سجل',
    noAttendanceToday: 'لا توجد سجلات حضور لليوم',
    monthlyPayrollAnalysis: 'تحليل الرواتب الشهري',
    last6Months: 'آخر 6 أشهر',
    charts: {
      gross: 'الإجمالي',
      deductions: 'الخصومات',
      net: 'الصافي',
    },
    employeeStatusDistribution: 'توزيع حالة الموظفين',
    employeeCount_one: '{{count}} موظف',
    employeeCount_other: '{{count}} موظفين',
    attendanceDistribution: 'توزيع الحضور',
    last90Days: 'آخر 90 يوم',
    recentPayrollRuns: 'دورات الرواتب الأخيرة',
    last6Runs: 'آخر 6 دورات',
    startNewRun: 'تشغيل دورة جديدة',
    noPayrollRuns: 'لا توجد دورات رواتب مسجلة',
    payrollRunSummary: '{{count}} موظف · {{amount}} {{currency}}',
  },
};

const en = {
  dashboard: {
    title: 'Human Resources Dashboard',
    subtitle: 'A comprehensive view of HR performance, attendance, and payroll.',
    kpi: {
      totalEmployees: 'Total employees',
      activeEmployees: 'Active employees',
      attendanceRateToday: 'Today’s attendance rate',
      leaveRequests: 'Leave requests',
      totalRequests: '{{count}} total',
    },
    tabs: {
      attendance: 'Attendance',
      payroll: 'Payroll',
      distribution: 'Distribution',
    },
    weeklyAttendance: 'Weekly attendance',
    last7Days: 'Last 7 days',
    todayAttendance: 'Today’s attendance',
    records: '{{count}} records',
    noAttendanceToday: 'No attendance records for today',
    monthlyPayrollAnalysis: 'Monthly payroll analysis',
    last6Months: 'Last 6 months',
    charts: {
      gross: 'Gross',
      deductions: 'Deductions',
      net: 'Net',
    },
    employeeStatusDistribution: 'Employee status distribution',
    employeeCount_one: '{{count}} employee',
    employeeCount_other: '{{count}} employees',
    attendanceDistribution: 'Attendance distribution',
    last90Days: 'Last 90 days',
    recentPayrollRuns: 'Recent payroll runs',
    last6Runs: 'Last 6 runs',
    startNewRun: 'Start new run',
    noPayrollRuns: 'No payroll runs have been recorded',
    payrollRunSummary: '{{count}} employees · {{amount}} {{currency}}',
  },
};

i18n.addResourceBundle('ar', 'hr', ar, true, true);
i18n.addResourceBundle('en', 'hr', en, true, true);
