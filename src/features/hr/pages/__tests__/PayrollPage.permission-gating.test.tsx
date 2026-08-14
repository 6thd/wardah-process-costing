// src/features/hr/pages/__tests__/PayrollPage.permission-gating.test.tsx
//
// PayrollPage's "Approve" button — which runs processPayrollRun, an RPC
// that posts a GL journal entry and locks the payroll period — was gated
// only by isPayrollAdmin, a display-only flag documented as such in its own
// source (payroll-admin-service.ts), never by the real hr.payroll.approve
// catalog key, and had no confirmation step. This proves the button now
// requires hr.payroll.approve, the handler rechecks it, and a confirm step
// exists before the RPC fires.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const toastMock = vi.fn();
vi.mock('@/components/ui/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const getPayrollRuns = vi.fn(async (..._args: unknown[]) => []);
vi.mock('@/services/hr/hr-service', () => ({
  getPayrollRuns: (...args: unknown[]) => getPayrollRuns(...args),
}));

const calculatePayrollPreview = vi.fn(async (..._args: unknown[]) => ({
  locked: false,
  employees: [{ id: 'e1', name: 'Ahmed', net: 1000, basic: 800, allowances: 200, deductions: 0, gosi: 0 }],
  totals: { net: 1000, basic: 800, allowances: 200, deductions: 0, gosi: 0 },
}));
const processPayrollRun = vi.fn(async (..._args: unknown[]) => ({ success: true }));
vi.mock('@/services/hr/payroll-engine', () => ({
  calculatePayrollPreview: (...args: unknown[]) => calculatePayrollPreview(...args),
  processPayrollRun: (...args: unknown[]) => processPayrollRun(...args),
}));

const checkIsPayrollAdmin = vi.fn(async (..._args: unknown[]) => true);
vi.mock('@/services/hr/payroll-admin-service', () => ({
  checkIsPayrollAdmin: (...args: unknown[]) => checkIsPayrollAdmin(...args),
}));

import { PayrollPage } from '../PayrollPage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PayrollPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('PayrollPage — approve requires hr.payroll.approve, not just the display-only isPayrollAdmin flag', () => {
  it('isPayrollAdmin=true but no hr.payroll.approve key: the approve button is hidden and the RPC never fires', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(calculatePayrollPreview).toHaveBeenCalled());
    expect(screen.queryByText('payroll.approve')).not.toBeInTheDocument();
    expect(processPayrollRun).not.toHaveBeenCalled();
  });

  it('hr.payroll.approve granted: the button appears, requires confirmation, and then calls the RPC', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['hr.payroll.approve']);
    renderPage();

    await waitFor(() => expect(screen.getByText('payroll.approve')).toBeInTheDocument());
    await userEvent.click(screen.getByText('payroll.approve'));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(processPayrollRun).toHaveBeenCalled());
  });

  it('declining the confirmation prompt does not call the RPC', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    setPermissions(['hr.payroll.approve']);
    renderPage();

    await waitFor(() => expect(screen.getByText('payroll.approve')).toBeInTheDocument());
    await userEvent.click(screen.getByText('payroll.approve'));

    expect(processPayrollRun).not.toHaveBeenCalled();
  });
});
