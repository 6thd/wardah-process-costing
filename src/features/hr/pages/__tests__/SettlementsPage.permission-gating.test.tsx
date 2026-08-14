// src/features/hr/pages/__tests__/SettlementsPage.permission-gating.test.tsx
//
// SettlementsPage (create/review/post/cancel end-of-service settlements) had
// ZERO permission checks. Review and Post were only disabled by
// isPayrollAdmin — a display-only flag documented as such in its own
// source, not a real permission check — and Cancel had no gate of any kind.
// postSettlement posts a GL journal entry and terminates the employee via
// RPC. There is no hr.settlements.* key in the live catalog, so this file
// proves every one of the four actions fails closed for every user,
// including one with every other HR permission granted, and that the
// employees reference-data read requires its own hr.employees.read key.

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

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const getEmployees = vi.fn(async (..._args: unknown[]) => [{ id: 'e1', name: 'Ahmed' }]);
vi.mock('@/services/hr/hr-service', () => ({
  getEmployees: (...args: unknown[]) => getEmployees(...args),
}));

const checkIsPayrollAdmin = vi.fn(async (..._args: unknown[]) => true);
vi.mock('@/services/hr/payroll-admin-service', () => ({
  checkIsPayrollAdmin: (...args: unknown[]) => checkIsPayrollAdmin(...args),
}));

const SETTLEMENT = {
  id: 'settle-1',
  status: 'draft',
  employee: { full_name: 'Ahmed' },
  payable_amount: 1000,
  termination_type: 'resignation',
};

const listSettlements = vi.fn(async (..._args: unknown[]) => [SETTLEMENT]);
const createSettlement = vi.fn(async (..._args: unknown[]) => ({ settlement: SETTLEMENT, result: {} }));
const submitSettlementForReview = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const postSettlement = vi.fn(async (..._args: unknown[]) => ({ success: true }));
const cancelSettlement = vi.fn(async (..._args: unknown[]) => ({ success: true }));

vi.mock('@/services/hr/settlement-service', () => ({
  listSettlements: (...args: unknown[]) => listSettlements(...args),
  createSettlement: (...args: unknown[]) => createSettlement(...args),
  submitSettlementForReview: (...args: unknown[]) => submitSettlementForReview(...args),
  postSettlement: (...args: unknown[]) => postSettlement(...args),
  cancelSettlement: (...args: unknown[]) => cancelSettlement(...args),
}));

import { SettlementsPage } from '../SettlementsPage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettlementsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('SettlementsPage — no hr.settlements.* key exists; every action fails closed', () => {
  it('even with every permission granted, the "new settlement" trigger is hidden', async () => {
    hasPermissionKeyMock.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(listSettlements).toHaveBeenCalled());
    expect(screen.queryByText('settlements.newSettlement')).not.toBeInTheDocument();
    expect(createSettlement).not.toHaveBeenCalled();
  });

  it('opening details on a draft settlement (every permission granted) shows no review/cancel button', async () => {
    hasPermissionKeyMock.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('common.view'));

    await waitFor(() => expect(screen.getByText('settlements.detailsTitle')).toBeInTheDocument());
    expect(screen.queryByText('settlements.sendReview')).not.toBeInTheDocument();
    expect(screen.queryByText('settlements.cancelSettlement')).not.toBeInTheDocument();
    expect(submitSettlementForReview).not.toHaveBeenCalled();
    expect(cancelSettlement).not.toHaveBeenCalled();
  });

  it('opening details on a review-status settlement (every permission granted) shows no post button', async () => {
    listSettlements.mockResolvedValue([{ ...SETTLEMENT, status: 'review' }]);
    hasPermissionKeyMock.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByRole('tab', { name: /settlements.review/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('tab', { name: /settlements.review/ }));
    await waitFor(() => expect(screen.getByText('Ahmed')).toBeInTheDocument());
    await userEvent.click(screen.getByLabelText('common.view'));

    await waitFor(() => expect(screen.getByText('settlements.detailsTitle')).toBeInTheDocument());
    expect(screen.queryByText('settlements.post')).not.toBeInTheDocument();
    expect(postSettlement).not.toHaveBeenCalled();
  });

  it('without hr.employees.read, the employees reference query never fires', async () => {
    setPermissions([]);
    renderPage();

    await waitFor(() => expect(listSettlements).toHaveBeenCalled());
    expect(getEmployees).not.toHaveBeenCalled();
  });
});
