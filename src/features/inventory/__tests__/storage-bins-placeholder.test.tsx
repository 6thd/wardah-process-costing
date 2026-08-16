// src/features/inventory/__tests__/storage-bins-placeholder.test.tsx
//
// Round 6 left /inventory/bins untested. Renders the REAL route
// (InventoryModule at '/inventory/bins'), not an assumed component: the
// element actually mounted there (StorageBinsPage, an inline function in
// index.tsx) is a static "under development" placeholder — it issues no
// query and renders no data, unlike its sibling /inventory/locations
// (StorageLocationsManagement, a real, data-backed component). This proves
// that fact directly rather than assuming it from the route table, and
// guards against a future change silently wiring the placeholder to real
// data without a corresponding permission-gating pass.

import { render, screen, waitFor } from '@testing-library/react';
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
const categoriesGetAll = vi.fn().mockResolvedValue([]);
const stockMovementsGetAll = vi.fn().mockResolvedValue([]);

vi.mock('@/services/supabase-service', () => ({
  itemsService: { getAll: (...args: unknown[]) => itemsGetAll(...args) },
  categoriesService: {
    getAll: (...args: unknown[]) => categoriesGetAll(...args),
    create: vi.fn(),
  },
  stockMovementsService: { getAll: (...args: unknown[]) => stockMovementsGetAll(...args) },
}));

const warehouseGetWarehouses = vi.fn().mockResolvedValue([]);
const warehouseGetStorageLocations = vi.fn().mockResolvedValue([]);

vi.mock('@/services/warehouse-service', () => ({
  warehouseService: {
    getWarehouses: (...args: unknown[]) => warehouseGetWarehouses(...args),
    createWarehouse: vi.fn(),
    updateWarehouse: vi.fn(),
    deleteWarehouse: vi.fn(),
    getStorageLocations: (...args: unknown[]) => warehouseGetStorageLocations(...args),
    createStorageLocation: vi.fn(),
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

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('/inventory/bins — the actually mounted component is a placeholder, not a data screen', () => {
  it('with inventory.warehouses.read granted, renders the "under development" placeholder text and issues no queries', async () => {
    setPermissions(['inventory.warehouses.read']);
    renderAt('/inventory/bins');

    await waitFor(() => expect(screen.getByText('إدارة صناديق التخزين')).toBeInTheDocument());
    expect(screen.getByText('هذه الميزة قيد التطوير')).toBeInTheDocument();

    // No storage-bins-specific service exists yet to spy on directly (there
    // is no StorageBinsManagement wired in); this proves the negative from
    // the other side — none of the OTHER inventory data services this
    // module can reach were invoked by mounting /bins, confirming the
    // placeholder truly issues no request of its own.
    expect(warehouseGetStorageLocations).not.toHaveBeenCalled();
    expect(itemsGetAll).not.toHaveBeenCalled();
    expect(categoriesGetAll).not.toHaveBeenCalled();
  });

  // Route-level fail-closed entry to /inventory/bins (requiring
  // inventory.warehouses.read) is ModuleGuard's job, exercised in
  // src/config/__tests__/route-permissions.test.ts — this file renders
  // InventoryModule directly (matching the existing inventory test
  // convention) to focus on what actually happens once the route is
  // reached, which is exactly the placeholder-vs-real-component question
  // above: StorageBinsPage has no permission check of its own to test
  // because it has no data to protect.

  it('sibling /inventory/locations mounts a real data-backed component (StorageLocationsManagement), unlike /bins', async () => {
    warehouseGetWarehouses.mockResolvedValue([{ id: 'wh-1', code: 'WH1', name: 'Main', is_active: true }]);
    setPermissions(['inventory.warehouses.read']);
    renderAt('/inventory/locations');

    await waitFor(() => expect(warehouseGetWarehouses).toHaveBeenCalled());
    expect(screen.queryByText('هذه الميزة قيد التطوير')).not.toBeInTheDocument();
  });
});
