import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  hasPermissionKey: vi.fn((_key: string) => false),
  getEffectiveTenantId: vi.fn(),
  listEmployees: vi.fn(),
  listPayrollRuns: vi.fn(),
  listAttendance: vi.fn(),
  listLeaveBalances: vi.fn(),
  toast: vi.fn(),
  authState: { currentOrgId: 'org-1' as string | null },
  jsonToSheet: vi.fn(() => ({ sheet: true })),
  bookNew: vi.fn(() => ({ workbook: true })),
  bookAppendSheet: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => mocks.hasPermissionKey(key),
  }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mocks.authState,
}));

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: mocks.getEffectiveTenantId,
}));

vi.mock('@/services/hr/reports-service', () => ({
  listEmployeesForReports: mocks.listEmployees,
  listPayrollRunsForReport: mocks.listPayrollRuns,
}));

vi.mock('@/services/hr/attendance-service', () => ({
  listAttendanceForPeriod: mocks.listAttendance,
}));

vi.mock('@/services/hr/leave-service', () => ({
  listLeaveBalances: mocks.listLeaveBalances,
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/lib/export-libs', () => ({
  loadXLSX: vi.fn(async () => ({
    utils: {
      json_to_sheet: mocks.jsonToSheet,
      book_new: mocks.bookNew,
      book_append_sheet: mocks.bookAppendSheet,
    },
    writeFile: mocks.writeFile,
  })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { ReportsPage } from '../ReportsPage';

const EMPLOYEE = {
  id: 'emp-1',
  employee_id: 'E-001',
  full_name: 'Omar Ali',
  department: 'Production',
  position: 'Operator',
  status: 'active',
  hire_date: '2026-01-15',
  termination_date: null,
};

const PAYROLL_RUN = {
  id: 'run-1',
  period_id: 'period-1',
  run_date: '2026-03-31',
  status: 'approved',
  total_gross: 12000,
  total_deductions: 2000,
  total_net: 10000,
};

const permissionsByReport = {
  employee_list: ['hr.employees.read'],
  attendance_summary: ['hr.employees.read', 'hr.attendance.read'],
  payroll_summary: ['hr.payroll.read'],
  department_analysis: ['hr.employees.read'],
  turnover_report: ['hr.employees.read'],
  leave_balance: ['hr.employees.read', 'hr.leaves.read', 'hr.payroll.read'],
} as const;

function setPermissions(keys: readonly string[]) {
  mocks.hasPermissionKey.mockImplementation((key: string) => keys.includes(key));
}

function renderPage(queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity } },
})) {
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ReportsPage />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

async function selectReport(reportId: keyof typeof permissionsByReport) {
  const user = userEvent.setup();
  const trigger = screen.getByRole('combobox');
  await user.click(trigger);
  await user.click(screen.getByRole('option', {
    name: `reports.types.${{
      employee_list: 'employeeList',
      attendance_summary: 'attendanceSummary',
      payroll_summary: 'payrollSummary',
      department_analysis: 'departmentAnalysis',
      turnover_report: 'turnoverReport',
      leave_balance: 'leaveBalance',
    }[reportId]}.name`,
  }));
  return user;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authState.currentOrgId = 'org-1';
  mocks.hasPermissionKey.mockReturnValue(false);
  mocks.getEffectiveTenantId.mockResolvedValue('org-1');
  mocks.listEmployees.mockResolvedValue([EMPLOYEE]);
  mocks.listPayrollRuns.mockResolvedValue([PAYROLL_RUN]);
  mocks.listAttendance.mockResolvedValue([{
    id: 'attendance-1', org_id: 'org-1', employee_id: 'emp-1', year: 2026, month: 9,
    days: { '1': { status: 'present' }, '2': { status: 'absent' } },
  }]);
  mocks.listLeaveBalances.mockResolvedValue(new Map([['emp-1', {
    entitlementPerYear: 30,
    accrued: 15,
    used: 3,
    balance: 12,
    referenceDate: '2026-01-01',
  }]]));
});

describe('ReportsPage permissions', () => {
  it('does not query or expose reports without their resource permissions', async () => {
    setPermissions(['hr.leaves.read']);
    renderPage();

    await waitFor(() => expect(screen.getByText('reports.title')).toBeInTheDocument());
    expect(mocks.listEmployees).not.toHaveBeenCalled();
    expect(mocks.listPayrollRuns).not.toHaveBeenCalled();
    expect(screen.queryByText('reports.types.leaveBalance.name')).not.toBeInTheDocument();
  });

  it('requires both employee and attendance read for attendance reports', async () => {
    setPermissions(['hr.employees.read']);
    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'reports.types.attendanceSummary.name' }))
      .not.toBeInTheDocument();
  });

  it('requires employee, leave, and payroll read together for leave balances', async () => {
    setPermissions(['hr.employees.read', 'hr.leaves.read']);
    renderPage();

    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));
    expect(screen.queryByRole('option', { name: 'reports.types.leaveBalance.name' }))
      .not.toBeInTheDocument();
  });
});

describe('ReportsPage report generation', () => {
  it.each([
    ['employee_list', 'reports.columns.employeeId'],
    ['attendance_summary', 'reports.columns.presentDays'],
    ['payroll_summary', 'reports.columns.totalGross'],
    ['department_analysis', 'reports.columns.percentage'],
    ['turnover_report', 'reports.columns.turnoverRate'],
    ['leave_balance', 'reports.columns.balance'],
  ] as const)('renders the correct columns for %s', async (reportId, column) => {
    setPermissions(permissionsByReport[reportId]);
    renderPage();
    const user = await selectReport(reportId);
    await user.click(screen.getByRole('button', { name: 'reports.generator.generate' }));

    await waitFor(() => expect(screen.getByText(column)).toBeInTheDocument());
  });

  it('refetches when Generate is clicked twice with unchanged filters', async () => {
    setPermissions(permissionsByReport.employee_list);
    renderPage();
    await waitFor(() => expect(mocks.listEmployees).toHaveBeenCalledTimes(1));
    mocks.listEmployees.mockClear();

    const user = await selectReport('employee_list');
    const generate = screen.getByRole('button', { name: 'reports.generator.generate' });
    await user.click(generate);
    await waitFor(() => expect(screen.getByText('reports.columns.employeeId')).toBeInTheDocument());
    await user.click(generate);

    await waitFor(() => expect(mocks.listEmployees).toHaveBeenCalledTimes(2));
  });

  it('shows meaningful query errors instead of an empty report', async () => {
    setPermissions(permissionsByReport.employee_list);
    mocks.listEmployees
      .mockResolvedValueOnce([EMPLOYEE])
      .mockRejectedValueOnce(new Error('RLS denied'));
    renderPage();
    const user = await selectReport('employee_list');
    await user.click(screen.getByRole('button', { name: 'reports.generator.generate' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('RLS denied'));
  });

  it('exports the same generated columns and rows through the lazy XLSX path', async () => {
    setPermissions(permissionsByReport.payroll_summary);
    renderPage();
    const user = await selectReport('payroll_summary');
    await user.click(screen.getByRole('button', { name: 'reports.generator.generate' }));
    const exportButton = screen.getByRole('button', { name: 'reports.generator.exportExcel' });
    await waitFor(() => expect(exportButton).toBeEnabled());
    await user.click(exportButton);

    await waitFor(() => expect(mocks.writeFile).toHaveBeenCalledTimes(1));
    expect(mocks.jsonToSheet).toHaveBeenCalledWith([
      expect.objectContaining({
        'reports.columns.totalGross': 12000,
        'reports.columns.totalNet': 10000,
      }),
    ]);
  });
});

describe('ReportsPage revocation and tenant switching', () => {
  it('clears selection, result cache, and export access after permission revocation', async () => {
    setPermissions(permissionsByReport.attendance_summary);
    const { rerender, queryClient } = renderPage();
    const user = await selectReport('attendance_summary');
    await user.click(screen.getByRole('button', { name: 'reports.generator.generate' }));
    await waitFor(() => expect(screen.getByText('reports.columns.presentDays')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'reports.generator.exportExcel' })).toBeEnabled();

    setPermissions(['hr.employees.read']);
    rerender(<QueryClientProvider client={queryClient}><ReportsPage /></QueryClientProvider>);

    await waitFor(() => expect(screen.queryByTestId('report-results')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'reports.generator.exportExcel' })).toBeDisabled();
    expect(queryClient.getQueriesData({ queryKey: ['hr-report'] })
      .every(([, data]) => data === undefined)).toBe(true);
  });

  it('does not render a response that resolves after its permission is revoked', async () => {
    let resolveAttendance!: (value: unknown[]) => void;
    mocks.listAttendance.mockReturnValue(new Promise((resolve) => {
      resolveAttendance = resolve;
    }));
    setPermissions(permissionsByReport.attendance_summary);
    const { rerender, queryClient } = renderPage();
    const user = await selectReport('attendance_summary');
    await user.click(screen.getByRole('button', { name: 'reports.generator.generate' }));
    await waitFor(() => expect(mocks.listAttendance).toHaveBeenCalledTimes(1));

    setPermissions(['hr.employees.read']);
    rerender(<QueryClientProvider client={queryClient}><ReportsPage /></QueryClientProvider>);
    resolveAttendance([]);

    await waitFor(() => expect(screen.queryByTestId('report-results')).not.toBeInTheDocument());
    expect(screen.queryByText('reports.columns.presentDays')).not.toBeInTheDocument();
  });

  it('invalidates a generated report after switching organizations', async () => {
    setPermissions(permissionsByReport.employee_list);
    const { rerender, queryClient } = renderPage();
    const user = await selectReport('employee_list');
    await user.click(screen.getByRole('button', { name: 'reports.generator.generate' }));
    await waitFor(() => expect(screen.getByTestId('report-results')).toBeInTheDocument());

    mocks.authState.currentOrgId = 'org-2';
    rerender(<QueryClientProvider client={queryClient}><ReportsPage /></QueryClientProvider>);

    await waitFor(() => expect(screen.queryByTestId('report-results')).not.toBeInTheDocument());
  });
});
