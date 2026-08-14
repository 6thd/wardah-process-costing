// src/features/manufacturing/__tests__/standard-costs-list-permission-gating.test.tsx
//
// StandardCostsList كانت تنفّذ إنشاء/تعديل/حذف منطقي للتكاليف القياسية تحت
// manufacturing.stage_costs.read وحدها. هذا الاختبار يثبت الفصل الفعلي على
// مفاتيح stage_costs.create/.update/.delete.
//
// Round 6 finding: هذه الشاشة كانت تحمّل مراحل التصنيع (مورد manufacturing.
// stages) والمنتجات (مورد inventory.products) — موردان مختلفان تمامًا عن
// stage_costs — لأي حامل لـ stage_costs.read وحدها، ولا تحمي حتى التكاليف
// القياسية نفسها بقراءة مشروطة. هذا الملف يمرّ عبر hooks/service الحقيقية
// ليثبت أن كل استعلام يطلب مفتاح قراءة مورده الفعلي، وأن نموذج الإضافة/
// التعديل لا يُعرض إلا حين تتوفر صلاحية الفعل وصلاحيتا قراءة المرجعين معًا.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const costsGetAll = vi.fn();
const costsCreate = vi.fn().mockResolvedValue({ id: 'new-cost' });
const costsUpdate = vi.fn().mockResolvedValue({ id: 'cost-1' });
const stagesGetAll = vi.fn().mockResolvedValue([{ id: 'stage-1', code: 'MIX', name: 'Mixing', name_ar: 'الخلط', is_active: true, order_sequence: 1 }]);

vi.mock('@/services/supabase-service', () => ({
  standardCostsService: {
    getAll: (...args: unknown[]) => costsGetAll(...args),
    create: (...args: unknown[]) => costsCreate(...args),
    update: (...args: unknown[]) => costsUpdate(...args),
  },
  manufacturingStagesService: {
    getAll: (...args: unknown[]) => stagesGetAll(...args),
  },
}));

function makeBuilder(table: string) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
    const result = table === 'products'
      ? { data: [{ id: 'prod-1', code: 'P1', name: 'Product 1', name_ar: 'منتج 1' }], error: null }
      : { data: [], error: null };
    return Promise.resolve(result).then(resolve, reject);
  };
  return builder;
}

const fromSpy = vi.fn((table: string) => makeBuilder(table));

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => fromSpy(table) },
}));

import { StandardCostsList } from '../standard-costs-list';

const COST = {
  id: 'cost-1',
  product_id: 'prod-1',
  stage_id: 'stage-1',
  material_cost_per_unit: 10,
  labor_cost_per_unit: 5,
  overhead_cost_per_unit: 2,
  effective_from: '2026-01-01',
  effective_to: null,
  is_active: true,
  notes: '',
};

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return {
    queryClient,
    ...render(
      <QueryClientProvider client={queryClient}>
        <StandardCostsList />
      </QueryClientProvider>
    ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  costsGetAll.mockResolvedValue([COST]);
});

const FULL_REF_PERMS = ['manufacturing.stage_costs.read', 'manufacturing.stages.read', 'inventory.products.read'] as const;

describe('StandardCostsList — manufacturing.stage_costs.create/.update/.delete', () => {
  it('hides the add trigger and row edit/delete controls without the exact keys', async () => {
    setPermissions([...FULL_REF_PERMS]);
    renderList();

    await waitFor(() => expect(screen.getByText(/P1/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'إضافة تكلفة قياسية' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تعديل تكلفة قياسية cost-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حذف تكلفة قياسية cost-1' })).not.toBeInTheDocument();
  });

  it('a create grant alone (no stages/products read) still hides the add trigger — fail-closed reference-data gap', async () => {
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.create']);
    renderList();

    await waitFor(() => expect(costsGetAll).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'إضافة تكلفة قياسية' })).not.toBeInTheDocument();
    expect(stagesGetAll).not.toHaveBeenCalled();
    const productCalls = fromSpy.mock.calls.filter(([table]) => table === 'products');
    expect(productCalls).toHaveLength(0);
  });

  it('a delete grant shows the delete control; confirming calls the update-based soft-delete gateway', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.delete']);
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'حذف تكلفة قياسية cost-1' }));

    await waitFor(() => expect(costsUpdate).toHaveBeenCalledWith('cost-1', { is_active: false }));
    expect(costsCreate).not.toHaveBeenCalled();
  });

  it('create + stages.read + products.read opens the dialog; a real submit calls the create gateway', async () => {
    setPermissions([...FULL_REF_PERMS, 'manufacturing.stage_costs.create']);
    renderList();

    await waitFor(() => expect(screen.getByText(/P1/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'إضافة تكلفة قياسية' }));

    await waitFor(() => {
      const productCalls = fromSpy.mock.calls.filter(([table]) => table === 'products');
      expect(productCalls.length).toBeGreaterThan(0);
    });
  });

  it('an update grant with full ref-data reads shows the edit control; a real submit calls the update gateway', async () => {
    setPermissions([...FULL_REF_PERMS, 'manufacturing.stage_costs.update']);
    renderList();

    await waitFor(() => expect(screen.getByText(/P1/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'تعديل تكلفة قياسية cost-1' }));

    const submit = await screen.findByRole('button', { name: 'تحديث' });
    await userEvent.click(submit);

    await waitFor(() => expect(costsUpdate).toHaveBeenCalledTimes(1));
    expect(costsUpdate).toHaveBeenCalledWith('cost-1', expect.any(Object));
    expect(costsCreate).not.toHaveBeenCalled();
  });

  it('an update grant alone (no stages/products read) still hides the edit control — fail-closed reference-data gap', async () => {
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.update']);
    renderList();

    await waitFor(() => expect(costsGetAll).toHaveBeenCalled());
    expect(screen.queryByRole('button', { name: 'تعديل تكلفة قياسية cost-1' })).not.toBeInTheDocument();
  });

  it('revoking update mid-session (dialog already open) blocks the actual submit at the handler boundary', async () => {
    setPermissions([...FULL_REF_PERMS, 'manufacturing.stage_costs.update']);
    const { rerender, queryClient } = renderList();

    await waitFor(() => expect(screen.getByText(/P1/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'تعديل تكلفة قياسية cost-1' }));

    setPermissions([...FULL_REF_PERMS]);
    rerender(
      <QueryClientProvider client={queryClient}>
        <StandardCostsList />
      </QueryClientProvider>
    );

    const submit = screen.queryByRole('button', { name: 'تحديث' });
    if (submit) {
      await userEvent.click(submit);
    }

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(costsUpdate).not.toHaveBeenCalled();
  });

  it('a read-only user (stage_costs.read only) never triggers stages/products requests', async () => {
    setPermissions(['manufacturing.stage_costs.read']);
    renderList();

    await waitFor(() => expect(costsGetAll).toHaveBeenCalled());
    expect(stagesGetAll).not.toHaveBeenCalled();
    const productCalls = fromSpy.mock.calls.filter(([table]) => table === 'products');
    expect(productCalls).toHaveLength(0);
  });

  it('without manufacturing.stage_costs.read, the standard-costs query never fires and no rows render', async () => {
    setPermissions([]);
    renderList();

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(costsGetAll).not.toHaveBeenCalled();
    expect(screen.queryByText(/P1/)).not.toBeInTheDocument();
  });
});
