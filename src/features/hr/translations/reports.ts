import i18n from '@/i18n';

const ar = {
  reports: {
    title: 'التقارير والتحليلات',
    subtitle: 'تقارير شاملة وتحليلات متقدمة للموارد البشرية',
    stats: {
      totalEmployees: 'إجمالي الموظفين',
      activeEmployees: 'الموظفون النشطون',
      totalPayroll: 'إجمالي الرواتب',
      averageSalary: 'متوسط الراتب',
    },
    currencyShort: 'ر.س',
    generator: {
      title: 'إنشاء تقرير',
      description: 'اختر نوع التقرير وحدد المعايير لتوليد التقرير',
      reportType: 'نوع التقرير',
      selectReportType: 'اختر نوع التقرير',
      department: 'القسم',
      fromDate: 'من تاريخ',
      toDate: 'إلى تاريخ',
      generate: 'إنشاء التقرير',
      exportExcel: 'تصدير Excel',
    },
    quickReports: 'تقارير سريعة',
    departmentDistribution: 'توزيع الموظفين حسب الأقسام',
    payrollTrends: 'اتجاهات الرواتب الشهرية',
    payrollTrendsDescription: 'إجمالي الرواتب المدفوعة خلال آخر 6 أشهر',
    fallbackMonth: 'شهر {{count}}',
    noPayrollData: 'لا توجد بيانات رواتب متاحة',
    types: {
      employeeList: {
        name: 'قائمة الموظفين',
        description: 'تقرير شامل بجميع الموظفين وبياناتهم',
      },
      attendanceSummary: {
        name: 'ملخص الحضور',
        description: 'تقرير الحضور والغياب الشهري',
      },
      payrollSummary: {
        name: 'ملخص الرواتب',
        description: 'تقرير إجمالي الرواتب والبدلات',
      },
      departmentAnalysis: {
        name: 'تحليل الأقسام',
        description: 'توزيع الموظفين حسب الأقسام',
      },
      turnoverReport: {
        name: 'تقرير الدوران الوظيفي',
        description: 'معدل الاستقالات والتعيينات',
      },
      leaveBalance: {
        name: 'أرصدة الإجازات',
        description: 'تقرير أرصدة الإجازات للموظفين',
      },
    },
    departments: {
      production: 'الإنتاج',
      finance: 'المالية',
      humanResources: 'الموارد البشرية',
      sales: 'المبيعات',
      informationTechnology: 'تقنية المعلومات',
      administration: 'الإدارة',
    },
  },
};

const en = {
  reports: {
    title: 'Reports & Analytics',
    subtitle: 'Comprehensive HR reports and advanced workforce analytics',
    stats: {
      totalEmployees: 'Total employees',
      activeEmployees: 'Active employees',
      totalPayroll: 'Total payroll',
      averageSalary: 'Average salary',
    },
    currencyShort: 'SAR',
    generator: {
      title: 'Generate report',
      description: 'Choose a report type and set the criteria to generate it',
      reportType: 'Report type',
      selectReportType: 'Select a report type',
      department: 'Department',
      fromDate: 'From date',
      toDate: 'To date',
      generate: 'Generate report',
      exportExcel: 'Export Excel',
    },
    quickReports: 'Quick reports',
    departmentDistribution: 'Employee distribution by department',
    payrollTrends: 'Monthly payroll trends',
    payrollTrendsDescription: 'Total payroll paid during the last 6 months',
    fallbackMonth: 'Month {{count}}',
    noPayrollData: 'No payroll data is available',
    types: {
      employeeList: {
        name: 'Employee list',
        description: 'A comprehensive report of all employees and their details',
      },
      attendanceSummary: {
        name: 'Attendance summary',
        description: 'Monthly attendance and absence report',
      },
      payrollSummary: {
        name: 'Payroll summary',
        description: 'Total payroll and allowances report',
      },
      departmentAnalysis: {
        name: 'Department analysis',
        description: 'Employee distribution across departments',
      },
      turnoverReport: {
        name: 'Employee turnover report',
        description: 'Resignation and hiring rates',
      },
      leaveBalance: {
        name: 'Leave balances',
        description: 'Employee leave balance report',
      },
    },
    departments: {
      production: 'Production',
      finance: 'Finance',
      humanResources: 'Human Resources',
      sales: 'Sales',
      informationTechnology: 'Information Technology',
      administration: 'Administration',
    },
  },
};

i18n.addResourceBundle('ar', 'hr', ar, true, true);
i18n.addResourceBundle('en', 'hr', en, true, true);
