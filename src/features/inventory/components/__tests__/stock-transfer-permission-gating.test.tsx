// src/features/inventory/components/__tests__/stock-transfer-permission-gating.test.tsx
//
// StockTransferManagement (draft creation + submit/confirm, which writes
// stock_ledger_entries exactly like StockAdjustments' post action) ran with
// ZERO permission checks, and loaded warehouses + products unconditionally.
// This proves the fix: reference-data reads gated by their own key, the
// "new transfer" trigger requires create + both reference reads, and the
// confirm ("تأكيد التحويل") action requires inventory.stock_moves.approve.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const itemsGetAll = vi.fn().mockResolvedValue([{ id: 'p1', name: 'Widget', code: 'W-1' }]);
vi.mock('@/services/supabase-service', () => ({
  itemsService: { getAll: (...args: unknown[]) => itemsGetAll(...args) },
}));

const TRANSFER = {
  id: 'tr-1',
  reference_number: 'TR-001',
  transfer_date: '2026-01-01',
  status: 'DRAFT',
  from_warehouse_id: 'wh-1',
  to_warehouse_id: 'wh-2',
  total_items: 1,
};

const TABLE_RESULTS: Record<string, { data: unknown; error: unknown }> = {
  user_organizations: { data: { org_id: 'org-1' }, error: null },
  stock_transfers: { data: [TRANSFER], error: null },
  warehouses: { data: [{ id: 'wh-1', code: 'WH1', name: 'Main' }, { id: 'wh-2', code: 'WH2', name: 'Branch' }], error: null },
  stock_transfer_items: { data: [], error: null },
};

const fromSpy = vi.fn((table: string) => {
  const result = TABLE_RESULTS[table] ?? { data: [], error: null };
  const builder: Record<string, unknown> = {};
  const chain = ['select', 'insert', 'update', 'delete', 'eq', 'order'];
  for (const method of chain) {
    builder[method] = vi.fn(() => builder);
  }
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder;
});

vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => fromSpy(table),
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'user-1' } } }) },
  }),
}));

import StockTransferManagement from '../StockTransfer';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

const FULL_REF_PERMS = ['inventory.warehouses.read', 'inventory.items.read'] as const;

describe('StockTransferManagement — reference-data reads require their own exact key', () => {
  it('inventory.stock_moves.read alone never queries warehouses or items', async () => {
    setPermissions(['inventory.stock_moves.read']);
    render(<StockTransferManagement />);

    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('stock_transfers'));
    expect(fromSpy).not.toHaveBeenCalledWith('warehouses');
    expect(itemsGetAll).not.toHaveBeenCalled();
  });

  it('without inventory.stock_moves.read, the transfers list query never fires', async () => {
    setPermissions([...FULL_REF_PERMS]);
    render(<StockTransferManagement />);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(fromSpy).not.toHaveBeenCalledWith('stock_transfers');
  });
});

describe('StockTransferManagement — "new transfer" trigger requires create + reference reads', () => {
  it('create alone (no warehouse/item read) still hides the trigger', async () => {
    setPermissions(['inventory.stock_moves.read', 'inventory.stock_moves.create']);
    render(<StockTransferManagement />);

    await waitFor(() => expect(fromSpy).toHaveBeenCalledWith('stock_transfers'));
    expect(screen.queryByRole('button', { name: /تحويل جديد/ })).not.toBeInTheDocument();
  });

  it('create + reference reads shows the trigger', async () => {
    setPermissions(['inventory.stock_moves.read', 'inventory.stock_moves.create', ...FULL_REF_PERMS]);
    render(<StockTransferManagement />);

    await waitFor(() => expect(screen.getByRole('button', { name: /تحويل جديد/ })).toBeInTheDocument());
  });
});

describe('StockTransferManagement — confirm ("تأكيد التحويل") requires inventory.stock_moves.approve', () => {
  it('a create-only user sees no confirm button on a DRAFT transfer', async () => {
    setPermissions(['inventory.stock_moves.read', 'inventory.stock_moves.create']);
    render(<StockTransferManagement />);

    await waitFor(() => expect(screen.getByText('TR-001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /تأكيد التحويل/ })).not.toBeInTheDocument();
  });

  it('an approve grant shows the confirm button', async () => {
    setPermissions(['inventory.stock_moves.read', 'inventory.stock_moves.approve']);
    render(<StockTransferManagement />);

    await waitFor(() => expect(screen.getByRole('button', { name: /تأكيد التحويل/ })).toBeInTheDocument());
  });
});
