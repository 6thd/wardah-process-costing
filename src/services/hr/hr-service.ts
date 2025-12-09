import { supabase, getEffectiveTenantId } from '@/lib/supabase';
import type { PostgrestError } from '@supabase/supabase-js';

export type EmployeeStatus = 'active' | 'inactive' | 'terminated' | 'probation';
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'leave' | 'remote' | 'off';
export type PayrollRunStatus = 'draft' | 'calculated' | 'approved' | 'paid' | 'processing';
export type AlertSeverity = 'info' | 'warning' | 'critical';

export interface HrEmployee {
  id: string;
  code?: string;
  name: string;
  jobTitle?: string;
  department?: string;
  status: EmployeeStatus;
  hiringDate?: string | null;
  contractEndDate?: string | null;
  salary?: number;
  currency?: string;
  location?: string | null;
  avatarUrl?: string | null;
}

export interface AttendanceLog {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  date: string;
  status: AttendanceStatus;
  checkIn?: string | null;
  checkOut?: string | null;
  notes?: string | null;
}

export interface PayrollRun {
  id: string;
  periodCode: string;
  periodStart?: string | null;
  periodEnd?: string | null;
  processedOn?: string | null;
  totalGross?: number;
  totalNet?: number;
  totalDeductions?: number;
  employeeCount?: number;
  currency?: string;
  status: PayrollRunStatus;
}

export interface LeaveRequest {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  leaveType?: string | null;
  startDate: string;
  endDate: string;
  totalDays?: number;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled' | string;
  reason?: string | null;
}

export interface SettlementRecord {
  id: string;
  employeeId: string;
  employeeName?: string | null;
  settlementType: string;
  status: 'draft' | 'approved' | 'paid' | 'rejected' | string;
  calculatedAmount: number;
  payableAmount: number;
  settlementDate?: string | null;
  notes?: string | null;
}

export interface HrAlert {
  id: string;
  title: string;
  category: string;
  severity: AlertSeverity;
  description?: string | null;
  dueDate?: string | null;
  employeeId?: string | null;
  employeeName?: string | null;
  isResolved: boolean;
}

export interface HrDashboardMetrics {
  totalEmployees: number;
  activeEmployees: number;
  pendingLeaves: number;
  payrollReady: number;
  lateToday: number;
  openAlerts: number;
  recentHires: number;
}

export interface HrInsight {
  id: string;
  title: string;
  description: string;
  impact: 'positive' | 'warning' | 'critical';
  metric: string;
}

interface QueryOptions {
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
}

const TABLE_CANDIDATES = {
  employees: ['employees', 'hr_employees', 'worker_profiles'],
  attendance: ['attendance_records', 'hr_attendance_logs', 'attendance'],
  payrollRuns: ['payroll_runs', 'hr_payroll_runs'],
  leaves: ['employee_leaves', 'hr_leave_requests'],
  alerts: ['hr_alerts', 'hr_notifications'],
  settlements: ['hr_settlements', 'employee_settlements'],
};

const normalizeStatus = (value: string | null | undefined): EmployeeStatus => {
  const normalized = (value || '').toLowerCase();
  if (['inactive', 'terminated', 'probation'].includes(normalized)) {
    return normalized as EmployeeStatus;
  }
  return 'active';
};

const normalizeAttendanceStatus = (value: string | null | undefined): AttendanceStatus => {
  const normalized = (value || '').toLowerCase();
  if (['absent', 'late', 'leave', 'remote', 'off'].includes(normalized)) {
    return normalized as AttendanceStatus;
  }
  return 'present';
};

const normalizePayrollStatus = (value: string | null | undefined): PayrollRunStatus => {
  const normalized = (value || '').toLowerCase();
  if (['draft', 'calculated', 'approved', 'paid', 'processing'].includes(normalized)) {
    return normalized as PayrollRunStatus;
  }
  return 'draft';
};

const normalizeSeverity = (value: string | null | undefined): AlertSeverity => {
  const normalized = (value || '').toLowerCase();
  if (['warning', 'critical'].includes(normalized)) {
    return normalized as AlertSeverity;
  }
  return 'info';
};

const pick = <T = string>(row: Record<string, any>, keys: string[], fallback?: T): T | undefined => {
  for (const key of keys) {
    if (row && row[key] !== undefined && row[key] !== null) {
      return row[key];
    }
  }
  return fallback;
};

const safeNumber = (value: any, fallback = 0): number => {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const formatDate = (value: any): string | null => {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  try {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  } catch (error) {
    console.warn('[HR] Failed to parse date value', value);
  }
  return null;
};

const generateTempId = (): string => {
  try {
    // @ts-ignore - crypto might be available globally in browsers
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (error) {
    // ignore
  }
  // Use crypto API for secure temporary ID
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `tmp-${crypto.randomUUID()}`;
  } else if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(9);
    crypto.getRandomValues(array);
    const random = Array.from(array, byte => byte.toString(36)).join('').substring(0, 9);
    return `tmp-${random}`;
  } else {
    // Fallback - Use timestamp only (not secure, but better than Math.random)
    return `tmp-${Date.now()}-${performance.now()}`;
  }
};

const fetchFromTables = async (
  candidates: string[],
  selectClause: string,
  options: QueryOptions = {},
): Promise<any[]> => {
  const orgId = await getEffectiveTenantId().catch((error) => {
    console.warn('[HR] Failed to resolve tenant id', error);
    return null;
  });

  for (const table of candidates) {
    const data = await trySelect(table, selectClause, orgId, options);
    if (data !== null) {
      return data;
    }
  }

  return [];
};

const trySelect = async (
  table: string,
  selectClause: string,
  orgId: string | null,
  options: QueryOptions,
): Promise<any[] | null> => {
  const orgColumns = orgId ? ['org_id', 'tenant_id'] : [];
  const attempts = [...orgColumns, null];

  for (const column of attempts) {
    try {
      let query = supabase.from(table).select(selectClause);

      if (column && orgId) {
        query = query.eq(column, orgId);
      }

      if (options.orderBy) {
        query = query.order(options.orderBy.column, {
          ascending: options.orderBy.ascending ?? false,
        });
      }

      if (options.limit) {
        query = query.limit(options.limit);
      }

      const { data, error } = await query;

      if (error) {
        if (error.code === '42703' && column) {
          console.warn(`[HR] Column ${column} missing on ${table}, retrying without it.`);
          continue;
        }

        if (error.code === 'PGRST205' || error.code === '42P01') {
          console.warn(`[HR] Table ${table} not found (${error.code}), will try next candidate.`);
          return null;
        }

        console.warn(`[HR] Error querying ${table}:`, error);
        return [];
      }

      return data ?? [];
    } catch (error: any) {
      const pgError = error as PostgrestError;
      if (pgError?.code === 'PGRST205' || pgError?.code === '42P01') {
        console.warn(`[HR] Table ${table} not accessible:`, pgError.message);
        return null;
      }
      console.error(`[HR] Unexpected error fetching ${table}:`, error);
      return [];
    }
  }

  return [];
};

export const getEmployees = async (): Promise<HrEmployee[]> => {
  try {
    const rows = await fetchFromTables(TABLE_CANDIDATES.employees, '*', {
      orderBy: { column: 'created_at', ascending: false },
      limit: 500,
    });

    return rows.map((row: Record<string, any>) => ({
      id: pick(row, ['id', 'employee_id']) || generateTempId(),
      code: pick(row, ['employee_id', 'code', 'staff_code']),
      name:
        pick(row, ['full_name', 'name', 'employee_name', 'display_name'], 'موظف بدون اسم') ??
        'موظف بدون اسم',
      jobTitle: pick(row, ['position', 'job_title', 'title']),
      department: pick(row, ['department', 'department_name', 'department_code']),
      status: normalizeStatus(pick(row, ['status', 'employment_status', 'state'], 'active')),
      hiringDate: formatDate(pick(row, ['hire_date', 'joining_date', 'start_date'])),
      contractEndDate: formatDate(pick(row, ['contract_end_date', 'end_date'])),
      salary: safeNumber(pick(row, ['salary', 'basic_salary', 'net_salary'], 0)),
      currency: pick(row, ['currency', 'salary_currency'], 'SAR'),
      location: pick(row, ['location', 'work_location']),
      avatarUrl: pick(row, ['avatar_url', 'profile_image_url']),
    }));
  } catch (error) {
    console.error('[HR] Failed to load employees:', error);
    return [];
  }
};

export const getAttendanceLogs = async (limit = 120): Promise<AttendanceLog[]> => {
  try {
    const rows = await fetchFromTables(TABLE_CANDIDATES.attendance, '*', {
      orderBy: { column: 'record_date', ascending: false },
      limit,
    });

    return (rows || []).map((row: Record<string, any>) => ({
      id: pick(row, ['id']) || generateTempId(),
      employeeId:
        pick(row, ['employee_id']) ||
        pick(row, ['employee', 'employeeId']) ||
        pick(row, ['employee_code'], 'unknown'),
      employeeName:
        pick(row, ['employee_name', 'full_name', 'name']) ||
        pick(row.employee ?? {}, ['full_name', 'first_name']) ||
        null,
      date:
        pick(row, ['record_date', 'attendance_date', 'date']) ||
        new Date().toISOString(),
      status: normalizeAttendanceStatus(pick(row, ['status', 'attendance_status'], 'present')),
      checkIn: pick(row, ['check_in_time', 'check_in', 'in_time']) || null,
      checkOut: pick(row, ['check_out_time', 'check_out', 'out_time']) || null,
      notes: pick(row, ['notes', 'remarks']),
    }));
  } catch (error) {
    console.error('[HR] Failed to load attendance logs:', error);
    return [];
  }
};

export const getPayrollRuns = async (limit = 6): Promise<PayrollRun[]> => {
  try {
    const rows = await fetchFromTables(TABLE_CANDIDATES.payrollRuns, '*', {
      orderBy: { column: 'run_date', ascending: false },
      limit,
    });

    return rows.map((row: Record<string, any>) => ({
      id: pick(row, ['id']) || generateTempId(),
      periodCode:
        pick(row, ['period_code']) ||
        pick(row, ['period', 'label']) ||
        pick(row, ['run_date'], 'غير محدد'),
      periodStart: formatDate(pick(row, ['start_date', 'period_start'])),
      periodEnd: formatDate(pick(row, ['end_date', 'period_end'])),
      processedOn: formatDate(pick(row, ['run_date', 'processed_at'])),
      totalGross: safeNumber(pick(row, ['total_gross', 'gross_amount'], 0)),
      totalNet: safeNumber(pick(row, ['total_net', 'net_amount'], 0)),
      totalDeductions: safeNumber(pick(row, ['total_deductions', 'deductions'], 0)),
      employeeCount: safeNumber(pick(row, ['employee_count', 'workers']), 0),
      currency: pick(row, ['currency', 'salary_currency'], 'SAR') ?? 'SAR',
      status: normalizePayrollStatus(pick(row, ['status'], 'draft')),
    }));
  } catch (error) {
    console.error('[HR] Failed to load payroll runs:', error);
    return [];
  }
};

export const getLeaveRequests = async (limit = 20): Promise<LeaveRequest[]> => {
  try {
    const rows = await fetchFromTables(TABLE_CANDIDATES.leaves, '*', {
      orderBy: { column: 'created_at', ascending: false },
      limit,
    });

    return rows.map((row: Record<string, any>) => ({
      id: pick(row, ['id']) || generateTempId(),
      employeeId: pick(row, ['employee_id']) || pick(row, ['worker_id'], 'unknown'),
      employeeName: pick(row, ['employee_name', 'requester_name']),
      leaveType:
        pick(row, ['leave_type']) ||
        pick(row, ['leave_type_name', 'type']) ||
        pick(row, ['leave_code']),
      startDate:
        formatDate(pick(row, ['start_date', 'from_date'])) || new Date().toISOString(),
      endDate: formatDate(pick(row, ['end_date', 'to_date'])) || new Date().toISOString(),
      totalDays: safeNumber(pick(row, ['total_days', 'days'], 1), 1),
      status: (pick(row, ['status'], 'pending') as LeaveRequest['status']) ?? 'pending',
      reason: pick(row, ['reason', 'notes']),
    }));
  } catch (error) {
    console.error('[HR] Failed to load leave requests:', error);
    return [];
  }
};

export const getSettlementRecords = async (limit = 15): Promise<SettlementRecord[]> => {
  try {
    const rows = await fetchFromTables(TABLE_CANDIDATES.settlements, '*', {
      // لا نفترض وجود عمود باسم معيّن (بعض قواعد البيانات قد لا تحتوي settlement_date بعد)
      // يمكننا الفرز على الواجهة الأمامية عند الحاجة.
      limit,
    });

    return rows.map((row: Record<string, any>) => ({
      id: pick(row, ['id']) || generateTempId(),
      employeeId: pick(row, ['employee_id']) || pick(row, ['worker_id'], 'unknown'),
      employeeName: pick(row, ['employee_name']),
      settlementType:
        pick(row, ['settlement_type', 'type']) || 'End of Service',
      status: pick(row, ['status'], 'draft'),
      calculatedAmount: safeNumber(pick(row, ['calculated_amount', 'calculated_total'], 0)),
      payableAmount: safeNumber(pick(row, ['payable_amount', 'net_pay'], 0)),
      settlementDate: formatDate(
        pick(row, ['settlement_date', 'processed_at', 'created_at']),
      ),
      notes: pick(row, ['notes', 'remarks']),
    }));
  } catch (error) {
    console.error('[HR] Failed to load settlements:', error);
    return [];
  }
};

export const getSmartAlerts = async (limit = 20): Promise<HrAlert[]> => {
  try {
    const rows = await fetchFromTables(TABLE_CANDIDATES.alerts, '*', {
      orderBy: { column: 'created_at', ascending: false },
      limit,
    });

    return rows.map((row: Record<string, any>) => ({
      id: pick(row, ['id']) || generateTempId(),
      title: pick(row, ['title', 'subject'], 'تنبيه بدون عنوان') ?? 'تنبيه بدون عنوان',
      category: pick(row, ['category', 'alert_category'], 'general') ?? 'general',
      severity: normalizeSeverity(pick(row, ['severity', 'level'], 'info')),
      description: pick(row, ['description', 'details']),
      dueDate: formatDate(pick(row, ['due_date', 'target_date'])),
      employeeId: pick(row, ['employee_id']),
      employeeName: pick(row, ['employee_name']),
      isResolved: Boolean(pick(row, ['is_resolved', 'resolved']) ?? false),
    }));
  } catch (error) {
    console.error('[HR] Failed to load smart alerts:', error);
    return [];
  }
};

export const getHrDashboardMetrics = async (): Promise<HrDashboardMetrics> => {
  try {
    const [employees, leaveRequests, attendanceLogs, payrollRuns, alerts] = await Promise.all([
      getEmployees(),
      getLeaveRequests(),
      getAttendanceLogs(90),
      getPayrollRuns(4),
      getSmartAlerts(10),
    ]);

    const totalEmployees = employees.length;
    const activeEmployees = employees.filter((emp) => emp.status === 'active').length;
    const pendingLeaves = leaveRequests.filter((req) => req.status === 'pending').length;
    const payrollReady = payrollRuns.filter((run) =>
      ['calculated', 'approved'].includes(run.status),
    ).length;

    const today = new Date().toISOString().split('T')[0];
    const lateToday = attendanceLogs.filter(
      (log) =>
        log.date?.startsWith(today) &&
        (log.status === 'late' || log.status === 'absent'),
    ).length;

    const recentHires = employees.filter((emp) => {
      if (!emp.hiringDate) return false;
      const hireDate = new Date(emp.hiringDate);
      const diff =
        (Date.now() - hireDate.getTime()) / (1000 * 60 * 60 * 24);
      return diff <= 45;
    }).length;

    return {
      totalEmployees,
      activeEmployees,
      pendingLeaves,
      payrollReady,
      lateToday,
      openAlerts: alerts.filter((alert) => !alert.isResolved).length,
      recentHires,
    };
  } catch (error) {
    console.error('[HR] Failed to build dashboard metrics:', error);
    return {
      totalEmployees: 0,
      activeEmployees: 0,
      pendingLeaves: 0,
      payrollReady: 0,
      lateToday: 0,
      openAlerts: 0,
      recentHires: 0,
    };
  }
};

export const getHrInsights = async (): Promise<HrInsight[]> => {
  try {
    const [metrics, payrollRuns, leaveRequests] = await Promise.all([
      getHrDashboardMetrics(),
      getPayrollRuns(6),
      getLeaveRequests(30),
    ]);

    const insights: HrInsight[] = [];

    if (metrics.recentHires > 0) {
      insights.push({
        id: 'recent-hires',
        title: 'زيادة في التوظيف',
        description: `تم تسجيل ${metrics.recentHires} تعيينات جديدة خلال آخر 45 يومًا. راجع خطط التدريب والتسليم لضمان جاهزية الفريق.`,
        impact: 'positive',
        metric: 'Growth',
      });
    }

    if (metrics.pendingLeaves > 0) {
      insights.push({
        id: 'pending-leaves',
        title: 'طلبات إجازة تنتظر الموافقة',
        description: `${metrics.pendingLeaves} طلب إجازة ما زال قيد الانتظار. معالجة الطلبات سريعًا تحافظ على ثقة الموظفين.`,
        impact: 'warning',
        metric: 'Compliance',
      });
    }

    if (metrics.lateToday > 3) {
      insights.push({
        id: 'attendance-warning',
        title: 'ارتفاع حالات التأخير/الغياب اليوم',
        description: `تم تسجيل ${metrics.lateToday} حالات تأخير أو غياب اليوم. تحقق من أسباب التأخير لتجنب تأثيرها على الإنتاجية.`,
        impact: 'critical',
        metric: 'Attendance',
      });
    }

    if (payrollRuns.length > 0) {
      const latest = payrollRuns[0];
      if (latest.status !== 'paid') {
        insights.push({
          id: 'payroll-status',
          title: 'دورة الرواتب لم تُعتمد بعد',
          description: `أحدث دورة رواتب (${latest.periodCode}) في حالة ${latest.status}. تأكد من إغلاق الدورة قبل تاريخ الدفع المحدد.`,
          impact: 'warning',
          metric: 'Payroll',
        });
      }
    }

    const approvedLeaves = leaveRequests.filter((req) => req.status === 'approved').length;
    if (approvedLeaves > 0 && approvedLeaves / Math.max(metrics.totalEmployees, 1) > 0.25) {
      insights.push({
        id: 'leave-coverage',
        title: 'نسبة إجازات مرتفعة',
        description: `حوالي ${(approvedLeaves / Math.max(metrics.totalEmployees, 1) * 100).toFixed(
          1,
        )}% من القوى العاملة في إجازة معتمدة. خطط لتوزيع العمل لتفادي الضغط على الفرق.`,
        impact: 'warning',
        metric: 'Resourcing',
      });
    }

    if (insights.length === 0) {
      insights.push({
        id: 'stable',
        title: 'الوضع مستقر',
        description: 'لا توجد مؤشرات حرجة حاليًا. استمر في مراقبة الأداء لضمان الاستقرار.',
        impact: 'positive',
        metric: 'Overview',
      });
    }

    return insights;
  } catch (error) {
    console.error('[HR] Failed to build HR insights:', error);
    return [
      {
        id: 'fallback',
        title: 'غير قادر على تحميل التحليلات',
        description: 'حدثت مشكلة أثناء تحليل بيانات الموارد البشرية. حاول مرة أخرى لاحقًا.',
        impact: 'warning',
        metric: 'System',
      },
    ];
  }
};


