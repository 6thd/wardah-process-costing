// src/features/hr/pages/__tests__/DashboardPage.permission-gating.test.tsx
//
// DashboardPage (شاشة HR الرئيسية) كانت تحمّل كل الموارد الأربعة (employees،
// attendance، payroll، leaves) وتعرض كل التبويبات والبطاقات لأي مستخدم اجتاز
// anyOf دخول الموديول. هذه الاختبارات تثبت أن كل استعلام وكل بطاقة/تبويب
// مربوط بمفتاحه الفعلي في route-permissions.ts، وأن التبديل داخل نفس الـmount
// لا يترك بيانات قديمة ظاهرة.

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => hasPermissionKeyMock(key),
  }),
}));

// useHrTranslation يبني فوق useTranslation('hr') الحقيقي؛ تبسيطه هنا لإرجاع
// المفتاح الخام (نفس نمط بقية اختبارات صفحات Overview) يفصل الاختبار عن نصوص
// الترجمة نفسها.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'ar', resolvedLanguage: 'ar' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const getAttendanceLogs = vi.fn(async (..._args: unknown[]) => [
  { id: 'a1', employeeId: 'e1', employeeName: 'أحمد', date: new Date().toISOString(), status: 'present', checkIn: new Date().toISOString() },
]);
const getEmployees = vi.fn(async (..._args: unknown[]) => [
  { id: 'e1', status: 'active' },
  { id: 'e2', status: 'inactive' },
]);
const getPayrollRuns = vi.fn(async (..._args: unknown[]) => [
  { id: 'p1', periodCode: '2026-07', employeeCount: 2, totalNet: 5000, currency: 'SAR', status: 'posted' },
]);
const getLeaveRequests = vi.fn(async (..._args: unknown[]) => [
  { id: 'l1', status: 'pending' },
]);

vi.mock('@/services/hr/hr-service', () => ({
  getAttendanceLogs: (...args: unknown[]) => getAttendanceLogs(...args),
  getEmployees: (...args: unknown[]) => getEmployees(...args),
  getPayrollRuns: (...args: unknown[]) => getPayrollRuns(...args),
  getLeaveRequests: (...args: unknown[]) => getLeaveRequests(...args),
}));

import { DashboardPage } from '../DashboardPage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderDashboard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('HR DashboardPage — per-resource loading and rendering', () => {
  it('with no HR keys, loads nothing and shows no tabs or netAmount card', async () => {
    setPermissions([]);
    renderDashboard();

    await waitFor(() => expect(screen.getByText('dashboard.title')).toBeInTheDocument());

    expect(getAttendanceLogs).not.toHaveBeenCalled();
    expect(getEmployees).not.toHaveBeenCalled();
    expect(getPayrollRuns).not.toHaveBeenCalled();
    expect(getLeaveRequests).not.toHaveBeenCalled();

    expect(screen.queryByText('dashboard.attendance')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.payroll')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.distribution')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.netAmount')).not.toBeInTheDocument();
  });

  it('hr.employees.read alone loads employees only and shows only the distribution tab', async () => {
    setPermissions(['hr.employees.read']);
    renderDashboard();

    await waitFor(() => expect(getEmployees).toHaveBeenCalled());
    expect(getAttendanceLogs).not.toHaveBeenCalled();
    expect(getPayrollRuns).not.toHaveBeenCalled();
    expect(getLeaveRequests).not.toHaveBeenCalled();

    expect(screen.getByText('dashboard.totalEmployees')).toBeInTheDocument();
    expect(screen.queryByText('dashboard.attendanceRate')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.leaveRequests')).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText('dashboard.distribution')).toBeInTheDocument());
    expect(screen.queryByText('dashboard.attendance')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.payroll')).not.toBeInTheDocument();
    expect(screen.getByText('dashboard.employeeStatus')).toBeInTheDocument();
    expect(screen.queryByText('dashboard.attendanceStatus')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.netAmount')).not.toBeInTheDocument();
  });

  it('hr.attendance.read alone loads attendance only and shows the attendance + distribution tabs', async () => {
    setPermissions(['hr.attendance.read']);
    renderDashboard();

    await waitFor(() => expect(getAttendanceLogs).toHaveBeenCalled());
    expect(getEmployees).not.toHaveBeenCalled();
    expect(getPayrollRuns).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByText('dashboard.attendance')).toBeInTheDocument());
    expect(screen.getByText('dashboard.distribution')).toBeInTheDocument();
    expect(screen.queryByText('dashboard.payroll')).not.toBeInTheDocument();
    // بطاقة نسبة الحضور تحتاج كلا المفتاحين معًا — لا تظهر بمفتاح واحد فقط
    expect(screen.queryByText('dashboard.attendanceRate')).not.toBeInTheDocument();
  });

  it('hr.payroll.read alone loads payroll only, shows payroll tab and netAmount card', async () => {
    setPermissions(['hr.payroll.read']);
    renderDashboard();

    await waitFor(() => expect(getPayrollRuns).toHaveBeenCalled());
    expect(getEmployees).not.toHaveBeenCalled();
    expect(getAttendanceLogs).not.toHaveBeenCalled();

    await waitFor(() => expect(screen.getByText('dashboard.payroll')).toBeInTheDocument());
    expect(screen.queryByText('dashboard.attendance')).not.toBeInTheDocument();
    expect(screen.queryByText('dashboard.distribution')).not.toBeInTheDocument();
    expect(screen.getByText('dashboard.netAmount')).toBeInTheDocument();
  });

  it('hr.leaves.read alone loads leave requests only and shows the leave-requests stat card', async () => {
    setPermissions(['hr.leaves.read']);
    renderDashboard();

    await waitFor(() => expect(getLeaveRequests).toHaveBeenCalled());
    expect(getEmployees).not.toHaveBeenCalled();
    expect(getAttendanceLogs).not.toHaveBeenCalled();
    expect(getPayrollRuns).not.toHaveBeenCalled();

    expect(screen.getByText('dashboard.leaveRequests')).toBeInTheDocument();
  });

  it('all four keys load everything and show every tab, card and the netAmount summary', async () => {
    setPermissions(['hr.employees.read', 'hr.attendance.read', 'hr.payroll.read', 'hr.leaves.read']);
    renderDashboard();

    await waitFor(() => expect(getEmployees).toHaveBeenCalled());
    expect(getAttendanceLogs).toHaveBeenCalled();
    expect(getPayrollRuns).toHaveBeenCalled();
    expect(getLeaveRequests).toHaveBeenCalled();

    expect(screen.getByText('dashboard.attendanceRate')).toBeInTheDocument();
    expect(screen.getByText('dashboard.attendance')).toBeInTheDocument();
    expect(screen.getByText('dashboard.payroll')).toBeInTheDocument();
    expect(screen.getByText('dashboard.distribution')).toBeInTheDocument();
    expect(screen.getByText('dashboard.netAmount')).toBeInTheDocument();
  });
});

describe('HR DashboardPage — permission switch within the same mount leaves no stale data', () => {
  it('losing hr.payroll.read mid-session removes the payroll tab and netAmount card', async () => {
    setPermissions(['hr.payroll.read']);
    const { rerender } = renderDashboard();

    await waitFor(() => expect(screen.getByText('dashboard.payroll')).toBeInTheDocument());
    expect(screen.getByText('dashboard.netAmount')).toBeInTheDocument();

    setPermissions([]);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <DashboardPage />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.queryByText('dashboard.payroll')).not.toBeInTheDocument());
    expect(screen.queryByText('dashboard.netAmount')).not.toBeInTheDocument();
  });

  it('switching from hr.employees.read to hr.attendance.read swaps the distribution card shown, without unmounting', async () => {
    setPermissions(['hr.employees.read']);
    const { rerender } = renderDashboard();

    await waitFor(() => expect(screen.getByText('dashboard.employeeStatus')).toBeInTheDocument());
    expect(screen.queryByText('dashboard.attendanceStatus')).not.toBeInTheDocument();

    setPermissions(['hr.attendance.read']);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <DashboardPage />
      </QueryClientProvider>
    );

    // بعد التبديل "attendance" هو التبويب الافتراضي الجديد؛ الدخول لتبويب
    // "التوزيع" يتطلب نقرة فعلية — نفس ما يفعله مستخدم حقيقي.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'dashboard.distribution' })).toBeInTheDocument());
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'dashboard.distribution' }), { button: 0, ctrlKey: false });

    await waitFor(() => expect(screen.getByText('dashboard.attendanceStatus')).toBeInTheDocument());
    expect(screen.queryByText('dashboard.employeeStatus')).not.toBeInTheDocument();
    expect(getAttendanceLogs).toHaveBeenCalled();
  });
});
