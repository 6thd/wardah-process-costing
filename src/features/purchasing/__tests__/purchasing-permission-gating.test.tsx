// src/features/purchasing/__tests__/purchasing-permission-gating.test.tsx
//
// PurchasingOverview كان يحمّل ويعرض الموردين وأوامر الشراء معًا بغض النظر عن
// أي مفتاح فعليًا فتح الشاشة عبر anyOf. هذه الاختبارات تثبت أن كل قسم مستقل
// عن الآخر: تحميلًا وعرضًا وروابط.

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

const suppliersGetAll = vi.fn().mockResolvedValue([]);
const purchaseOrdersGetAll = vi.fn().mockResolvedValue([]);

vi.mock('@/services/supabase-service', () => ({
  suppliersService: { getAll: (...args: unknown[]) => suppliersGetAll(...args) },
  purchaseOrdersService: { getAll: (...args: unknown[]) => purchaseOrdersGetAll(...args) },
  newPurchaseOrdersService: { getAll: vi.fn().mockResolvedValue([]) },
}));

vi.mock('@/services/purchasing-service', () => ({
  getAllGoodsReceipts: vi.fn().mockResolvedValue({ success: true, data: [] }),
}));

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => ({ isEnabled: false }),
}));

vi.mock('@/components/forms/PurchaseOrderForm', () => ({ PurchaseOrderForm: () => null }));
vi.mock('@/components/forms/GoodsReceiptForm', () => ({ GoodsReceiptForm: () => null }));
vi.mock('@/components/forms/UomGoodsReceiptForm', () => ({ UomGoodsReceiptForm: () => null }));
vi.mock('@/components/forms/SupplierInvoiceForm', () => ({ SupplierInvoiceForm: () => null }));
vi.mock('../components/SupplierPayments', () => ({ SupplierPayments: () => null }));

import { PurchasingModule } from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/purchasing/*" element={<PurchasingModule />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('PurchasingOverview — per-section permission-aware loading', () => {
  it('purchasing.suppliers.read alone loads suppliers but never fires the purchase-orders request', async () => {
    setPermissions(['purchasing.suppliers.read']);
    renderAt('/purchasing/overview');

    await waitFor(() => expect(suppliersGetAll).toHaveBeenCalled());
    expect(purchaseOrdersGetAll).not.toHaveBeenCalled();
  });

  it('purchasing.purchase_orders.read alone loads orders but never fires the suppliers request', async () => {
    setPermissions(['purchasing.purchase_orders.read']);
    renderAt('/purchasing/overview');

    await waitFor(() => expect(purchaseOrdersGetAll).toHaveBeenCalled());
    expect(suppliersGetAll).not.toHaveBeenCalled();
  });

  it('a suppliers-only user sees the supplier card but not the orders cards or links', async () => {
    setPermissions(['purchasing.suppliers.read']);
    renderAt('/purchasing/overview');

    await waitFor(() => expect(suppliersGetAll).toHaveBeenCalled());
    expect(screen.getByText('إجمالي الموردين')).toBeInTheDocument();
    expect(screen.queryByText('قيمة الطلبات (ريال)')).not.toBeInTheDocument();
    expect(screen.queryByText('طلبات معلقة')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /purchasing.purchaseOrders/ })).not.toBeInTheDocument();
  });

  it('switching suppliers → orders in the same mount drops the stale supplier card and loads orders fresh', async () => {
    setPermissions(['purchasing.suppliers.read']);
    const { rerender } = renderAt('/purchasing/overview');

    await waitFor(() => expect(suppliersGetAll).toHaveBeenCalledTimes(1));
    expect(screen.getByText('إجمالي الموردين')).toBeInTheDocument();

    setPermissions(['purchasing.purchase_orders.read']);
    rerender(
      <MemoryRouter initialEntries={['/purchasing/overview']}>
        <Routes>
          <Route path="/purchasing/*" element={<PurchasingModule />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => expect(purchaseOrdersGetAll).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('إجمالي الموردين')).not.toBeInTheDocument();
    expect(suppliersGetAll).toHaveBeenCalledTimes(1);
  });
});
