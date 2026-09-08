import { loadXLSX } from '@/lib/export-libs';
import type { MonthlyAttendance } from '@/services/hr/attendance-service';
import type { LeaveBalanceResult } from '@/services/hr/leave-service';
import type {
  ReportEmployee,
  ReportPayrollRun,
} from '@/services/hr/reports-service';

export const UNASSIGNED_DEPARTMENT = '__unassigned__';

export type ReportValue = string | number;

export interface ReportColumn {
  key: string;
  labelKey: string;
}

export interface ResolvedReportColumn extends ReportColumn {
  label: string;
}

export interface BuiltReport {
  columns: ReportColumn[];
  rows: Array<Record<string, ReportValue>>;
  filenamePrefix: string;
}

interface EmployeeReportFilters {
  from?: string;
  to?: string;
  department?: string;
}

interface TurnoverPeriod {
  from: string;
  to: string;
}

const employeeName = (employee: ReportEmployee) =>
  employee.full_name?.trim() || employee.employee_id;

const normalizedDepartment = (employee: ReportEmployee) =>
  employee.department?.trim() || UNASSIGNED_DEPARTMENT;

const isWithinInclusiveRange = (
  value: string | null,
  from?: string,
  to?: string,
) => Boolean(value && (!from || value >= from) && (!to || value <= to));

const filterEmployees = (
  employees: ReportEmployee[],
  filters: EmployeeReportFilters,
) => employees.filter((employee) => {
  const departmentMatches = !filters.department
    || filters.department === 'all'
    || normalizedDepartment(employee) === filters.department;
  const dateMatches = (!filters.from && !filters.to)
    || isWithinInclusiveRange(employee.hire_date, filters.from, filters.to);
  return departmentMatches && dateMatches;
});

export function buildEmployeeListReport(
  employees: ReportEmployee[],
  filters: EmployeeReportFilters = {},
): BuiltReport {
  const rows = filterEmployees(employees, filters).map((employee) => ({
    employeeId: employee.employee_id,
    name: employeeName(employee),
    department: normalizedDepartment(employee),
    position: employee.position ?? '',
    status: employee.status ?? '',
    hireDate: employee.hire_date,
    terminationDate: employee.termination_date ?? '',
  }));

  return {
    columns: [
      { key: 'employeeId', labelKey: 'reports.columns.employeeId' },
      { key: 'name', labelKey: 'reports.columns.employeeName' },
      { key: 'department', labelKey: 'reports.columns.department' },
      { key: 'position', labelKey: 'reports.columns.position' },
      { key: 'status', labelKey: 'reports.columns.status' },
      { key: 'hireDate', labelKey: 'reports.columns.hireDate' },
      { key: 'terminationDate', labelKey: 'reports.columns.terminationDate' },
    ],
    rows,
    filenamePrefix: 'employee-list',
  };
}

export function buildDepartmentAnalysis(
  employees: ReportEmployee[],
  selectedDepartment = 'all',
): BuiltReport {
  const scoped = filterEmployees(employees, { department: selectedDepartment });
  const counts = new Map<string, number>();
  for (const employee of scoped) {
    const department = normalizedDepartment(employee);
    counts.set(department, (counts.get(department) ?? 0) + 1);
  }

  const rows = [...counts.entries()]
    .map(([department, count]) => ({
      department,
      count,
      percentage: scoped.length ? Number(((count / scoped.length) * 100).toFixed(2)) : 0,
    }))
    .sort((a, b) => b.count - a.count || a.department.localeCompare(b.department));

  return {
    columns: [
      { key: 'department', labelKey: 'reports.columns.department' },
      { key: 'count', labelKey: 'reports.columns.employeeCount' },
      { key: 'percentage', labelKey: 'reports.columns.percentage' },
    ],
    rows,
    filenamePrefix: 'department-analysis',
  };
}

export function buildPayrollSummaryReport(
  payrollRuns: ReportPayrollRun[],
): BuiltReport {
  return {
    columns: [
      { key: 'runDate', labelKey: 'reports.columns.runDate' },
      { key: 'status', labelKey: 'reports.columns.status' },
      { key: 'gross', labelKey: 'reports.columns.totalGross' },
      { key: 'deductions', labelKey: 'reports.columns.totalDeductions' },
      { key: 'net', labelKey: 'reports.columns.totalNet' },
    ],
    rows: payrollRuns.map((run) => ({
      runDate: run.run_date,
      status: run.status ?? '',
      gross: Number(run.total_gross ?? 0),
      deductions: Number(run.total_deductions ?? 0),
      net: Number(run.total_net ?? 0),
    })),
    filenamePrefix: 'payroll-summary',
  };
}

export function buildAttendanceSummaryReport(
  employees: ReportEmployee[],
  attendance: MonthlyAttendance[],
): BuiltReport {
  const attendanceByEmployee = new Map(
    attendance.map((row) => [row.employee_id, row]),
  );

  return {
    columns: [
      { key: 'employeeId', labelKey: 'reports.columns.employeeId' },
      { key: 'name', labelKey: 'reports.columns.employeeName' },
      { key: 'present', labelKey: 'reports.columns.presentDays' },
      { key: 'absent', labelKey: 'reports.columns.absentDays' },
      { key: 'leave', labelKey: 'reports.columns.leaveDays' },
      { key: 'late', labelKey: 'reports.columns.lateDays' },
      { key: 'recorded', labelKey: 'reports.columns.recordedDays' },
    ],
    rows: employees.map((employee) => {
      const days = Object.values(attendanceByEmployee.get(employee.id)?.days ?? {});
      const countStatus = (status: string) =>
        days.filter((day) => day.status?.toLowerCase() === status).length;

      return {
        employeeId: employee.employee_id,
        name: employeeName(employee),
        present: countStatus('present'),
        absent: countStatus('absent'),
        leave: countStatus('leave'),
        late: countStatus('late'),
        recorded: days.length,
      };
    }),
    filenamePrefix: 'attendance-summary',
  };
}

export function buildLeaveBalanceReport(
  employees: ReportEmployee[],
  balances: Map<string, LeaveBalanceResult>,
): BuiltReport {
  return {
    columns: [
      { key: 'employeeId', labelKey: 'reports.columns.employeeId' },
      { key: 'name', labelKey: 'reports.columns.employeeName' },
      { key: 'entitlement', labelKey: 'reports.columns.entitlement' },
      { key: 'accrued', labelKey: 'reports.columns.accrued' },
      { key: 'used', labelKey: 'reports.columns.used' },
      { key: 'balance', labelKey: 'reports.columns.balance' },
      { key: 'referenceDate', labelKey: 'reports.columns.referenceDate' },
    ],
    rows: employees.flatMap((employee) => {
      const balance = balances.get(employee.id);
      if (!balance) return [];
      return [{
        employeeId: employee.employee_id,
        name: employeeName(employee),
        entitlement: balance.entitlementPerYear,
        accrued: balance.accrued,
        used: balance.used,
        balance: balance.balance,
        referenceDate: balance.referenceDate,
      }];
    }),
    filenamePrefix: 'leave-balances',
  };
}

const isEmployedAt = (employee: ReportEmployee, date: string) =>
  employee.hire_date <= date
  && (!employee.termination_date || employee.termination_date > date);

export function buildTurnoverReport(
  employees: ReportEmployee[],
  period: TurnoverPeriod,
): BuiltReport {
  const headcountAtStart = employees.filter((employee) =>
    isEmployedAt(employee, period.from)).length;
  const headcountAtEnd = employees.filter((employee) =>
    isEmployedAt(employee, period.to)).length;
  const endOfServiceEvents = employees.filter((employee) =>
    isWithinInclusiveRange(employee.termination_date, period.from, period.to)).length;
  const averageHeadcount = (headcountAtStart + headcountAtEnd) / 2;
  const turnoverRate = averageHeadcount > 0
    ? Number(((endOfServiceEvents / averageHeadcount) * 100).toFixed(2))
    : 0;

  return {
    columns: [
      { key: 'from', labelKey: 'reports.columns.fromDate' },
      { key: 'to', labelKey: 'reports.columns.toDate' },
      { key: 'startHeadcount', labelKey: 'reports.columns.startHeadcount' },
      { key: 'endHeadcount', labelKey: 'reports.columns.endHeadcount' },
      { key: 'endOfServiceEvents', labelKey: 'reports.columns.endOfServiceEvents' },
      { key: 'turnoverRate', labelKey: 'reports.columns.turnoverRate' },
    ],
    rows: [{
      from: period.from,
      to: period.to,
      startHeadcount: headcountAtStart,
      endHeadcount: headcountAtEnd,
      endOfServiceEvents,
      turnoverRate,
    }],
    filenamePrefix: 'turnover-report',
  };
}

export async function exportReportToExcel(
  columns: ResolvedReportColumn[],
  rows: Array<Record<string, ReportValue>>,
  filenamePrefix: string,
): Promise<void> {
  const XLSX = await loadXLSX();
  const excelRows = rows.map((row) => Object.fromEntries(
    columns.map((column) => [column.label, row[column.key] ?? '']),
  ));
  const worksheet = XLSX.utils.json_to_sheet(excelRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
  const safePrefix = filenamePrefix.replace(/[^a-z0-9-_]+/gi, '-');
  XLSX.writeFile(workbook, `${safePrefix}-${new Date().toISOString().slice(0, 10)}.xlsx`);
}
