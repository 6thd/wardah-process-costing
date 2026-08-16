// src/features/sales/__tests__/sales-permission-gating.test.tsx
//
// إثبات إغلاق ملاحظات المراجعة على P1: صلاحية قراءة الشاشة (sales.customers.read)
// منفصلة عن صلاحية الفعل (sales.customers.create)، وSalesOverview لا يحمّل
// موارد لا يملك المستخدم مفتاح قراءتها.

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

const customersGetAll = vi.fn().mockResolvedValue([]);
const customersCreate = vi.fn().mockResolvedValue({ id: 'new-customer' });
const salesOrdersGetAll = vi.fn().mockResolvedValue([]);

vi.mock('@/services/supabase-service', () => ({
  customersService: { getAll: (...args: unknown[]) => customersGetAll(...args), create: (...args: unknown[]) => customersCreate(...args) },
  salesOrdersService: { getAll: (...args: unknown[]) => salesOrdersGetAll(...args) },
  newSalesInvoicesService: { getAll: vi.fn().mockResolvedValue([]) },
}));

const getAllSalesOrders = vi.fn().mockResolvedValue({ success: true, data: [] });
const getAllSalesInvoices = vi.fn().mockResolvedValue({ success: true, data: [] });

vi.mock('@/services/enhanced-sales-service', () => ({
  getAllSalesOrders: (...args: unknown[]) => getAllSalesOrders(...args),
  getAllSalesInvoices: (...args: unknown[]) => getAllSalesInvoices(...args),
}));

// تُعرِض علامة قابلة للاستعلام مبنية على open= — لإثبات أن open=true لا
// يُمرَّر إلى النموذج بلا صلاحية الإنشاء الدقيقة، لا مجرد افتراض ذلك.
vi.mock('@/components/forms/SalesInvoiceForm', () => ({
  SalesInvoiceForm: ({ open }: { open: boolean }) => (open ? <div data-testid="sales-invoice-form-open" /> : null),
}));
vi.mock('@/components/forms/DeliveryNoteForm', () => ({
  DeliveryNoteForm: ({ open }: { open: boolean }) => (open ? <div data-testid="delivery-note-form-open" /> : null),
}));
vi.mock('../components/CustomerReceipts', () => ({ CustomerReceipts: () => null }));

import { SalesModule } from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/sales/*" element={<SalesModule />} />
      </Routes>
    </MemoryRouter>
  );
}

/** يعيد نفس الشجرة — لإجبار usePermissions() الممسوخ على القراءة من جديد
 * دون unmount/remount حقيقي (rerender فقط، لا render جديد). */
function rerenderAt(rerender: (ui: Parameters<typeof render>[0]) => void, path: string) {
  rerender(
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

  it('revoking create mid-session (same mount, form already open) blocks the actual submit', async () => {
    // سيناريو حقيقي: المستخدم يملك read+create فيفتح النموذج ويملؤه، ثم
    // تُسحَب create منه (مثال: مسؤول آخر عدّل دوره) قبل أن يضغط حفظ — كل ذلك
    // بلا unmount/remount. زر الفتح يختفي فور فقد المفتاح فلا يُفتَح نموذج
    // جديد، لكن نموذجًا مفتوحًا سلفًا لا يُغلَق قسرًا (لا تُفقَد مسودة
    // المستخدم بلا تفسير) — فـhandleAddCustomer نفسها آخر خط دفاع حقيقي هنا،
    // ويُثبِت هذا الاختبار تنفيذها فعليًا: نقرة حقيقية على "حفظ" بعد سحب
    // الصلاحية، لا مجرد التحقق من عدم استدعاء تلقائي.
    setPermissions(['sales.customers.read', 'sales.customers.create']);
    const { rerender } = renderAt('/sales/customers');
    await waitFor(() => expect(customersGetAll).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: 'common.add' }));
    expect(screen.getByText('إضافة عميل جديد')).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('اسم العميل'), 'Acme');

    setPermissions(['sales.customers.read']);
    rerenderAt(rerender, '/sales/customers');

    // زر فتح نموذج جديد اختفى، لكن النموذج المفتوح سلفًا وزر حفظه ما زالا
    // ظاهرين — هذا الزر الوحيد المتبقي بهذا الاسم الآن هو زر الحفظ الداخلي.
    const submitButton = screen.getByRole('button', { name: 'common.add' });
    await userEvent.click(submitButton);

    expect(customersCreate).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('لم تعد تملك صلاحية إضافة عملاء');
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

describe('SalesOverview — no stale data across a permission switch in the same mount', () => {
  it('orders → invoices: the old orders total disappears and invoices load exactly once', async () => {
    salesOrdersGetAll.mockResolvedValue([{ total_amount: 100, status: 'draft' }]);
    setPermissions(['sales.sales_orders.read']);
    const { rerender } = renderAt('/sales/overview');

    await waitFor(() => expect(salesOrdersGetAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('100.00')).toBeInTheDocument());

    getAllSalesInvoices.mockResolvedValue({ success: true, data: [{ total_amount: 250, status: 'sent' }] });
    setPermissions(['sales.sales_invoices.read']);
    rerenderAt(rerender, '/sales/overview');

    await waitFor(() => expect(getAllSalesInvoices).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('250.00')).toBeInTheDocument());
    // الرقم القديم (100.00) من مصدر orders يجب ألا يبقى ظاهرًا بعد التبديل
    expect(screen.queryByText('100.00')).not.toBeInTheDocument();
    // ولا يُعاد جلب orders مجددًا؛ فقدان مفتاحها يمسح حالتها فقط
    expect(salesOrdersGetAll).toHaveBeenCalledTimes(1);
  });

  it('invoices → orders: the old invoices total disappears and orders load exactly once', async () => {
    getAllSalesInvoices.mockResolvedValue({ success: true, data: [{ total_amount: 250, status: 'sent' }] });
    setPermissions(['sales.sales_invoices.read']);
    const { rerender } = renderAt('/sales/overview');

    await waitFor(() => expect(getAllSalesInvoices).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('250.00')).toBeInTheDocument());

    salesOrdersGetAll.mockResolvedValue([{ total_amount: 100, status: 'draft' }]);
    setPermissions(['sales.sales_orders.read']);
    rerenderAt(rerender, '/sales/overview');

    await waitFor(() => expect(salesOrdersGetAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('100.00')).toBeInTheDocument());
    expect(screen.queryByText('250.00')).not.toBeInTheDocument();
    expect(getAllSalesInvoices).toHaveBeenCalledTimes(1);
  });

  it('customers → orders: the customer card disappears, is not refetched, and orders load fresh', async () => {
    setPermissions(['sales.customers.read']);
    const { rerender } = renderAt('/sales/overview');

    await waitFor(() => expect(customersGetAll).toHaveBeenCalledTimes(1));
    expect(screen.getByText('إجمالي العملاء')).toBeInTheDocument();

    salesOrdersGetAll.mockResolvedValue([{ total_amount: 100, status: 'draft' }]);
    setPermissions(['sales.sales_orders.read']);
    rerenderAt(rerender, '/sales/overview');

    await waitFor(() => expect(salesOrdersGetAll).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('إجمالي العملاء')).not.toBeInTheDocument();
    expect(customersGetAll).toHaveBeenCalledTimes(1);
  });

  it('permission → no permission: losing every key drops all sections and stops further loads', async () => {
    salesOrdersGetAll.mockResolvedValue([{ total_amount: 100, status: 'draft' }]);
    setPermissions(['sales.sales_orders.read']);
    const { rerender } = renderAt('/sales/overview');

    await waitFor(() => expect(salesOrdersGetAll).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('100.00')).toBeInTheDocument());

    setPermissions([]);
    rerenderAt(rerender, '/sales/overview');

    await waitFor(() => expect(screen.queryByText('100.00')).not.toBeInTheDocument());
    expect(screen.queryByText('قيمة المبيعات (ريال)')).not.toBeInTheDocument();
    // لا طلب جديد بلا صلاحية — العدد يبقى عند آخر استدعاء مصرَّح
    expect(salesOrdersGetAll).toHaveBeenCalledTimes(1);
  });
});

describe('SalesInvoicesManagement — screen read vs. sales.sales_invoices.create', () => {
  it('hides the add-invoice trigger without the create key', async () => {
    setPermissions(['sales.sales_invoices.read']);
    renderAt('/sales/invoices');

    await waitFor(() => expect(getAllSalesInvoices).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: '+ إضافة فاتورة مبيعات' })).not.toBeInTheDocument();
  });

  it('never passes open=true to SalesInvoiceForm without the create key, even mid-session', async () => {
    setPermissions(['sales.sales_invoices.read', 'sales.sales_invoices.create']);
    const { rerender } = renderAt('/sales/invoices');
    await waitFor(() => expect(getAllSalesInvoices).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة فاتورة مبيعات' }));
    expect(screen.getByTestId('sales-invoice-form-open')).toBeInTheDocument();

    setPermissions(['sales.sales_invoices.read']);
    rerenderAt(rerender, '/sales/invoices');

    expect(screen.queryByTestId('sales-invoice-form-open')).not.toBeInTheDocument();
  });

  it('a create-only grant (no read) opens the form when reached directly', async () => {
    setPermissions(['sales.sales_invoices.read', 'sales.sales_invoices.create']);
    renderAt('/sales/invoices');
    await waitFor(() => expect(getAllSalesInvoices).toHaveBeenCalled());

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة فاتورة مبيعات' }));
    expect(screen.getByTestId('sales-invoice-form-open')).toBeInTheDocument();
  });
});

describe('DeliveryManagement — screen access vs. sales.delivery_notes.create', () => {
  it('hides the add-delivery trigger without the create key', async () => {
    setPermissions(['sales.delivery_notes.read']);
    renderAt('/sales/delivery');

    expect(screen.queryByRole('button', { name: '+ إضافة مذكرة تسليم' })).not.toBeInTheDocument();
  });

  it('never passes open=true to DeliveryNoteForm without the create key, even mid-session', async () => {
    setPermissions(['sales.delivery_notes.read', 'sales.delivery_notes.create']);
    const { rerender } = renderAt('/sales/delivery');

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة مذكرة تسليم' }));
    expect(screen.getByTestId('delivery-note-form-open')).toBeInTheDocument();

    setPermissions(['sales.delivery_notes.read']);
    rerenderAt(rerender, '/sales/delivery');

    expect(screen.queryByTestId('delivery-note-form-open')).not.toBeInTheDocument();
  });

  it('a delivery_notes.create grant opens the form', async () => {
    setPermissions(['sales.delivery_notes.read', 'sales.delivery_notes.create']);
    renderAt('/sales/delivery');

    await userEvent.click(screen.getByRole('button', { name: '+ إضافة مذكرة تسليم' }));
    expect(screen.getByTestId('delivery-note-form-open')).toBeInTheDocument();
  });
});
