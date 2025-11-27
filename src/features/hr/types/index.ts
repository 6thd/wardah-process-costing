import { PayrollAccountType } from '@/services/hr/payroll-account-service';

export interface Employee {
    id: string;
    name: string;
    code?: string;
    department?: string;
    jobTitle?: string;
    status: 'active' | 'inactive' | 'terminated' | 'probation';
    hiringDate?: string;
    contractEndDate?: string;
    salary?: number;
    currency?: string;
}

export interface AttendanceLog {
    id: string;
    employeeId: string;
    employeeName?: string;
    date: string;
    checkIn?: string;
    checkOut?: string;
    status: 'present' | 'absent' | 'late' | 'leave' | 'remote' | 'off';
    notes?: string;
}

export interface PayrollRun {
    id: string;
    periodCode: string;
    status: 'draft' | 'calculated' | 'approved' | 'paid';
    totalNet?: number;
    currency?: string;
    runDate?: string;
}

export interface HrDashboardMetrics {
    totalEmployees: number;
    activeEmployees: number;
    pendingLeaves: number;
    openAlerts: number;
}

export interface EmployeeFormState {
    firstName: string;
    lastName: string;
    employeeCode: string;
    department: string;
    position: string;
    salary: string;
    hireDate: string;
}

export interface AttendanceModalState {
    open: boolean;
    employeeId?: string;
    employeeName?: string;
    date?: string;
    status?: string;
    inTime?: string;
    outTime?: string;
    notes?: string;
}

export const STATUS_BADGES: Record<string, string> = {
    active: 'bg-emerald-500/20 text-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-400',
    inactive: 'bg-slate-500/20 text-slate-400 dark:bg-slate-500/20 dark:text-slate-400',
    terminated: 'bg-rose-500/20 text-rose-400 dark:bg-rose-500/20 dark:text-rose-400',
    probation: 'bg-amber-500/20 text-amber-400 dark:bg-amber-500/20 dark:text-amber-400',
    pending: 'bg-amber-500/20 text-amber-400 dark:bg-amber-500/20 dark:text-amber-400',
    approved: 'bg-emerald-500/20 text-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-400',
    rejected: 'bg-rose-500/20 text-rose-400 dark:bg-rose-500/20 dark:text-rose-400',
    draft: 'bg-slate-500/20 text-slate-400 dark:bg-slate-500/20 dark:text-slate-400',
    calculated: 'bg-blue-500/20 text-blue-400 dark:bg-blue-500/20 dark:text-blue-400',
    paid: 'bg-emerald-500/20 text-emerald-400 dark:bg-emerald-500/20 dark:text-emerald-400',
};

export const ATTENDANCE_COLORS: Record<string, string> = {
    present: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    absent: 'bg-rose-500/20 text-rose-400 border border-rose-500/30',
    late: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
    leave: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    remote: 'bg-violet-500/20 text-violet-400 border border-violet-500/30',
    off: 'bg-slate-500/20 text-slate-400 border border-slate-500/30',
};

export const PAYROLL_ACCOUNT_TYPES: Array<{
    key: PayrollAccountType;
    label: string;
    description: string;
}> = [
        { key: 'basic_salary', label: 'الراتب الأساسي', description: 'الراتب الأساسي للموظف' },
        { key: 'housing_allowance', label: 'بدل السكن', description: 'بدل السكن الشهري' },
        { key: 'transport_allowance', label: 'بدل النقل', description: 'بدل النقل والمواصلات' },
        { key: 'other_allowance', label: 'بدلات أخرى', description: 'أي بدلات إضافية أخرى' },
        { key: 'deductions', label: 'الاستقطاعات', description: 'الخصومات والجزاءات' },
        { key: 'loans', label: 'السلف والقروض', description: 'سداد السلف والقروض' },
        { key: 'payable', label: 'رواتب مستحقة الدفع', description: 'حساب الالتزامات للرواتب' },
        { key: 'net_payable', label: 'صافي الدفع', description: 'المبلغ النهائي المحول' },
    ];
