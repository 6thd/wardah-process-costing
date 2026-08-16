// src/features/settings/__tests__/system-settings-write-permission-gating.test.tsx
//
// SystemSettingsPage had ZERO permission checks. There is no
// settings.system.* key in the live catalog, and route entry currently
// reuses settings.organization.read purely as a visibility proxy — it is
// not a real authorization for this screen's write. This proves the save
// action fails closed for everyone (no key exists to grant), and that the
// warehouse reference-data read requires its own real key,
// inventory.warehouses.read.

import { render, screen, waitFor } from '@testing-library/react';
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
  sysMocks.getSystemSettings.mockResolvedValue({ currency: 'SAR', numberFormat: 'en-US', dateFormat: 'en-US', defaultWarehouseId: '', printFooter: '' });
  warehousesSelect.mockResolvedValue({ data: [{ id: 'wh-1', code: 'WH1', name: 'Main' }], error: null });
});

describe('SystemSettingsPage — no settings.system.* key exists; save fails closed for everyone', () => {
  it('even with every other permission granted, no save button renders — genuine catalog gap', async () => {
    hasPermissionKeyMock.mockReturnValue(true);
    render(<SystemSettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/Display Currency/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Save Settings/ })).not.toBeInTheDocument();
    expect(sysMocks.saveSystemSettings).not.toHaveBeenCalled();
  });

  it('without inventory.warehouses.read, the warehouse reference query never fires', async () => {
    // settings.organization.read still granted: this test isolates the
    // warehouses sub-query specifically, not the page's own read gate
    // (covered separately below).
    setPermissions(['settings.organization.read']);
    render(<SystemSettingsPage />);

    await waitFor(() => expect(sysMocks.getSystemSettings).toHaveBeenCalled());
    expect(warehousesSelect).not.toHaveBeenCalled();
  });

  it('with inventory.warehouses.read, the warehouse reference query fires', async () => {
    setPermissions(['settings.organization.read', 'inventory.warehouses.read']);
    render(<SystemSettingsPage />);

    await waitFor(() => expect(warehousesSelect).toHaveBeenCalled());
  });

  it('Round 7: without settings.organization.read, getSystemSettings itself never fires — it used to load unconditionally regardless of any permission', async () => {
    setPermissions([]);
    render(<SystemSettingsPage />);

    await waitFor(() => expect(screen.getByLabelText(/Display Currency/)).toBeInTheDocument());
    expect(sysMocks.getSystemSettings).not.toHaveBeenCalled();
    expect(warehousesSelect).not.toHaveBeenCalled();
  });
});
