import i18n from '@/i18n';

const ar = {
  common: {
    name: 'الاسم',
    date: 'التاريخ',
    type: 'النوع',
    amount: 'المبلغ',
    reason: 'السبب',
    close: 'إغلاق',
    print: 'طباعة',
  },
  status: {
    off: 'راحة',
    cancelled: 'ملغي',
    review: 'قيد المراجعة',
  },
  attendance: {
    calendar: 'العرض التقويمي',
    calendarDescription: 'عرض الحضور بشكل تقويم شهري',
    attendanceStats: 'إحصائيات الحضور',
    employeeColumn: 'الموظف',
  },
} as const;

const en = {
  common: {
    name: 'Name',
    date: 'Date',
    type: 'Type',
    amount: 'Amount',
    reason: 'Reason',
    close: 'Close',
    print: 'Print',
  },
  status: {
    off: 'Off',
    cancelled: 'Cancelled',
    review: 'Under review',
  },
  attendance: {
    calendar: 'Calendar view',
    calendarDescription: 'View attendance in a monthly calendar',
    attendanceStats: 'Attendance statistics',
    employeeColumn: 'Employee',
  },
} as const;

i18n.addResourceBundle('ar', 'hr', ar, true, true);
i18n.addResourceBundle('en', 'hr', en, true, true);
