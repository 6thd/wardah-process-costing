// src/features/inventory/__tests__/stock-movements-load-error.test.tsx
//
// PR-R3-UI1 / INV-11: the stock movements screen queried
// products(name, code, unit_of_measure) — a column that does not exist on
// products (the real columns are `unit` and `base_uom_id`) — so the read
// always failed with HTTP 400. The catch block only toasted and fell
// through to `movements = []`, so a failed read rendered identically to a
// legitimately empty ledger ("لا توجد حركات مخزون بعد", count "(0)") even
// though Production held real posted entries. Red proof: with the failure
// still simulated (as the pre-fix query would have produced), the screen
// must show an explicit error, never the "zero movements" empty state or a
// misleading "(0)" count. Green proof: a successful read still renders the
// movements list untouched.

import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const hasPermissionKeyMock = vi.fn((_key: string) => true);

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

const stockMovementsGetAll = vi.fn();

vi.mock('@/services/supabase-service', () => ({
  itemsService: { getAll: vi.fn().mockResolvedValue([]) },
  categoriesService: { getAll: vi.fn().mockResolvedValue([]) },
  stockMovementsService: { getAll: (...args: unknown[]) => stockMovementsGetAll(...args) },
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

function renderMovements() {
  return render(
    <MemoryRouter initialEntries={['/inventory/movements']}>
      <Routes>
        <Route path="/inventory/*" element={<InventoryModule />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(true);
});

describe('StockMovements — read failure vs. genuinely empty ledger (INV-11)', () => {
  it('RED: a failed read shows an explicit error, never the empty-ledger state or a "(0)" count', async () => {
    stockMovementsGetAll.mockRejectedValue(
      Object.assign(new Error('column products.unit_of_measure does not exist'), { code: '42703' })
    );

    renderMovements();

    await waitFor(() => expect(stockMovementsGetAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());

    expect(screen.getByText('تعذّر تحميل حركات المخزون')).toBeInTheDocument();
    expect(screen.queryByText('لا توجد حركات مخزون بعد')).not.toBeInTheDocument();
    expect(screen.queryByText(/حركات المخزون \(0\)/)).not.toBeInTheDocument();
  });

  it('GREEN: a successful read renders the real movements, not an error', async () => {
    stockMovementsGetAll.mockResolvedValue([
      {
        id: 'sle-1',
        voucher_type: 'Stock Adjustment',
        voucher_number: 'ADJ-1',
        actual_qty: 5,
        qty_after_transaction: 5,
        valuation_rate: 10,
        stock_value: 50,
        posting_date: '2026-08-30',
        item: { name: 'Widget', code: 'WID-1' },
      },
    ]);

    renderMovements();

    await waitFor(() => expect(screen.getByText('Widget')).toBeInTheDocument());
    expect(screen.queryByText('تعذّر تحميل حركات المخزون')).not.toBeInTheDocument();
    expect(screen.getByText('حركات المخزون (1)')).toBeInTheDocument();
  });
});
