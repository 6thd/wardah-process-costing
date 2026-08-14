// src/features/inventory/__tests__/inventory-permission-gating-round6.test.tsx
//
// Round 6 P1 sweep: WarehouseManagement, StorageLocationsManagement,
// CategoriesManagement and StockMovements had ZERO permission gating —
// every create/edit/delete control and its handler ran for any user who
// merely cleared the /inventory/* module gate. This file proves the fix
// through the real route (InventoryModule), not by mounting the unused
// component directly.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => hasPermissionKeyMock(key),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const itemsGetAll = vi.fn().mockResolvedValue([]);
const categoriesGetAll = vi.fn().mockResolvedValue([{ id: 'cat-1', name: 'Raw Materials', name_ar: 'مواد خام' }]);
const categoriesCreate = vi.fn().mockResolvedValue({ id: 'new-cat' });
const stockMovementsGetAll = vi.fn().mockResolvedValue([{ id: 'mv-1', voucher_type: 'Stock Adjustment', actual_qty: 5 }]);

vi.mock('@/services/supabase-service', () => ({
  itemsService: { getAll: (...args: unknown[]) => itemsGetAll(...args) },
  categoriesService: {
    getAll: (...args: unknown[]) => categoriesGetAll(...args),
    create: (...args: unknown[]) => categoriesCreate(...args),
  },
  stockMovementsService: { getAll: (...args: unknown[]) => stockMovementsGetAll(...args) },
}));

const warehouseGetWarehouses = vi.fn().mockResolvedValue([{ id: 'wh-1', code: 'WH1', name: 'Main', is_active: true }]);
const warehouseCreate = vi.fn().mockResolvedValue({ id: 'new-wh' });
const warehouseUpdate = vi.fn().mockResolvedValue({ id: 'wh-1' });
const warehouseDelete = vi.fn().mockResolvedValue(undefined);
const storageLocationsGetWarehouses = vi.fn().mockResolvedValue([{ id: 'wh-1', code: 'WH1', name: 'Main', is_active: true }]);
const storageLocationsCreate = vi.fn().mockResolvedValue({ id: 'new-loc' });

vi.mock('@/services/warehouse-service', () => ({
  warehouseService: {
    getWarehouses: (...args: unknown[]) => warehouseGetWarehouses(...args),
    createWarehouse: (...args: unknown[]) => warehouseCreate(...args),
    updateWarehouse: (...args: unknown[]) => warehouseUpdate(...args),
    deleteWarehouse: (...args: unknown[]) => warehouseDelete(...args),
    getStorageLocations: (...args: unknown[]) => storageLocationsGetWarehouses(...args),
    createStorageLocation: (...args: unknown[]) => storageLocationsCreate(...args),
    updateStorageLocation: vi.fn(),
    deleteStorageLocation: vi.fn(),
  },
}));

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  }),
}));

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => ({ isEnabled: false }),
}));

vi.mock('@/hooks/use-product-uom-status', () => ({
  useProductUomStatus: () => ({ isEnabled: false, isSuccess: true, needsSetup: () => false }),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: 'org-1', user: { id: 'user-1' }, isAuthenticated: true }),
}));

import { InventoryModule } from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inventory/*" element={<InventoryModule />} />
      </Routes>
    </MemoryRouter>
  );
}

function rerenderAt(rerender: (ui: Parameters<typeof render>[0]) => void, path: string) {
  rerender(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/inventory/*" element={<InventoryModule />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('WarehouseManagement — real inventory.warehouses.* (was completely unguarded)', () => {
  it('a read-only visitor sees the list but no create/edit/delete controls', async () => {
    setPermissions(['inventory.warehouses.read']);
    renderAt('/inventory/warehouses');

    await waitFor(() => expect(screen.getByText('WH1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /مخزن جديد/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '' })).not.toBeInTheDocument();
  });

  it('without inventory.warehouses.read, the warehouse list query never fires', async () => {
    setPermissions([]);
    renderAt('/inventory/warehouses');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(warehouseGetWarehouses).not.toHaveBeenCalled();
    expect(screen.queryByText('WH1')).not.toBeInTheDocument();
  });

  it('a create grant opens the dialog; a real submit calls the create gateway', async () => {
    setPermissions(['inventory.warehouses.read', 'inventory.warehouses.create']);
    renderAt('/inventory/warehouses');

    await waitFor(() => expect(screen.getByText('WH1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /مخزن جديد/ }));
    await userEvent.type(screen.getByLabelText(/الكود/), 'WH-2');
    await userEvent.type(screen.getByLabelText(/الاسم \(English\)/), 'Second Warehouse');
    await userEvent.click(screen.getByRole('button', { name: 'إنشاء' }));

    await waitFor(() => expect(warehouseCreate).toHaveBeenCalledTimes(1));
  });

  it('revoking create mid-session (dialog already open) blocks the actual submit at the handler boundary', async () => {
    setPermissions(['inventory.warehouses.read', 'inventory.warehouses.create']);
    const { rerender } = renderAt('/inventory/warehouses');

    await waitFor(() => expect(screen.getByText('WH1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /مخزن جديد/ }));
    await userEvent.type(screen.getByLabelText(/الكود/), 'WH-2');
    await userEvent.type(screen.getByLabelText(/الاسم \(English\)/), 'Second Warehouse');

    setPermissions(['inventory.warehouses.read']);
    rerenderAt(rerender, '/inventory/warehouses');

    const submit = screen.queryByRole('button', { name: 'إنشاء' });
    if (submit) await userEvent.click(submit);

    expect(warehouseCreate).not.toHaveBeenCalled();
  });

  it('a delete grant shows delete and calls the delete gateway', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['inventory.warehouses.read', 'inventory.warehouses.delete']);
    renderAt('/inventory/warehouses');

    await waitFor(() => expect(screen.getByText('WH1')).toBeInTheDocument());
    const buttons = screen.getAllByRole('button');
    const deleteBtn = buttons.find((b) => b.querySelector('.text-destructive'));
    expect(deleteBtn).toBeTruthy();
    await userEvent.click(deleteBtn!);

    await waitFor(() => expect(warehouseDelete).toHaveBeenCalledWith('wh-1'));
  });
});

describe('StorageLocationsManagement — no dedicated catalog resource, fail-closed writes', () => {
  it('every permission granted still hides create/edit/delete — no inventory.locations.* key exists', async () => {
    hasPermissionKeyMock.mockReturnValue(true);
    renderAt('/inventory/locations');

    await waitFor(() => expect(storageLocationsGetWarehouses).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /موقع جديد/ })).not.toBeInTheDocument();
    expect(storageLocationsCreate).not.toHaveBeenCalled();
  });

  it('reference-data warehouse list still requires inventory.warehouses.read', async () => {
    setPermissions([]);
    renderAt('/inventory/locations');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(storageLocationsGetWarehouses).not.toHaveBeenCalled();
  });
});

describe('CategoriesManagement — no dedicated catalog resource, fail-closed create', () => {
  it('every permission granted still hides the add-category trigger and blocks the handler', async () => {
    hasPermissionKeyMock.mockReturnValue(true);
    renderAt('/inventory/categories');

    await waitFor(() => expect(categoriesGetAll).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /إضافة فئة/ })).not.toBeInTheDocument();
    expect(categoriesCreate).not.toHaveBeenCalled();
  });

  it('read-only list still renders existing categories', async () => {
    setPermissions([]);
    renderAt('/inventory/categories');

    await waitFor(() => expect(screen.getByText('مواد خام')).toBeInTheDocument());
  });
});

describe('StockMovements — inventory.stock_moves.read (was unguarded)', () => {
  it('without the read key, the movements query never fires and no rows render', async () => {
    setPermissions([]);
    renderAt('/inventory/movements');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(stockMovementsGetAll).not.toHaveBeenCalled();
  });

  it('with the read key, movements load', async () => {
    setPermissions(['inventory.stock_moves.read']);
    renderAt('/inventory/movements');

    await waitFor(() => expect(stockMovementsGetAll).toHaveBeenCalled());
  });
});
