// src/features/settings/__tests__/system-settings-warehouse-revocation.test.tsx
//
// Round 8: SystemSettingsPage used to render `warehouses` directly. Revoking
// inventory.warehouses.read while organization.read stayed granted did not
// hide the previously loaded warehouse until the replacement
// getSystemSettings()/warehouses Promise.all settled — which, since the two
// requests run through Promise.all, could be held open indefinitely by a
// slow/deferred getSystemSettings() call alone. `visibleWarehouses` (gated
// directly at render time by canReadWarehouses) and a dedicated clearing
// effect close that gap: the warehouse disappears in the same render as the
// revocation, without waiting on any pending request.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: () => false,
    hasPermissionKey: (key: string) => hasPermissionKeyMock(key),
    isOrgAdmin: false,
    isSuperAdmin: false,
    loading: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en', dir: () => 'ltr' } }),
}));

const sysMocks = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
  saveSystemSettings: vi.fn(),
}));
vi.mock('@/services/org-settings-service', () => ({
  getSystemSettings: sysMocks.getSystemSettings,
  saveSystemSettings: sysMocks.saveSystemSettings,
  DEFAULT_SYSTEM_SETTINGS: { currency: 'SAR', numberFormat: 'en-US', dateFormat: 'en-US', defaultWarehouseId: '', printFooter: '' },
}));
vi.mock('@/lib/runtime-locale-settings', () => ({ applyRuntimeLocaleSettings: vi.fn() }));

const warehousesSelect = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: (...args: unknown[]) => warehousesSelect(...args),
        }),
      }),
    }),
  },
}));

import { SystemSettingsPage } from '../SystemSettingsPage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('SystemSettingsPage — warehouse re-gates immediately on revocation, independent of pending requests', () => {
  it('deferred-promise scenario: the revoked warehouse disappears before the next system-settings request resolves, and never reappears once it does', async () => {
    // 1. Grant organization-read and warehouse-read.
    setPermissions(['settings.organization.read', 'inventory.warehouses.read']);
    sysMocks.getSystemSettings.mockResolvedValue({
      currency: 'SAR', numberFormat: 'en-US', dateFormat: 'en-US', defaultWarehouseId: '', printFooter: '',
    });
    warehousesSelect.mockResolvedValue({
      data: [{ id: 'wh-secret', code: 'WH-SECRET', name: 'Revoked Warehouse' }],
      error: null,
    });

    const { rerender } = render(<SystemSettingsPage />);
    await waitFor(() => expect(warehousesSelect).toHaveBeenCalledTimes(1));

    // 2. Load "WH-SECRET / Revoked Warehouse" — the warehouse Select renders
    // its options into a Radix portal only while open, so the trigger must
    // actually be opened to observe the option text (not just the query call).
    await userEvent.click(screen.getByRole('combobox', { name: /Default Warehouse/ }));
    await waitFor(() => expect(screen.getByText(/WH-SECRET/)).toBeInTheDocument());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByText(/WH-SECRET/)).not.toBeInTheDocument());

    // 3. Revoke only warehouse-read.
    // 4. Keep the next system-settings request unresolved.
    let resolveSettings!: (value: unknown) => void;
    sysMocks.getSystemSettings.mockReturnValue(
      new Promise((resolve) => {
        resolveSettings = resolve;
      })
    );
    setPermissions(['settings.organization.read']);
    rerender(<SystemSettingsPage />);

    // 5. Confirm the warehouse disappears immediately — before the deferred
    // getSystemSettings() promise above ever resolves. Re-open the select:
    // the option list must now be empty (just the "None" placeholder).
    await waitFor(() => expect(screen.getByRole('combobox', { name: /Default Warehouse/ })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('combobox', { name: /Default Warehouse/ }));
    expect(screen.queryByText(/WH-SECRET/)).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    // 6. Confirm no unauthorized warehouse query fires.
    expect(warehousesSelect).toHaveBeenCalledTimes(1);

    // 7. Resolve all pending/stale promises.
    resolveSettings({ currency: 'SAR', numberFormat: 'en-US', dateFormat: 'en-US', defaultWarehouseId: '', printFooter: '' });
    await waitFor(() => expect(sysMocks.getSystemSettings).toHaveBeenCalledTimes(2));

    // 8. Confirm the warehouse never reappears.
    await userEvent.click(screen.getByRole('combobox', { name: /Default Warehouse/ }));
    expect(screen.queryByText(/WH-SECRET/)).not.toBeInTheDocument();
    expect(warehousesSelect).toHaveBeenCalledTimes(1);

    // 9. Confirm permitted system settings remain available.
    expect(screen.getByLabelText(/Display Currency/)).toBeInTheDocument();
  });

  it('an in-flight warehouse request already sent before revocation must not populate the screen once it resolves', async () => {
    setPermissions(['settings.organization.read', 'inventory.warehouses.read']);
    sysMocks.getSystemSettings.mockResolvedValue({
      currency: 'SAR', numberFormat: 'en-US', dateFormat: 'en-US', defaultWarehouseId: '', printFooter: '',
    });

    let resolveWarehouses!: (value: unknown) => void;
    warehousesSelect.mockReturnValue(
      new Promise((resolve) => {
        resolveWarehouses = resolve;
      })
    );

    const { rerender } = render(<SystemSettingsPage />);
    await waitFor(() => expect(warehousesSelect).toHaveBeenCalledTimes(1));

    // Revoke before the in-flight warehouses request settles.
    setPermissions(['settings.organization.read']);
    rerender(<SystemSettingsPage />);

    // Now let the stale, already-in-flight response land.
    resolveWarehouses({ data: [{ id: 'wh-late', code: 'WH-LATE', name: 'Late Warehouse' }], error: null });

    await waitFor(() => expect(screen.getByLabelText(/Display Currency/)).toBeInTheDocument());
    expect(screen.queryByText(/WH-LATE/)).not.toBeInTheDocument();
  });
});
