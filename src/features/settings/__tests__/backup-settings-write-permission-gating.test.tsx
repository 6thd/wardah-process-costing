// src/features/settings/__tests__/backup-settings-write-permission-gating.test.tsx
//
// BackupSettingsPage had ZERO permission checks. There is no
// settings.backup.* key in the live catalog, and the exported tables
// (products, customers, vendors, sales_invoices, purchase_orders,
// gl_entries, gl_entry_lines) belong to other modules' own resources — not
// to settings.organization at all. This proves each export button requires
// the exact read key of the resource it exports, not a single invented
// "backup" permission, and that "export all" only appears once every
// exported table's key is granted.

import { render, screen } from '@testing-library/react';
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

const backupMocks = vi.hoisted(() => ({
  fetchExportRows: vi.fn(),
  toCSV: vi.fn(),
}));
vi.mock('@/services/org-settings-service', () => ({
  EXPORTABLE_TABLES: ['products', 'customers'],
  fetchExportRows: backupMocks.fetchExportRows,
  toCSV: backupMocks.toCSV,
}));

import { BackupSettingsPage } from '../BackupSettingsPage';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  backupMocks.fetchExportRows.mockResolvedValue([{ id: '1' }]);
  backupMocks.toCSV.mockReturnValue('id\n1');
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

describe('BackupSettingsPage — no settings.backup.* key; each export requires its own resource read key', () => {
  it('with no export-relevant read keys, no per-table export rows and no "export all" button render', async () => {
    setPermissions([]);
    render(<BackupSettingsPage />);

    expect(screen.queryByText('Products')).not.toBeInTheDocument();
    expect(screen.queryByText('Customers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export all as JSON/ })).not.toBeInTheDocument();
  });

  it('inventory.products.read alone shows only the Products export row, not Customers or "export all"', async () => {
    setPermissions(['inventory.products.read']);
    render(<BackupSettingsPage />);

    expect(screen.getByText('Products')).toBeInTheDocument();
    expect(screen.queryByText('Customers')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Export all as JSON/ })).not.toBeInTheDocument();
  });

  it('a real export click calls fetchExportRows only for the permitted table', async () => {
    setPermissions(['inventory.products.read']);
    render(<BackupSettingsPage />);

    await userEvent.click(screen.getByRole('button', { name: 'JSON' }));
    expect(backupMocks.fetchExportRows).toHaveBeenCalledWith('products');
  });

  it('"export all" only appears once every exported table\'s read key is granted', async () => {
    setPermissions(['inventory.products.read', 'sales.customers.read']);
    render(<BackupSettingsPage />);

    expect(screen.getByRole('button', { name: /Export all as JSON/ })).toBeInTheDocument();
  });
});
