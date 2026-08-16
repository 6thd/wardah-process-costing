// src/features/purchasing/__tests__/purchasing-permission-gating.test.tsx
//
// PurchasingOverview كان يحمّل ويعرض الموردين وأوامر الشراء معًا بغض النظر عن
// أي مفتاح فعليًا فتح الشاشة عبر anyOf. هذه الاختبارات تثبت أن كل قسم مستقل
// عن الآخر: تحميلًا وعرضًا وروابط.

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

const suppliersGetAll = vi.fn().mockResolvedValue([]);
const suppliersCreate = vi.fn().mockResolvedValue({ id: 'new-supplier' });
const purchaseOrdersGetAll = vi.fn().mockResolvedValue([]);
const newPurchaseOrdersGetAll = vi.fn().mockResolvedValue([]);

vi.mock('@/services/supabase-service', () => ({
  suppliersService: {
    getAll: (...args: unknown[]) => suppliersGetAll(...args),
    create: (...args: unknown[]) => suppliersCreate(...args),
  },
  purchaseOrdersService: { getAll: (...args: unknown[]) => purchaseOrdersGetAll(...args) },
  newPurchaseOrdersService: { getAll: (...args: unknown[]) => newPurchaseOrdersGetAll(...args) },
}));

const getAllGoodsReceipts = vi.fn().mockResolvedValue({ success: true, data: [] });

vi.mock('@/services/purchasing-service', () => ({
  getAllGoodsReceipts: (...args: unknown[]) => getAllGoodsReceipts(...args),
}));

vi.mock('@/hooks/use-uom-engine-enabled', () => ({
  useUomEngineEnabled: () => ({ isEnabled: false }),
}));

// SupplierInvoicesManagement تستعلم عبر supabase.from(...).select(...).order(...)
// مباشرة (لا خدمة مغلَّفة) — الموك الافتراضي في setup.ts لا يدعم .order() بعد
// .select() المُحلَّل مسبقًا، فيُستبدَل هنا بسلسلة قابلة للتسلسل فعليًا.
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => Promise.resolve({ data: [], error: null }),
      }),
    }),
  },
}));

// تُعرِض علامة قابلة للاستعلام مبنية على open= — لإثبات أن open=true لا يُمرَّر
// إلى النموذج بلا صلاحية الإنشاء الدقيقة، لا مجرد افتراض ذلك.
vi.mock('@/components/forms/PurchaseOrderForm', () => ({
  PurchaseOrderForm: ({ open }: { open: boolean }) => (open ? <div data-testid="purchase-order-form-open" /> : null),
}));
vi.mock('@/components/forms/GoodsReceiptForm', () => ({
  GoodsReceiptForm: ({ open }: { open: boolean }) => (open ? <div data-testid="goods-receipt-form-open" /> : null),
}));
vi.mock('@/components/forms/UomGoodsReceiptForm', () => ({
  UomGoodsReceiptForm: ({ open }: { open: boolean }) => (open ? <div data-testid="uom-goods-receipt-form-open" /> : null),
}));
vi.mock('@/components/forms/SupplierInvoiceForm', () => ({
  SupplierInvoiceForm: ({ open }: { open: boolean }) => (open ? <div data-testid="supplier-invoice-form-open" /> : null),
}));
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

function rerenderAt(rerender: (ui: Parameters<typeof render>[0]) => void, path: string) {
  rerender(
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

describe('SuppliersManagement — screen read vs. purchasing.suppliers.create', () => {
  it('hides the add-supplier trigger without the create key', async () => {
    setPermissions(['purchasing.suppliers.read']);
    renderAt('/purchasing/suppliers');

    await waitFor(() => expect(suppliersGetAll).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'common.add' })).not.toBeInTheDocument();
  });

  it('revoking create mid-session (form already open) blocks the actual submit', async () => {
    setPermissions(['purchasing.suppliers.read', 'purchasing.suppliers.create']);
    const { rerender } = renderAt('/purchasing/suppliers');
    await waitFor(() => expect(suppliersGetAll).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'common.add' }));
    expect(screen.getByText('إضافة مورد جديد')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('اسم المورد'), 'Acme Supplies');

    setPermissions(['purchasing.suppliers.read']);
    rerenderAt(rerender, '/purchasing/suppliers');

    const submitButton = screen.getByRole('button', { name: 'common.add' });
    await userEvent.click(submitButton);

    expect(suppliersCreate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('لا تملك صلاحية إضافة موردين');
  });

  it('a user with read + create sees and can use the add form', async () => {
    setPermissions(['purchasing.suppliers.read', 'purchasing.suppliers.create']);
    renderAt('/purchasing/suppliers');
    await waitFor(() => expect(suppliersGetAll).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'common.add' }));
    await userEvent.type(screen.getByPlaceholderText('اسم المورد'), 'Acme Supplies');
    await userEvent.click(screen.getByRole('button', { name: 'common.add' }));

    await waitFor(() => expect(suppliersCreate).toHaveBeenCalled());
  });
});

describe('PurchaseOrdersManagement — screen read vs. purchasing.purchase_orders.create', () => {
  it('hides the add-order trigger without the create key', async () => {
    setPermissions(['purchasing.purchase_orders.read']);
    renderAt('/purchasing/orders');

    await waitFor(() => expect(newPurchaseOrdersGetAll).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '+ إضافة أمر شراء' })).not.toBeInTheDocument();
  });

  it('never passes open=true to PurchaseOrderForm without the create key, even mid-session', async () => {
    setPermissions(['purchasing.purchase_orders.read', 'purchasing.purchase_orders.create']);
    const { rerender } = renderAt('/purchasing/orders');
    await waitFor(() => expect(newPurchaseOrdersGetAll).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة أمر شراء' }));
    expect(screen.getByTestId('purchase-order-form-open')).toBeInTheDocument();

    setPermissions(['purchasing.purchase_orders.read']);
    rerenderAt(rerender, '/purchasing/orders');

    expect(screen.queryByTestId('purchase-order-form-open')).not.toBeInTheDocument();
  });

  it('a purchase_orders.create grant opens the form', async () => {
    setPermissions(['purchasing.purchase_orders.read', 'purchasing.purchase_orders.create']);
    renderAt('/purchasing/orders');
    await waitFor(() => expect(newPurchaseOrdersGetAll).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة أمر شراء' }));
    expect(screen.getByTestId('purchase-order-form-open')).toBeInTheDocument();
  });
});

describe('GoodsReceiptManagement — screen read vs. purchasing.purchase_orders.update (no dedicated create key)', () => {
  it('hides the add-receipt trigger without the update key', async () => {
    setPermissions(['purchasing.purchase_orders.read']);
    renderAt('/purchasing/receipts');

    await waitFor(() => expect(getAllGoodsReceipts).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '+ إضافة استلام' })).not.toBeInTheDocument();
  });

  it('never passes open=true to the receipt form without the update key, even mid-session', async () => {
    setPermissions(['purchasing.purchase_orders.read', 'purchasing.purchase_orders.update']);
    const { rerender } = renderAt('/purchasing/receipts');
    await waitFor(() => expect(getAllGoodsReceipts).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة استلام' }));
    expect(screen.getByTestId('goods-receipt-form-open')).toBeInTheDocument();

    setPermissions(['purchasing.purchase_orders.read']);
    rerenderAt(rerender, '/purchasing/receipts');

    expect(screen.queryByTestId('goods-receipt-form-open')).not.toBeInTheDocument();
  });
});

describe('SupplierInvoicesManagement — screen read vs. purchasing.purchase_invoices.create', () => {
  it('hides the add-invoice trigger without the create key', async () => {
    setPermissions(['purchasing.purchase_invoices.read']);
    renderAt('/purchasing/invoices');

    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '+ إضافة فاتورة مشتريات' })).not.toBeInTheDocument();
  });

  it('never passes open=true to SupplierInvoiceForm without the create key, even mid-session', async () => {
    setPermissions(['purchasing.purchase_invoices.read', 'purchasing.purchase_invoices.create']);
    const { rerender } = renderAt('/purchasing/invoices');

    await userEvent.click(await screen.findByRole('button', { name: '+ إضافة فاتورة مشتريات' }));
    expect(screen.getByTestId('supplier-invoice-form-open')).toBeInTheDocument();

    setPermissions(['purchasing.purchase_invoices.read']);
    rerenderAt(rerender, '/purchasing/invoices');

    expect(screen.queryByTestId('supplier-invoice-form-open')).not.toBeInTheDocument();
  });

  it('a purchase_invoices.create grant opens the form', async () => {
    setPermissions(['purchasing.purchase_invoices.read', 'purchasing.purchase_invoices.create']);
    renderAt('/purchasing/invoices');

    await userEvent.click(await screen.findByRole('button', { name: '+ إضافة فاتورة مشتريات' }));
    expect(screen.getByTestId('supplier-invoice-form-open')).toBeInTheDocument();
  });
});
