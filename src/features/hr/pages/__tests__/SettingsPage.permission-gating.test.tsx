// src/features/hr/pages/__tests__/SettingsPage.permission-gating.test.tsx
//
// HR SettingsPage (policies + payroll GL account mappings) had ZERO
// permission checks, then Round 7 gated both reads behind hr.employees.read
// as a "broadest HR key" visibility proxy. Round 8 removes that fallback
// entirely: hr.employees.read is not a genuine parent resource for
// hr_policies or payroll_account_mappings, and route-permissions.ts no
// longer registers /hr/settings at all (fails closed for everyone). Neither
// read may fire merely because hr.employees.read is granted — not even with
// every other HR permission granted alongside it. This also proves the
// separately re-gated accounting.accounts.read query (the GL posting-accounts
// reference list) disappears in the same render as revocation, independent
// of whatever TanStack Query's cache still holds.

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

    await waitFor(() => expect(screen.getByText('settings.title')).toBeInTheDocument());
    expect(screen.queryByText('settings.saveSettings')).not.toBeInTheDocument();
    expect(updateHrPolicies).not.toHaveBeenCalled();
  });

  it('even with every permission granted, no "add mapping" trigger renders', async () => {
    hasPermissionKeyMock.mockReturnValue(true);
    renderPage();

    await waitFor(() => expect(screen.getByText('settings.title')).toBeInTheDocument());
    expect(screen.queryByText('settings.addMapping')).not.toBeInTheDocument();
    expect(upsertPayrollAccountMapping).not.toHaveBeenCalled();
  });

  it('Round 8: /hr/settings resolves to undefined — no hr.employees.read (or any other) route fallback', async () => {
    const { resolveRoutePermission } = await import('@/config/route-permissions');
    expect(resolveRoutePermission('hr', '/settings')).toBeUndefined();
  });

  it('Round 8: employee-read-only cannot open it — neither read fires with only hr.employees.read granted', async () => {
    hasPermissionKeyMock.mockImplementation((key: string) => key === 'hr.employees.read');
    renderPage();

    await waitFor(() => expect(screen.getByText('settings.title')).toBeInTheDocument());
    expect(getHrPolicies).not.toHaveBeenCalled();
    expect(getPayrollAccountMappings).not.toHaveBeenCalled();
  });

  it('Round 8: direct component mounting with employee-read-only does not call either service, even alongside every other HR key', async () => {
    hasPermissionKeyMock.mockImplementation(
      (key: string) => key === 'hr.employees.read' || key === 'hr.attendance.read' || key === 'hr.payroll.read' || key === 'hr.leaves.read'
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('settings.title')).toBeInTheDocument());
    expect(getHrPolicies).not.toHaveBeenCalled();
    expect(getPayrollAccountMappings).not.toHaveBeenCalled();
  });

  it('Round 8: no HR Settings write control becomes available for employee-read-only either', async () => {
    hasPermissionKeyMock.mockImplementation((key: string) => key === 'hr.employees.read');
    renderPage();

    await waitFor(() => expect(screen.getByText('settings.title')).toBeInTheDocument());
    expect(screen.queryByText('settings.saveSettings')).not.toBeInTheDocument();
    expect(screen.queryByText('settings.addMapping')).not.toBeInTheDocument();
  });

  it('without hr.employees.read (or anything else), neither the policies nor the payroll-account-mappings query fires', async () => {
    hasPermissionKeyMock.mockReturnValue(false);
    renderPage();

    await waitFor(() => expect(screen.getByText('settings.title')).toBeInTheDocument());
    expect(getHrPolicies).not.toHaveBeenCalled();
    expect(getPayrollAccountMappings).not.toHaveBeenCalled();
  });
});

describe('HR SettingsPage — accounting.accounts.read gates the GL posting-accounts reference list', () => {
  it('without accounting.accounts.read, the GL posting-accounts reference query never fires', async () => {
    hasPermissionKeyMock.mockImplementation((key: string) => key === 'hr.employees.read');
    renderPage();

    await waitFor(() => expect(screen.getByText('settings.title')).toBeInTheDocument());
    expect(listPostingAccounts).not.toHaveBeenCalled();
  });

  it('with accounting.accounts.read, the GL posting-accounts reference query fires', async () => {
    hasPermissionKeyMock.mockImplementation((key: string) => key === 'accounting.accounts.read');
    renderPage();

    await waitFor(() => expect(listPostingAccounts).toHaveBeenCalledTimes(1));
  });

  it('Round 8: an account visible under a granted permission disappears the same render as revocation, even though the query cache still holds it', async () => {
    // hr.settings.read is not a real live catalog key yet (see SettingsPage.tsx
    // comment) — granting it here simulates the future state once a
    // dedicated migration adds it, which is the only way this screen's
    // mappings table (and thus the accounts.find() lookup it drives) is
    // reachable at all. accounting.accounts.read is the permission under
    // test: it alone must control whether the account code/name resolves.
    hasPermissionKeyMock.mockImplementation(
      (key: string) => key === 'hr.settings.read' || key === 'accounting.accounts.read'
    );
    listPostingAccounts.mockResolvedValue([{ id: 'acc-secret', code: 'WH-SECRET', name: 'Revoked Account' }]);
    getPayrollAccountMappings.mockResolvedValue([
      { id: 'map-1', account_type: 'basic_salary', gl_account_id: 'acc-secret' },
    ]);

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await waitFor(() => expect(listPostingAccounts).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByText('settings.accounts'));
    await waitFor(() => expect(screen.getByText(/WH-SECRET/)).toBeInTheDocument());

    // Revoke ONLY accounting.accounts.read — hr.settings.read stays granted,
    // so the mapping row itself stays listed; only the resolved account
    // code/name must disappear (falling back to the raw gl_account_id). The
    // query cache still holds the account row (TanStack Query only pauses
    // future fetches when `enabled` flips to false — it does not erase what
    // an earlier authorized fetch already stored).
    hasPermissionKeyMock.mockImplementation((key: string) => key === 'hr.settings.read');
    rerender(
      <QueryClientProvider client={queryClient}>
        <SettingsPage />
      </QueryClientProvider>
    );

    await waitFor(() => expect(screen.queryByText(/WH-SECRET/)).not.toBeInTheDocument());
    expect(screen.getByText('acc-secret')).toBeInTheDocument();
    expect(queryClient.getQueryData(['hr', 'posting-accounts'])).toBeDefined();

    // An in-flight/stale response landing after revocation must not
    // repopulate the screen either.
    listPostingAccounts.mockResolvedValue([{ id: 'acc-secret', code: 'WH-SECRET', name: 'Revoked Account' }]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByText(/WH-SECRET/)).not.toBeInTheDocument();
  });

  it('Round 7: mappings visible under a granted accounting.accounts.read + hr context still respect their own gate independently', async () => {
    getPayrollAccountMappings.mockResolvedValue([]);
    hasPermissionKeyMock.mockImplementation((key: string) => key === 'accounting.accounts.read');
    renderPage();

    await waitFor(() => expect(listPostingAccounts).toHaveBeenCalledTimes(1));
    // hr.settings.read was never granted in this scenario, so mappings
    // (a hr-gated read, independent of accounting.accounts.read) never fires.
    expect(getPayrollAccountMappings).not.toHaveBeenCalled();
  });
});
