// src/features/hr/pages/__tests__/ReportsPage.test.tsx
//
// Round 6 left HR ReportsPage's per-resource query gating untested. Its
// entry route accepts anyOf the four HR catalog keys, so a user entering
// with only e.g. hr.leaves.read must not see employee or payroll
// aggregates — each of the two underlying queries here checks its own key
// (hr.employees.read / hr.payroll.read) independently. This file proves
// both negative and positive cases, plus that a permission revoked after
// data has loaded is not left visible via the query cache, with real spied
// services.

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

const EMPLOYEE = { id: 'emp-1', name: 'Omar', status: 'active' };
const PAYROLL_RUN = { id: 'run-1', periodCode: '2026-01', totalNet: 12000 };

const getEmployees = vi.fn(async (..._args: unknown[]) => [EMPLOYEE]);
const getPayrollRuns = vi.fn(async (..._args: unknown[]) => [PAYROLL_RUN]);
vi.mock('@/services/hr/hr-service', () => ({
  getEmployees: (...args: unknown[]) => getEmployees(...args),
  getPayrollRuns: (...args: unknown[]) => getPayrollRuns(...args),
}));

import { ReportsPage } from '../ReportsPage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ReportsPage />
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  getEmployees.mockResolvedValue([EMPLOYEE]);
  getPayrollRuns.mockResolvedValue([PAYROLL_RUN]);
});

describe('ReportsPage — employees and payroll each require their own key', () => {
  it('negative: without hr.employees.read or hr.payroll.read, neither query fires', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(screen.getByText('reports.title')).toBeInTheDocument());
    expect(getEmployees).not.toHaveBeenCalled();
    expect(getPayrollRuns).not.toHaveBeenCalled();
    expect(screen.queryByText('2026-01')).not.toBeInTheDocument();
  });

  it('negative: hr.leaves.read alone (a real HR key, but not employees or payroll) does not open either query', async () => {
    setPermissions(['hr.leaves.read']);
    renderPage();

    await waitFor(() => expect(screen.getByText('reports.title')).toBeInTheDocument());
    expect(getEmployees).not.toHaveBeenCalled();
    expect(getPayrollRuns).not.toHaveBeenCalled();
  });

  it('positive: hr.employees.read alone loads employees but not payroll', async () => {
    setPermissions(['hr.employees.read']);
    renderPage();

    await waitFor(() => expect(getEmployees).toHaveBeenCalledTimes(1));
    expect(getPayrollRuns).not.toHaveBeenCalled();
  });

  it('positive: hr.payroll.read alone loads payroll runs and renders them', async () => {
    setPermissions(['hr.payroll.read']);
    renderPage();

    await waitFor(() => expect(getPayrollRuns).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('2026-01')).toBeInTheDocument());
    expect(getEmployees).not.toHaveBeenCalled();
  });

  it('cached-data revocation: payroll data visible under a granted permission disappears once revoked, even though the query cache still holds it', async () => {
    setPermissions(['hr.payroll.read']);
    const { rerender, queryClient } = renderPage();

    await waitFor(() => expect(screen.getByText('2026-01')).toBeInTheDocument());

    setPermissions([]);
    rerender(
      <QueryClientProvider client={queryClient}>
        <ReportsPage />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.queryByText('2026-01')).not.toBeInTheDocument());
    expect(queryClient.getQueryData(['hr', 'payroll-runs'])).toBeDefined();
  });

  it('in-flight revocation: a payroll response resolving after revocation must not populate the trends chart', async () => {
    let resolvePayroll!: (value: typeof PAYROLL_RUN[]) => void;
    getPayrollRuns.mockReturnValue(
      new Promise((resolve) => {
        resolvePayroll = resolve;
      })
    );
    setPermissions(['hr.payroll.read']);
    renderPage();

    await waitFor(() => expect(getPayrollRuns).toHaveBeenCalledTimes(1));

    setPermissions([]);
    resolvePayroll([PAYROLL_RUN]);

    await waitFor(() => expect(screen.getByText('reports.title')).toBeInTheDocument());
    expect(screen.queryByText('2026-01')).not.toBeInTheDocument();
  });
});
