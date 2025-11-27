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

export const ATTENDANCE_COLORS: Record<string, string> = {
    present: 'bg-emerald-50 text-emerald-700 border border-emerald-100',
    absent: 'bg-rose-50 text-rose-700 border border-rose-100',
    late: 'bg-amber-50 text-amber-700 border border-amber-100',
    leave: 'bg-blue-50 text-blue-700 border border-blue-100',
    remote: 'bg-violet-50 text-violet-700 border border-violet-100',
    off: 'bg-slate-50 text-slate-600 border border-slate-100',
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
