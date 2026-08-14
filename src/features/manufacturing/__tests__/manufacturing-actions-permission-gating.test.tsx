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

const workCenterUpdateSpy = vi.fn();
const workCenterEqSpy = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      update: (payload: unknown) => {
        workCenterUpdateSpy(table, payload);
        return {
          eq: (column: string, id: string) => {
            workCenterEqSpy(column, id);
            return Promise.resolve({ error: null });
          },
        };
      },
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

  it('revoking create mid-session (form already open) closes the form itself — no submit button survives to click', async () => {
    setPermissions(['manufacturing.orders.read', 'manufacturing.orders.create']);
    const { rerender, queryClient } = renderAt('/manufacturing/orders');

    await userEvent.click(await screen.findByRole('button', { name: /manufacturing.ordersPage.newOrder/ }));
    await screen.findByRole('button', { name: 'manufacturing.ordersPage.form.submit' });

    setPermissions(['manufacturing.orders.read']);
    rerenderAt(rerender, queryClient, '/manufacturing/orders');

    // النموذج كله يُغلَق فور سحب الصلاحية — لا زر إرسال متبقٍ يمكن نقره،
    // بدل الاعتماد فقط على فحص handleCreateOrder عند الإرسال.
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'manufacturing.ordersPage.form.submit' })).not.toBeInTheDocument();
    });
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

  it('hides the active/inactive toggle without the update key, and the update gateway is never called', async () => {
    setPermissions(['manufacturing.work_centers.read']);
    renderAt('/manufacturing/workcenters');

    await waitFor(() => expect(screen.getByText(/WC1/)).toBeInTheDocument());
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(workCenterUpdateSpy).not.toHaveBeenCalled();
  });

  it('an update grant shows the toggle, and clicking it calls the update gateway exactly once with the work-center id and flipped is_active', async () => {
    setPermissions(['manufacturing.work_centers.read', 'manufacturing.work_centers.update']);
    renderAt('/manufacturing/workcenters');

    await waitFor(() => expect(screen.getByText(/WC1/)).toBeInTheDocument());
    const toggle = screen.getByRole('checkbox');
    expect(toggle).toBeChecked(); // wc-1 seeds is_active: true

    await userEvent.click(toggle);

    await waitFor(() => expect(workCenterUpdateSpy).toHaveBeenCalledTimes(1));
    expect(workCenterUpdateSpy).toHaveBeenCalledWith('work_centers', { is_active: false });
    expect(workCenterEqSpy).toHaveBeenCalledWith('id', 'wc-1');
    expect(createWorkCenterMutate).not.toHaveBeenCalled();
  });

  it('a create grant exposes the form, and a real valid submit calls the create gateway with the expected payload', async () => {
    setPermissions(['manufacturing.work_centers.read', 'manufacturing.work_centers.create']);
    renderAt('/manufacturing/workcenters');

    await waitFor(() => expect(screen.getByText(/WC1/)).toBeInTheDocument());

    await userEvent.type(screen.getByLabelText(/manufacturing.workCenters.form.code/), 'WC2');
    await userEvent.type(screen.getByLabelText(/manufacturing.workCenters.form.nameEn/), 'Packaging');

    await userEvent.click(screen.getByRole('button', { name: /manufacturing.workCenters.form.submit/ }));

    await waitFor(() => expect(createWorkCenterMutate).toHaveBeenCalledTimes(1));
    expect(createWorkCenterMutate).toHaveBeenCalledWith({
      org_id: 'org-1',
      code: 'WC2',
      name: 'Packaging',
      name_ar: 'Packaging',
      description: null,
      hourly_rate: 0,
      is_active: true,
    });
    expect(workCenterUpdateSpy).not.toHaveBeenCalled();
  });

  it('revoking create mid-session (form already open, fields already filled) removes the form and the create gateway is never called', async () => {
    setPermissions(['manufacturing.work_centers.read', 'manufacturing.work_centers.create']);
    const { rerender, queryClient } = renderAt('/manufacturing/workcenters');

    await waitFor(() => expect(screen.getByText(/WC1/)).toBeInTheDocument());
    const codeInput = screen.getByLabelText(/manufacturing.workCenters.form.code/);
    await userEvent.type(codeInput, 'WC2');
    await userEvent.type(screen.getByLabelText(/manufacturing.workCenters.form.nameEn/), 'Packaging');

    setPermissions(['manufacturing.work_centers.read']);
    rerenderAt(rerender, queryClient, '/manufacturing/workcenters');

    // canCreateWorkCenter يغلّف بطاقة النموذج كاملة (لا حالة "مفتوح" منفصلة
    // كما في نموذج أوامر التصنيع) — سحب الصلاحية يُسقِط البطاقة بحقولها
    // المعبَّأة معًا، فلا يبقى زر يمكن نقره لإتمام محاولة إنشاء كانت جارية.
    // handleCreate نفسها تبدأ أيضًا بفحص canCreateWorkCenter دفاعًا في العمق.
    expect(screen.queryByRole('button', { name: /manufacturing.workCenters.form.submit/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/manufacturing.workCenters.form.code/)).not.toBeInTheDocument();
    expect(createWorkCenterMutate).not.toHaveBeenCalled();
  });
});
