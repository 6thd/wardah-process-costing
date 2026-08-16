// src/features/hr/pages/__tests__/AttendancePage.test.tsx
//
// Round 6 left AttendancePage's reference-data gating untested. The
// employees query is directly gated on hr.employees.read, and the monthly
// attendance query is chained on `employees.length > 0` — so without
// hr.employees.read, employees stays empty and the attendance read never
// fires either, transitively closing the same gap. This file proves both
// halves of that chain with real spied services.

import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

const EMPLOYEE = { id: 'emp-1', name: 'Layla', status: 'active' };

const getEmployees = vi.fn(async (..._args: unknown[]) => [EMPLOYEE]);
vi.mock('@/services/hr/hr-service', () => ({
  getEmployees: (...args: unknown[]) => getEmployees(...args),
}));

const listAttendanceForPeriod = vi.fn(async (..._args: unknown[]) => [
  { employee_id: 'emp-1', days: {} },
]);
vi.mock('@/services/hr/attendance-service', () => ({
  listAttendanceForPeriod: (...args: unknown[]) => listAttendanceForPeriod(...args),
}));

import { AttendancePage } from '../AttendancePage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <AttendancePage />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  getEmployees.mockResolvedValue([EMPLOYEE]);
  listAttendanceForPeriod.mockResolvedValue([{ employee_id: 'emp-1', days: {} }]);
});

describe('AttendancePage — reference-data gating chains on hr.employees.read', () => {
  it('negative: without hr.employees.read, neither the employees nor the attendance query fires', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('attendance.title')).toBeInTheDocument());
    expect(getEmployees).not.toHaveBeenCalled();
    expect(listAttendanceForPeriod).not.toHaveBeenCalled();
    expect(screen.queryByText('Layla')).not.toBeInTheDocument();
  });

  it('positive: with hr.employees.read granted, both the employees and attendance queries fire and the employee renders', async () => {
    setPermissions(['hr.employees.read']);
    renderPage();

    await waitFor(() => expect(getEmployees).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(listAttendanceForPeriod).toHaveBeenCalledWith(['emp-1'], expect.any(Number), expect.any(Number)));
    await waitFor(() => expect(screen.getByText('Layla')).toBeInTheDocument());
  });

  it('cached-data revocation: an employee visible under a granted permission disappears once it is revoked, even though the query cache still holds it', async () => {
    setPermissions(['hr.employees.read']);
    const { rerender, queryClient } = renderPage();

    await waitFor(() => expect(screen.getByText('Layla')).toBeInTheDocument());

    setPermissions([]);
    rerender(
      <QueryClientProvider client={queryClient}>
        <AttendancePage />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.queryByText('Layla')).not.toBeInTheDocument());
    expect(queryClient.getQueryData(['hr', 'employees'])).toBeDefined();
  });

  it('in-flight revocation: an employees response resolving after revocation must not populate the grid', async () => {
    let resolveEmployees!: (value: typeof EMPLOYEE[]) => void;
    getEmployees.mockReturnValue(
      new Promise((resolve) => {
        resolveEmployees = resolve;
      })
    );
    setPermissions(['hr.employees.read']);
    renderPage();

    await waitFor(() => expect(getEmployees).toHaveBeenCalledTimes(1));

    setPermissions([]);
    resolveEmployees([EMPLOYEE]);

    await waitFor(() => expect(screen.getByText('attendance.title')).toBeInTheDocument());
    expect(screen.queryByText('Layla')).not.toBeInTheDocument();
  });
});
