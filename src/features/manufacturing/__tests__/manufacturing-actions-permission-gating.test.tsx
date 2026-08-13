// src/features/manufacturing/__tests__/manufacturing-actions-permission-gating.test.tsx
//
// إنشاء أمر تصنيع، تغيير حالته، وإنشاء/تعديل مركز عمل كانت متاحة لأي مستخدم
// اجتاز anyOf دخول الموديول — بلا فحص manufacturing.orders.create/.update أو
// manufacturing.work_centers.create/.update. هذه الاختبارات تثبت الفصل الفعلي.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

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

vi.mock('../hooks/useManufacturingProducts', () => ({
  useManufacturingProducts: () => ({ products: [], loading: false }),
}));

const createWorkCenterMutate = vi.fn().mockResolvedValue({ id: 'wc-1' });

vi.mock('@/hooks/useWorkCenters', () => ({
  useWorkCenters: () => ({ data: [{ id: 'wc-1', code: 'WC1', name: 'Assembly', name_ar: 'التجميع', is_active: true, hourly_rate: 10 }], isLoading: false }),
  useCreateWorkCenter: () => ({ mutateAsync: (...args: unknown[]) => createWorkCenterMutate(...args) }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
    }),
  },
  getEffectiveTenantId: () => Promise.resolve('org-1'),
}));

// المسارات الشقيقة الأخرى في ManufacturingModule تُستورَد ثابتًا لكنها لا
// تُركَّب فعليًا إلا إذا طابق مسارها — تُستبدَل هنا بمكوّنات فارغة لتفادي
// تحميل شجرة استيراد ضخمة غير ذات صلة بهذا الاختبار.
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

describe('ManufacturingOrdersManagement — screen read vs. manufacturing.orders.create/.update', () => {
  it('hides the new-order trigger without the create key', async () => {
    setPermissions(['manufacturing.orders.read']);
    renderAt('/manufacturing/orders');

    await waitFor(() => expect(manufacturingGetAll).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: /manufacturing.ordersPage.newOrder/ })).not.toBeInTheDocument();
  });

  it('revoking create mid-session (form already open) blocks the actual submit', async () => {
    setPermissions(['manufacturing.orders.read', 'manufacturing.orders.create']);
    const { rerender, queryClient } = renderAt('/manufacturing/orders');

    await userEvent.click(await screen.findByRole('button', { name: /manufacturing.ordersPage.newOrder/ }));
    const submitButton = await screen.findByRole('button', { name: 'manufacturing.ordersPage.form.submit' });

    setPermissions(['manufacturing.orders.read']);
    rerenderAt(rerender, queryClient, '/manufacturing/orders');

    await userEvent.click(screen.getByRole('button', { name: 'manufacturing.ordersPage.form.submit' }));
    expect(submitButton).toBeInTheDocument();

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(createManufacturingOrder).not.toHaveBeenCalled();
  });

  it('hides the status-change control without manufacturing.orders.update', async () => {
    manufacturingGetAll.mockResolvedValue([{ id: 'order-1', status: 'draft', order_number: 'MO-1', quantity: 5 }]);
    setPermissions(['manufacturing.orders.read']);
    renderAt('/manufacturing/orders');

    await waitFor(() => expect(screen.getByText('MO-1')).toBeInTheDocument());
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('an update grant shows the status-change control', async () => {
    manufacturingGetAll.mockResolvedValue([{ id: 'order-1', status: 'draft', order_number: 'MO-1', quantity: 5 }]);
    setPermissions(['manufacturing.orders.read', 'manufacturing.orders.update']);
    renderAt('/manufacturing/orders');

    await waitFor(() => expect(screen.getByText('MO-1')).toBeInTheDocument());
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });
});

describe('WorkCentersManagement — screen read vs. manufacturing.work_centers.create/.update', () => {
  it('hides the create-work-center form without the create key', async () => {
    setPermissions(['manufacturing.work_centers.read']);
    renderAt('/manufacturing/workcenters');

    await waitFor(() => expect(screen.getByText(/WC1/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /manufacturing.workCenters.form.submit/ })).not.toBeInTheDocument();
  });

  it('hides the active/inactive toggle without the update key', async () => {
    setPermissions(['manufacturing.work_centers.read']);
    renderAt('/manufacturing/workcenters');

    await waitFor(() => expect(screen.getByText(/WC1/)).toBeInTheDocument());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('an update grant shows and allows the active/inactive toggle', async () => {
    setPermissions(['manufacturing.work_centers.read', 'manufacturing.work_centers.update']);
    renderAt('/manufacturing/workcenters');

    await waitFor(() => expect(screen.getByText(/WC1/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('checkbox'));

    await waitFor(() => expect(createWorkCenterMutate).not.toHaveBeenCalled());
  });
});
