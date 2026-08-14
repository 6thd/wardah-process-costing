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
    renderPage();

    await waitFor(() => expect(getPayrollAccountMappings).toHaveBeenCalled());
    expect(listPostingAccounts).not.toHaveBeenCalled();
  });
});
