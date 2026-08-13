// src/features/inventory/__tests__/inventory-permission-gating.test.tsx
//
// InventoryOverview كان يحمّل items دائمًا ويعرض كل روابطه بغض النظر عن أي
// مفتاح فعليًا فتح الشاشة عبر anyOf(items/stock_moves/warehouses). هذه
// الاختبارات تثبت الفصل الفعلي.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

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
const itemsCreate = vi.fn().mockResolvedValue({ id: 'new-item' });

vi.mock('@/services/supabase-service', () => ({
  itemsService: {
    getAll: (...args: unknown[]) => itemsGetAll(...args),
    create: (...args: unknown[]) => itemsCreate(...args),
  },
  categoriesService: { getAll: vi.fn().mockResolvedValue([]) },
  stockMovementsService: { getAll: vi.fn().mockResolvedValue([]) },
}));

// نموذج إضافة صنف يحمّل المخازن كبيانات مرجعية عبر getSupabase().from('warehouses')
// مباشرة (لا خدمة مغلَّفة) — سلسلة قابلة للتسلسل فعليًا بدل الموك الفارغ في setup.ts.
const warehousesSelect = vi.fn().mockResolvedValue({ data: [{ id: 'wh-1', code: 'WH1', name: 'Main' }], error: null });

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: (...args: unknown[]) => warehousesSelect(...args),
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

describe('InventoryOverview — per-section permission-aware loading', () => {
  it('inventory.items.read alone loads items and shows only the items-derived cards/links', async () => {
    setPermissions(['inventory.items.read']);
    renderAt('/inventory/overview');

    await waitFor(() => expect(itemsGetAll).toHaveBeenCalledTimes(1));
    expect(screen.getByText('إجمالي الأصناف')).toBeInTheDocument();
    expect(screen.queryByText('🏭 المخازن (1)')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /inventory.stockMoves/ })).not.toBeInTheDocument();
  });

  it('inventory.warehouses.read alone never fires the items request and hides items metrics', async () => {
    setPermissions(['inventory.warehouses.read']);
    renderAt('/inventory/overview');

    await waitFor(() => expect(screen.getByText('🏭 المخازن (1)')).toBeInTheDocument());
    expect(itemsGetAll).not.toHaveBeenCalled();
    expect(screen.queryByText('إجمالي الأصناف')).not.toBeInTheDocument();
  });

  it('inventory.stock_moves.read alone shows only movement/transfer links, not warehouses or items', async () => {
    setPermissions(['inventory.stock_moves.read']);
    renderAt('/inventory/overview');

    await waitFor(() => expect(screen.getByText('inventory.stockMoves')).toBeInTheDocument());
    expect(screen.getByText('🔄 تحويلات البضاعة')).toBeInTheDocument();
    expect(screen.queryByText('🏭 المخازن (1)')).not.toBeInTheDocument();
    expect(screen.queryByText('إجمالي الأصناف')).not.toBeInTheDocument();
    expect(itemsGetAll).not.toHaveBeenCalled();
  });

  it('switching items → warehouses in the same mount drops the stale items metrics', async () => {
    setPermissions(['inventory.items.read']);
    const { rerender } = renderAt('/inventory/overview');

    await waitFor(() => expect(itemsGetAll).toHaveBeenCalledTimes(1));
    expect(screen.getByText('إجمالي الأصناف')).toBeInTheDocument();

    setPermissions(['inventory.warehouses.read']);
    rerender(
      <MemoryRouter initialEntries={['/inventory/overview']}>
        <Routes>
          <Route path="/inventory/*" element={<InventoryModule />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByText('🏭 المخازن (1)')).toBeInTheDocument());
    expect(screen.queryByText('إجمالي الأصناف')).not.toBeInTheDocument();
    expect(itemsGetAll).toHaveBeenCalledTimes(1);
  });
});

describe('ItemsManagement — screen read vs. inventory.items.create', () => {
  it('hides the add-item trigger without the create key', async () => {
    setPermissions(['inventory.items.read']);
    renderAt('/inventory/items');

    await waitFor(() => expect(itemsGetAll).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '+ إضافة صنف جديد' })).not.toBeInTheDocument();
  });

  it('does not load warehouses reference data for an items-only reader without the create key', async () => {
    setPermissions(['inventory.items.read']);
    renderAt('/inventory/items');

    await waitFor(() => expect(itemsGetAll).toHaveBeenCalled());
    expect(warehousesSelect).not.toHaveBeenCalled();
  });

  it('loads warehouses reference data once the create key is granted', async () => {
    setPermissions(['inventory.items.read', 'inventory.items.create']);
    renderAt('/inventory/items');

    await waitFor(() => expect(warehousesSelect).toHaveBeenCalled());
  });

  it('revoking create mid-session (form already open) blocks the actual submit', async () => {
    setPermissions(['inventory.items.read', 'inventory.items.create']);
    const { rerender } = renderAt('/inventory/items');
    await waitFor(() => expect(itemsGetAll).toHaveBeenCalled());
    await waitFor(() => expect(warehousesSelect).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة صنف جديد' }));
    expect(screen.getByText('إضافة صنف جديد')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('اسم الصنف'), 'صنف تجريبي');
    await userEvent.type(screen.getByPlaceholderText('كود الصنف'), 'ITM-1');

    setPermissions(['inventory.items.read']);
    rerenderAt(rerender, '/inventory/items');

    const submitButton = screen.getByRole('button', { name: 'common.add' });
    await userEvent.click(submitButton);

    expect(itemsCreate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('لا تملك صلاحية إضافة أصناف');
  });

  it('a user with read + create sees and can use the add form', async () => {
    setPermissions(['inventory.items.read', 'inventory.items.create']);
    renderAt('/inventory/items');
    await waitFor(() => expect(itemsGetAll).toHaveBeenCalled());
    await waitFor(() => expect(warehousesSelect).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة صنف جديد' }));
    await userEvent.type(screen.getByPlaceholderText('اسم الصنف'), 'صنف تجريبي');
    await userEvent.type(screen.getByPlaceholderText('كود الصنف'), 'ITM-1');
    await userEvent.click(screen.getByRole('button', { name: 'common.add' }));

    await waitFor(() => expect(itemsCreate).toHaveBeenCalled());
  });
});
