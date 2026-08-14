// src/features/hr/pages/__tests__/SettingsPage.permission-gating.test.tsx
//
// HR SettingsPage (policies + payroll GL account mappings) had ZERO
// permission checks. There is no hr.settings.* key in the live catalog —
// route entry currently reuses hr.employees.read purely as a visibility
// proxy — and both writes (hr_policies upsert, hr_payroll_account_mappings
// upsert) directly affect payroll/settlement postings. This proves both
// fail closed for every user, including one with every other HR permission
// granted.

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

const getHrPolicies = vi.fn(async (..._args: unknown[]) => ({ employee_daily_hours: 8 }));
const updateHrPolicies = vi.fn(async (..._args: unknown[]) => ({ success: true }));
vi.mock('@/services/hr/policies-service', () => ({
  getHrPolicies: (...args: unknown[]) => getHrPolicies(...args),
  updateHrPolicies: (...args: unknown[]) => updateHrPolicies(...args),
}));

const getPayrollAccountMappings = vi.fn(async (..._args: unknown[]) => []);
const listPostingAccounts = vi.fn(async (..._args: unknown[]) => [{ id: 'acc-1', code: '1000', name: 'Cash' }]);
const upsertPayrollAccountMapping = vi.fn(async (..._args: unknown[]) => ({ success: true }));
vi.mock('@/services/hr/payroll-account-service', () => ({
  getPayrollAccountMappings: (...args: unknown[]) => getPayrollAccountMappings(...args),
  listPostingAccounts: (...args: unknown[]) => listPostingAccounts(...args),
  upsertPayrollAccountMapping: (...args: unknown[]) => upsertPayrollAccountMapping(...args),
}));

import { SettingsPage } from '../SettingsPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsPage />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('HR SettingsPage — no hr.settings.* key exists; policy save and GL mapping fail closed for everyone', () => {
  it('even with every permission granted, no policy save button renders', async () => {
    hasPermissionKeyMock.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(getHrPolicies).toHaveBeenCalled());
    expect(screen.queryByText('settings.saveSettings')).not.toBeInTheDocument();
    expect(updateHrPolicies).not.toHaveBeenCalled();
  });

  it('even with every permission granted, no "add mapping" trigger renders', async () => {
    hasPermissionKeyMock.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(getPayrollAccountMappings).toHaveBeenCalled());
    expect(screen.queryByText('settings.addMapping')).not.toBeInTheDocument();
    expect(upsertPayrollAccountMapping).not.toHaveBeenCalled();
  });

  it('without accounting.accounts.read, the GL posting-accounts reference query never fires', async () => {
    hasPermissionKeyMock.mockImplementation((key: string) => key === 'hr.employees.read');
    renderPage();

    await waitFor(() => expect(getPayrollAccountMappings).toHaveBeenCalled());
    expect(listPostingAccounts).not.toHaveBeenCalled();
  });

  it('Round 7: without hr.employees.read, neither the policies nor the payroll-account-mappings query fires', async () => {
    hasPermissionKeyMock.mockReturnValue(false);
    renderPage();

    await waitFor(() => expect(screen.getByText('settings.title')).toBeInTheDocument());
    expect(getHrPolicies).not.toHaveBeenCalled();
    expect(getPayrollAccountMappings).not.toHaveBeenCalled();
  });

  it('Round 7: mappings visible under a granted hr.employees.read disappear once revoked, even though the query cache still holds them', async () => {
    getPayrollAccountMappings.mockResolvedValue([
      { id: 'map-1', account_type: 'basic_salary', gl_account_id: 'acc-1' },
    ]);
    hasPermissionKeyMock.mockImplementation((key: string) => key === 'hr.employees.read');
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await waitFor(() => expect(getPayrollAccountMappings).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByText('settings.accounts'));
    // "settings.linked" is the badge rendered only for an actual mapping
    // table row (unlike "settings.accountTypes.basic_salary", which also
    // appears in the always-rendered "required mappings" coverage checklist
    // below the table, independent of any permission).
    await waitFor(() => expect(screen.getByText('settings.linked')).toBeInTheDocument());

    hasPermissionKeyMock.mockReturnValue(false);
    rerender(
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.queryByText('settings.linked')).not.toBeInTheDocument());
    expect(queryClient.getQueryData(['hr', 'payroll-account-mappings'])).toBeDefined();
  });
});
