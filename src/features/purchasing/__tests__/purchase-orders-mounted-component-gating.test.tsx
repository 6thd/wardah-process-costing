// src/features/purchasing/__tests__/purchase-orders-mounted-component-gating.test.tsx
//
// The router mounts PurchasingModuleHotfix at /purchasing/*, and for the
// exact path /purchasing/orders it renders its own PurchaseOrdersDetailsManagement
// instead of delegating to the properly-gated PurchasingModule (index.tsx).
// That bypass component — and PurchaseOrderDetailsDialog's submit/approve
// actions, which state alone ("draft"/"submitted") used to gate — had ZERO
// permission checks. This file renders through the REAL ModuleGuard and the
// REAL mounted component (PurchasingModuleHotfix), not the unused
// PurchasingModule, to prove the fix reaches the component the router
// actually serves.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const usePermissionsMock = vi.fn();
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => usePermissionsMock(),
}));

function mockPermissions(permissionKeys: readonly string[]) {
  usePermissionsMock.mockReturnValue({
    hasPermission: vi.fn(() => false),
    hasPermissionKey: (key: string) => permissionKeys.includes(key),
    isOrgAdmin: false,
    isSuperAdmin: false,
    loading: false,
  });
}

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ar' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ currentOrgId: 'org-1', user: { id: 'user-1' }, isAuthenticated: true }),
}));

const ORDER = {
  id: 'po-1',
  order_number: 'PO-001',
  order_date: '2026-01-01',
  status: 'draft',
  total_amount: 500,
  vendor: { name: 'Acme Supplies' },
  purchase_order_lines: [],
};

const newPurchaseOrdersGetAll = vi.fn().mockResolvedValue([ORDER]);
const purchaseOrdersGetAll = vi.fn().mockResolvedValue([ORDER]);
vi.mock('@/services/supabase-service', () => ({
  newPurchaseOrdersService: { getAll: (...args: unknown[]) => newPurchaseOrdersGetAll(...args) },
  purchaseOrdersService: { getAll: (...args: unknown[]) => purchaseOrdersGetAll(...args) },
}));

const submitPurchaseOrderMock = vi.fn().mockResolvedValue(undefined);
const approvePurchaseOrderMock = vi.fn().mockResolvedValue(undefined);
vi.mock('@/services/purchasing-service', () => ({
  submitPurchaseOrder: (...args: unknown[]) => submitPurchaseOrderMock(...args),
  approvePurchaseOrder: (...args: unknown[]) => approvePurchaseOrderMock(...args),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { ...ORDER, purchase_order_lines: [] }, error: null }),
        }),
      }),
    }),
  },
}));

vi.mock('@/components/forms/PurchaseOrderForm', () => ({
  PurchaseOrderForm: ({ open }: { open: boolean }) =>
    open ? <div data-testid="po-create-form">create-form-open</div> : null,
}));

import { PurchasingModuleHotfix } from '../PurchasingModuleHotfix';

function renderThroughRealRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/purchasing/*" element={<PurchasingModuleHotfix />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPermissions([]);
});

describe('PurchasingModuleHotfix at /purchasing/orders — confirms the mounted component, not PurchasingModule', () => {
  it('is PurchaseOrdersDetailsManagement (not the index.tsx PurchasingModule) that renders at this exact path', async () => {
    mockPermissions(['purchasing.purchase_orders.read']);
    renderThroughRealRoute('/purchasing/orders');

    // PurchaseOrdersDetailsManagement's distinctive detail-dialog trigger label
    await waitFor(() => expect(screen.getByText('PO-001')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /عرض تفاصيل أمر الشراء PO-001/ })).toBeInTheDocument();
  });

  it('without purchasing.purchase_orders.read, the order list query never fires', async () => {
    mockPermissions([]);
    renderThroughRealRoute('/purchasing/orders');

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(newPurchaseOrdersGetAll).not.toHaveBeenCalled();
    expect(purchaseOrdersGetAll).not.toHaveBeenCalled();
  });

  it('hides the create trigger and never opens the create form without purchasing.purchase_orders.create', async () => {
    mockPermissions(['purchasing.purchase_orders.read']);
    renderThroughRealRoute('/purchasing/orders');

    await waitFor(() => expect(screen.getByText('PO-001')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: '+ إضافة أمر شراء' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('po-create-form')).not.toBeInTheDocument();
  });

  it('a create grant shows the trigger and opens the create form', async () => {
    mockPermissions(['purchasing.purchase_orders.read', 'purchasing.purchase_orders.create']);
    renderThroughRealRoute('/purchasing/orders');

    await waitFor(() => expect(screen.getByText('PO-001')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: '+ إضافة أمر شراء' }));

    expect(screen.getByTestId('po-create-form')).toBeInTheDocument();
  });
});

describe('PurchaseOrderDetailsDialog (rendered inside the real mounted component) — submit/approve require exact keys, not just order status', () => {
  async function openDetailsDialog() {
    await userEvent.click(await screen.findByRole('button', { name: /عرض تفاصيل أمر الشراء PO-001/ }));
    await screen.findByText('عرض محفوظ لبيانات أمر الشراء ووحدات القياس وقت الإنشاء.');
  }

  it('a read-only user sees a draft order but no submit/approve buttons', async () => {
    mockPermissions(['purchasing.purchase_orders.read']);
    renderThroughRealRoute('/purchasing/orders');
    await openDetailsDialog();

    expect(screen.queryByRole('button', { name: /إرسال للاعتماد/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /اعتماد الأمر/ })).not.toBeInTheDocument();
  });

  it('purchasing.purchase_orders.update grants submit but not approve on a draft order', async () => {
    mockPermissions(['purchasing.purchase_orders.read', 'purchasing.purchase_orders.update']);
    renderThroughRealRoute('/purchasing/orders');
    await openDetailsDialog();

    expect(screen.getByRole('button', { name: /إرسال للاعتماد/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /اعتماد الأمر/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /إرسال للاعتماد/ }));
    await waitFor(() => expect(submitPurchaseOrderMock).toHaveBeenCalledWith('org-1', 'po-1'));
    expect(approvePurchaseOrderMock).not.toHaveBeenCalled();
  });

  it('purchasing.purchase_orders.approve grants approve on a draft order and calls the approve gateway', async () => {
    mockPermissions(['purchasing.purchase_orders.read', 'purchasing.purchase_orders.approve']);
    renderThroughRealRoute('/purchasing/orders');
    await openDetailsDialog();

    expect(screen.queryByRole('button', { name: /إرسال للاعتماد/ })).not.toBeInTheDocument();
    const approveBtn = screen.getByRole('button', { name: /اعتماد الأمر/ });
    await userEvent.click(approveBtn);

    await waitFor(() => expect(approvePurchaseOrderMock).toHaveBeenCalledWith('org-1', 'po-1'));
    expect(submitPurchaseOrderMock).not.toHaveBeenCalled();
  });

  it('revoking approve mid-session (dialog already open) hides the button and the handler recheck blocks the call', async () => {
    mockPermissions(['purchasing.purchase_orders.read', 'purchasing.purchase_orders.approve']);
    const { rerender } = renderThroughRealRoute('/purchasing/orders');
    await openDetailsDialog();
    expect(screen.getByRole('button', { name: /اعتماد الأمر/ })).toBeInTheDocument();

    mockPermissions(['purchasing.purchase_orders.read']);
    rerender(
      <MemoryRouter initialEntries={['/purchasing/orders']}>
        <Routes>
          <Route path="/purchasing/*" element={<PurchasingModuleHotfix />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.queryByRole('button', { name: /اعتماد الأمر/ })).not.toBeInTheDocument();
    expect(approvePurchaseOrderMock).not.toHaveBeenCalled();
  });
});
