// src/features/manufacturing/__tests__/standard-costs-list-permission-gating.test.tsx
//
// StandardCostsList كانت تنفّذ إنشاء/تعديل/حذف منطقي للتكاليف القياسية تحت
// manufacturing.stage_costs.read وحدها. هذا الاختبار يثبت الفصل الفعلي على
// مفاتيح stage_costs.create/.update/.delete.

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

vi.mock('@/services/supabase-service', () => ({
  standardCostsService: {
    getAll: (...args: unknown[]) => costsGetAll(...args),
    create: (...args: unknown[]) => costsCreate(...args),
    update: (...args: unknown[]) => costsUpdate(...args),
  },
}));

vi.mock('@/hooks/useManufacturingStages', () => ({
  useManufacturingStages: () => ({
    data: [{ id: 'stage-1', code: 'MIX', name: 'Mixing', name_ar: 'الخلط', is_active: true, order_sequence: 1 }],
  }),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        order: () => ({
          limit: () => Promise.resolve({
            data: [{ id: 'prod-1', code: 'P1', name: 'Product 1', name_ar: 'منتج 1' }],
            error: null,
          }),
        }),
      }),
    }),
  },
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
  return render(
    <QueryClientProvider client={queryClient}>
      <StandardCostsList />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  costsGetAll.mockResolvedValue([COST]);
});

describe('StandardCostsList — manufacturing.stage_costs.create/.update/.delete', () => {
  it('hides the add trigger and row edit/delete controls without the exact keys', async () => {
    setPermissions(['manufacturing.stage_costs.read']);
    renderList();

    await waitFor(() => expect(screen.getByText(/P1/)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'إضافة تكلفة قياسية' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تعديل تكلفة قياسية cost-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حذف تكلفة قياسية cost-1' })).not.toBeInTheDocument();
  });

  it('a delete grant shows the delete control; confirming calls the update-based soft-delete gateway', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.delete']);
    renderList();

    await waitFor(() => expect(screen.getByText(/P1/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'حذف تكلفة قياسية cost-1' }));

    await waitFor(() => expect(costsUpdate).toHaveBeenCalledWith('cost-1', { is_active: false }));
    expect(costsCreate).not.toHaveBeenCalled();
  });

  it('an update grant shows the edit control; a real submit calls the update gateway', async () => {
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.update']);
    renderList();

    await waitFor(() => expect(screen.getByText(/P1/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'تعديل تكلفة قياسية cost-1' }));

    const submit = await screen.findByRole('button', { name: 'تحديث' });
    await userEvent.click(submit);

    await waitFor(() => expect(costsUpdate).toHaveBeenCalledTimes(1));
    expect(costsUpdate).toHaveBeenCalledWith('cost-1', expect.any(Object));
    expect(costsCreate).not.toHaveBeenCalled();
  });

  it('revoking update mid-session (dialog already open) blocks the actual submit at the handler boundary', async () => {
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.update']);
    const { rerender } = renderList();

    await waitFor(() => expect(screen.getByText(/P1/)).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'تعديل تكلفة قياسية cost-1' }));

    setPermissions(['manufacturing.stage_costs.read']);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
});
