// src/features/manufacturing/__tests__/manufacturing-orders-products-gating.test.tsx
//
// useManufacturingProducts() كانت تُنفَّذ لكل مستخدم يملك manufacturing.orders.read
// فقط — رغم أن قائمة المنتجات بيانات مرجعية لنموذج إنشاء أمر تصنيع حصرًا. هذا
// الاختبار يمرّ عبر الـhook الحقيقي (بلا mock تلقائي التحقق) ويتحقق من طلبات
// Supabase الفعلية بدل استبدال الـhook بمُخرَج ثابت.

import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => hasPermissionKeyMock(key),
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? key, i18n: { language: 'ar' } }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

const manufacturingGetAll = vi.fn().mockResolvedValue([]);
const manufacturingUpdateStatus = vi.fn().mockResolvedValue({ success: true });

vi.mock('@/services/supabase-service', () => ({
  manufacturingService: {
    getAll: (...args: unknown[]) => manufacturingGetAll(...args),
    updateStatus: (...args: unknown[]) => manufacturingUpdateStatus(...args),
  },
}));

const createManufacturingOrder = vi.fn().mockResolvedValue(true);
const getOrderDetails = vi.fn().mockResolvedValue(null);

vi.mock('../services/manufacturingOrderService', () => ({
  createManufacturingOrder: (...args: unknown[]) => createManufacturingOrder(...args),
  getOrderDetails: (...args: unknown[]) => getOrderDetails(...args),
}));

// لا نستبدل useManufacturingProducts — الاختبار يمر عبر الـhook الحقيقي
// ويتحقق من استدعاءات Supabase الفعلية.
const PRODUCTS = [{ id: 'prod-1', name: 'Widget', code: 'W-1', org_id: 'org-1' }];

function makeBuilder(table: string) {
  const result = table === 'products'
    ? { data: PRODUCTS, error: null }
    : { data: [], error: null };
  const builder = Promise.resolve(result) as Promise<typeof result> & Record<string, unknown>;
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  return builder;
}

const fromSpy = vi.fn((table: string) => makeBuilder(table));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => fromSpy(table),
  },
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}));

const createWorkCenterMutate = vi.fn().mockResolvedValue({ id: 'wc-1' });

vi.mock('@/hooks/useWorkCenters', () => ({
  useWorkCenters: () => ({ data: [], isLoading: false }),
  useCreateWorkCenter: () => ({ mutateAsync: (...args: unknown[]) => createWorkCenterMutate(...args) }),
}));

// المسارات الشقيقة الأخرى — مكوّنات فارغة لتفادي تحميل شجرة استيراد ضخمة.
vi.mock('../mes/WorkCenterDashboard', () => ({ WorkCenterDashboard: () => null }));
vi.mock('../routing/RoutingManagement', () => ({ RoutingManagement: () => null }));
vi.mock('../capacity/CapacityDashboard', () => ({ CapacityDashboard: () => null }));
vi.mock('../efficiency/EfficiencyDashboard', () => ({ EfficiencyDashboard: () => null }));
vi.mock('../stage-costing-panel.tsx', () => ({ default: () => null }));
vi.mock('../equivalent-units-dashboard', () => ({ EquivalentUnitsDashboard: () => null }));
vi.mock('../cost-of-production-report', () => ({ CostOfProductionReportView: () => null }));
vi.mock('../variance-alerts', () => ({ VarianceAlerts: () => null }));
vi.mock('../bom', () => ({ BOMManagement: () => null, BOMBuilder: () => null }));
vi.mock('../manufacturing-stages-list', () => ({ ManufacturingStagesList: () => null }));
vi.mock('../stage-wip-log-list', () => ({ StageWipLogList: () => null }));
vi.mock('../standard-costs-list', () => ({ StandardCostsList: () => null }));
vi.mock('../ManufacturingOverview', () => ({ ManufacturingOverview: () => null }));

import { ManufacturingModule } from '../index';

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/manufacturing/*" element={<ManufacturingModule />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { ...utils, queryClient };
}

function rerenderAt(
  rerender: (ui: Parameters<typeof render>[0]) => void,
  queryClient: QueryClient,
  path: string
) {
  rerender(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/manufacturing/*" element={<ManufacturingModule />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
});

describe('ManufacturingOrdersManagement — products reference-data load vs. manufacturing.orders.create', () => {
  it('a read-only user (orders.read only) loads orders but never queries products/items', async () => {
    setPermissions(['manufacturing.orders.read']);
    renderAt('/manufacturing/orders');

    await waitFor(() => expect(manufacturingGetAll).toHaveBeenCalled());

    const productTableCalls = fromSpy.mock.calls.filter(([table]) => table === 'products' || table === 'items');
    expect(productTableCalls).toHaveLength(0);
  });

  it('a user with create permission opens the form and the product list is fetched and shown', async () => {
    setPermissions(['manufacturing.orders.read', 'manufacturing.orders.create']);
    renderAt('/manufacturing/orders');

    await userEvent.click(await screen.findByRole('button', { name: /manufacturing.ordersPage.newOrder/ }));

    await waitFor(() => {
      const productTableCalls = fromSpy.mock.calls.filter(([table]) => table === 'products');
      expect(productTableCalls.length).toBeGreaterThan(0);
    });

    const comboboxes = await screen.findAllByRole('combobox');
    fireEvent.click(comboboxes[0]);
    expect(await screen.findByRole('option', { name: /W-1 - Widget/ })).toBeInTheDocument();
  });

  it('revoking create mid-session while the create form is open closes the form itself, not just its product options', async () => {
    setPermissions(['manufacturing.orders.read', 'manufacturing.orders.create']);
    const { rerender, queryClient } = renderAt('/manufacturing/orders');

    await userEvent.click(await screen.findByRole('button', { name: /manufacturing.ordersPage.newOrder/ }));
    expect(screen.getByText('manufacturing.ordersPage.form.sectionTitle')).toBeInTheDocument();

    setPermissions(['manufacturing.orders.read']);
    rerenderAt(rerender, queryClient, '/manufacturing/orders');

    await waitFor(() => {
      expect(screen.queryByText('manufacturing.ordersPage.form.sectionTitle')).not.toBeInTheDocument();
    });
    // لا زر "إلغاء" متبقٍ أيضًا — الزر نفسه يختفي بلا صلاحية الإنشاء
    expect(screen.queryByRole('button', { name: /manufacturing.ordersPage.newOrder|common.cancel/ })).not.toBeInTheDocument();
  });

  it('revoking create mid-session clears the shown product options (form closes) and issues no new product request', async () => {
    setPermissions(['manufacturing.orders.read', 'manufacturing.orders.create']);
    const { rerender, queryClient } = renderAt('/manufacturing/orders');

    await userEvent.click(await screen.findByRole('button', { name: /manufacturing.ordersPage.newOrder/ }));

    await waitFor(() => {
      const productTableCalls = fromSpy.mock.calls.filter(([table]) => table === 'products');
      expect(productTableCalls.length).toBeGreaterThan(0);
    });
    const productCallsBeforeRevoke = fromSpy.mock.calls.filter(([table]) => table === 'products').length;

    setPermissions(['manufacturing.orders.read']);
    rerenderAt(rerender, queryClient, '/manufacturing/orders');

    // النموذج كله يُغلَق الآن بدل ترك حقول اختيار فارغة مفتوحة (انظر الاختبار
    // السابق) — لا combobox متبقٍ يمكن أن يعرض خيارات منتجات من كاش سابق.
    await waitFor(() => expect(screen.queryAllByRole('combobox')).toHaveLength(0));

    const productCallsAfterRevoke = fromSpy.mock.calls.filter(([table]) => table === 'products').length;
    expect(productCallsAfterRevoke).toBe(productCallsBeforeRevoke);
  });
});
