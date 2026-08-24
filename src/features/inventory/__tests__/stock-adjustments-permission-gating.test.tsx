// src/features/inventory/__tests__/stock-adjustments-permission-gating.test.tsx
//
// StockAdjustments (create draft, edit draft, post via handleSubmitAdjustment,
// cancel) historically ran with insufficient permission boundaries. This file
// proves exact reference-data reads and UI action gating, and verifies that
// posting delegates to the atomic server transaction rather than performing
// browser-side stock-ledger / generic-journal mutations.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
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

vi.mock('@/services/supabase-service', () => ({
  itemsService: { getAll: vi.fn().mockResolvedValue([]) },
  categoriesService: { getAll: vi.fn().mockResolvedValue([]) },
  stockMovementsService: { getAll: vi.fn().mockResolvedValue([]) },
}));

const ADJUSTMENT = {
  id: 'adj-1',
  organization_id: 'org-1',
  status: 'DRAFT',
  adjustment_type: 'PHYSICAL_COUNT',
  reason: 'Test adjustment',
  reference_number: 'REF-1',
  warehouse_id: 'wh-1',
  posting_date: '2026-01-01',
  increase_account_id: 'acct-inc',
  decrease_account_id: 'acct-dec',
  total_items: 1,
  requires_approval: false,
};

const ADJUSTMENT_ITEM = {
  id: 'item-1',
  product_id: 'p1',
  warehouse_id: 'wh-1',
  current_qty: 10,
  new_qty: 12,
  difference_qty: 2,
  current_rate: 5,
  value_difference: 10,
};

const TABLE_RESULTS: Record<string, { data: unknown; error: unknown }> = {
  stock_adjustments: { data: [ADJUSTMENT], error: null },
  stock_adjustment_items: { data: [ADJUSTMENT_ITEM], error: null },
  products: { data: [{ id: 'p1', name: 'Widget' }], error: null },
  warehouses: { data: [{ id: 'wh-1', name: 'Main', inventory_account_id: 'acct-asset' }], error: null },
  gl_accounts: { data: [{ id: 'acct-inc', code: '5950', category: 'EXPENSE' }], error: null },
  stock_ledger_entries: { data: null, error: null },
};

const fromSpy = vi.fn((table: string) => {
  const result = TABLE_RESULTS[table] ?? { data: [], error: null };
  const builder = Promise.resolve(result) as Promise<typeof result> & Record<string, unknown>;
  const chain = ['select', 'insert', 'update', 'delete', 'eq', 'order', 'in', 'limit'];
  for (const method of chain) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result.data && Array.isArray(result.data) ? { data: result.data[0], error: result.error } : result));
  return builder;
});

const rpcSpy = vi.fn().mockResolvedValue({ data: { success: true }, error: null });

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => fromSpy(table),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
    rpc: (...args: unknown[]) => rpcSpy(...args),
  }),
}));

import { InventoryModule } from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAdjustments() {
  return render(
    <MemoryRouter initialEntries={['/inventory/adjustments']}>
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

const FULL_REF_PERMS = ['inventory.products.read', 'inventory.warehouses.read', 'accounting.accounts.read'] as const;

describe('StockAdjustments — reference-data reads require their own exact key', () => {
  it('inventory.adjustments.read alone never queries products/warehouses/gl_accounts', async () => {
    setPermissions(['inventory.adjustments.read']);
    renderAdjustments();

    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('stock_adjustments'));
    expect(fromSpy).not.toHaveBeenCalledWith('products');
    expect(fromSpy).not.toHaveBeenCalledWith('warehouses');
    expect(fromSpy).not.toHaveBeenCalledWith('gl_accounts');
  });

  it('without inventory.adjustments.read, the adjustments list query never fires', async () => {
    setPermissions([...FULL_REF_PERMS]);
    renderAdjustments();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fromSpy).not.toHaveBeenCalledWith('stock_adjustments');
  });

  it('granting all three reference reads fires all three queries independently of adjustments.read', async () => {
    setPermissions([...FULL_REF_PERMS]);
    renderAdjustments();

    await waitFor(() => {
      expect(fromSpy).toHaveBeenCalledWith('products');
      expect(fromSpy).toHaveBeenCalledWith('warehouses');
      expect(fromSpy).toHaveBeenCalledWith('gl_accounts');
    });
  });
});

describe('StockAdjustments — new-adjustment trigger requires create + all reference reads', () => {
  it('create alone (no reference reads) still hides the "new adjustment" trigger', async () => {
    setPermissions(['inventory.adjustments.read', 'inventory.adjustments.create']);
    renderAdjustments();

    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('stock_adjustments'));
    expect(screen.queryByRole('button', { name: /تسوية جديدة/ })).not.toBeInTheDocument();
  });

  it('create + all reference reads shows the trigger', async () => {
    setPermissions(['inventory.adjustments.read', 'inventory.adjustments.create', ...FULL_REF_PERMS]);
    renderAdjustments();

    await waitFor(() => expect(screen.getByRole('button', { name: /تسوية جديدة/ })).toBeInTheDocument());
  });
});

describe('StockAdjustments — posting ("ترحيل") requires inventory.adjustments.approve specifically', () => {
  it('a create-only user viewing a DRAFT adjustment sees no post ("ترحيل") button', async () => {
    setPermissions(['inventory.adjustments.read', 'inventory.adjustments.create', 'inventory.adjustments.update']);
    renderAdjustments();

    await userEvent.click(await screen.findByRole('button', { name: /عرض تفاصيل تسوية المخزون adj-1/ }));

    expect(screen.queryByRole('button', { name: /ترحيل/ })).not.toBeInTheDocument();
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('a user with inventory.adjustments.approve posts only through the atomic submit RPC', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['inventory.adjustments.read', 'inventory.adjustments.approve']);
    renderAdjustments();

    await userEvent.click(await screen.findByRole('button', { name: /عرض تفاصيل تسوية المخزون adj-1/ }));
    await userEvent.click(await screen.findByRole('button', { name: /ترحيل/ }));

    await waitFor(() => expect(rpcSpy).toHaveBeenCalledWith('rpc_submit_stock_adjustment', { p_adjustment_id: 'adj-1' }));
    expect(rpcSpy).toHaveBeenCalledTimes(1);
    expect(fromSpy).not.toHaveBeenCalledWith('stock_ledger_entries');
  });

  it('the cancel ("إلغاء") action requires inventory.adjustments.update, not merely read', async () => {
    setPermissions(['inventory.adjustments.read']);
    renderAdjustments();

    await userEvent.click(await screen.findByRole('button', { name: /عرض تفاصيل تسوية المخزون adj-1/ }));

    expect(screen.queryByRole('button', { name: /إلغاء/ })).not.toBeInTheDocument();
  });
});