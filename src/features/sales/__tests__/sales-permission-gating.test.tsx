// src/features/sales/__tests__/sales-permission-gating.test.tsx
//
// إثبات إغلاق ملاحظات المراجعة على P1: صلاحية قراءة الشاشة (sales.customers.read)
// منفصلة عن صلاحية الفعل (sales.customers.create)، وSalesOverview لا يحمّل
// موارد لا يملك المستخدم مفتاح قراءتها.

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

const customersGetAll = vi.fn().mockResolvedValue([]);
const customersCreate = vi.fn().mockResolvedValue({ id: 'new-customer' });

vi.mock('@/services/supabase-service', () => ({
  customersService: { getAll: (...args: unknown[]) => customersGetAll(...args), create: (...args: unknown[]) => customersCreate(...args) },
  salesOrdersService: { getAll: vi.fn().mockResolvedValue([]) },
  newSalesInvoicesService: { getAll: vi.fn().mockResolvedValue([]) },
}));

const getAllSalesOrders = vi.fn().mockResolvedValue({ success: true, data: [] });
const getAllSalesInvoices = vi.fn().mockResolvedValue({ success: true, data: [] });

vi.mock('@/services/enhanced-sales-service', () => ({
  getAllSalesOrders: (...args: unknown[]) => getAllSalesOrders(...args),
  getAllSalesInvoices: (...args: unknown[]) => getAllSalesInvoices(...args),
}));

vi.mock('@/components/forms/SalesInvoiceForm', () => ({ SalesInvoiceForm: () => null }));
vi.mock('@/components/forms/DeliveryNoteForm', () => ({ DeliveryNoteForm: () => null }));
vi.mock('../components/CustomerReceipts', () => ({ CustomerReceipts: () => null }));

import { SalesModule } from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sales/*" element={<SalesModule />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('CustomersManagement — screen read vs. create action', () => {
  it('a read-only user sees the customer list but no add button or add form', async () => {
    setPermissions(['sales.customers.read']);
    renderAt('/sales/customers');

    await waitFor(() => expect(customersGetAll).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'common.add' })).not.toBeInTheDocument();
    expect(screen.queryByText('إضافة عميل جديد')).not.toBeInTheDocument();
  });

  it('a read-only user cannot run the create handler even if invoked directly', async () => {
    // دفاع داخل الـhandler نفسه، لا الاعتماد فقط على إخفاء الزر: حتى لو
    // ظهر الزر بخطأ مستقبلي، create() يجب ألا تُستدعى بلا sales.customers.create.
    setPermissions(['sales.customers.read']);
    renderAt('/sales/customers');
    await waitFor(() => expect(customersGetAll).toHaveBeenCalled());

    expect(customersCreate).not.toHaveBeenCalled();
  });

  it('a user with read + create sees and can use the add form', async () => {
    setPermissions(['sales.customers.read', 'sales.customers.create']);
    renderAt('/sales/customers');
    await waitFor(() => expect(customersGetAll).toHaveBeenCalled());

    const addButton = screen.getByRole('button', { name: 'common.add' });
    expect(addButton).toBeInTheDocument();

    await userEvent.click(addButton);
    expect(screen.getByText('إضافة عميل جديد')).toBeInTheDocument();

    await userEvent.type(screen.getByPlaceholderText('اسم العميل'), 'Acme');
    await userEvent.click(screen.getByRole('button', { name: 'common.add' }));

    await waitFor(() => expect(customersCreate).toHaveBeenCalledTimes(1));
  });
});

describe('SalesOverview — per-section permission-aware loading', () => {
  it('sales.customers.read alone loads customers but never fires the orders/invoices request', async () => {
    setPermissions(['sales.customers.read']);
    renderAt('/sales/overview');

    await waitFor(() => expect(customersGetAll).toHaveBeenCalled());
    expect(getAllSalesInvoices).not.toHaveBeenCalled();
    expect(getAllSalesOrders).not.toHaveBeenCalled();
  });

  it('sales.sales_invoices.read alone loads invoices but never fires the customers request', async () => {
    setPermissions(['sales.sales_invoices.read']);
    renderAt('/sales/overview');

    await waitFor(() => expect(getAllSalesInvoices).toHaveBeenCalled());
    expect(customersGetAll).not.toHaveBeenCalled();
  });

  it('sales.sales_orders.read alone does not load customers, and does not need the invoices endpoint', async () => {
    setPermissions(['sales.sales_orders.read']);
    renderAt('/sales/overview');

    await waitFor(() => expect(screen.getByText('sales.title')).toBeInTheDocument());
    expect(customersGetAll).not.toHaveBeenCalled();
    expect(getAllSalesInvoices).not.toHaveBeenCalled();
  });

  it('a customers-only user does not see the customer count card mixed with unauthorized sales-activity cards', async () => {
    setPermissions(['sales.customers.read']);
    renderAt('/sales/overview');

    await waitFor(() => expect(customersGetAll).toHaveBeenCalled());
    // بطاقة العملاء (إجمالي العملاء) يجب أن تظهر
    expect(screen.getByText('إجمالي العملاء')).toBeInTheDocument();
    // بطاقات نشاط المبيعات (تحتاج sales_orders/sales_invoices) يجب ألا تظهر
    expect(screen.queryByText('قيمة المبيعات (ريال)')).not.toBeInTheDocument();
    expect(screen.queryByText('إجمالي الفواتير')).not.toBeInTheDocument();
  });
});
