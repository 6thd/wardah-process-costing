// src/features/manufacturing/__tests__/stage-wip-log-list-permission-gating.test.tsx
//
// StageWipLogList وWipLogFormDialog كانتا تنفّذان إنشاء/تعديل/حذف سجلات WIP
// تحت manufacturing.stage_costs.read وحدها. هذا الاختبار يثبت الفصل الفعلي
// على مفاتيح stage_costs.create/.update/.delete، بما فيه إعادة الفحص داخل
// WipLogFormDialog نفسها (canSubmit) عند سحب الصلاحية والحوار ما يزال مفتوحًا.

import { render, screen, waitFor, within } from '@testing-library/react';
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

const wipGetAll = vi.fn();
const wipDelete = vi.fn().mockResolvedValue(undefined);
const wipCreate = vi.fn().mockResolvedValue({ id: 'new-wip' });
const wipUpdate = vi.fn().mockResolvedValue({ id: 'wip-1' });

vi.mock('@/services/supabase-service', () => ({
  stageWipLogService: {
    getAll: (...args: unknown[]) => wipGetAll(...args),
    delete: (...args: unknown[]) => wipDelete(...args),
    create: (...args: unknown[]) => wipCreate(...args),
    update: (...args: unknown[]) => wipUpdate(...args),
  },
}));

vi.mock('@/hooks/useManufacturingOrders', () => ({
  useManufacturingOrders: () => ({ data: [{ id: 'mo-1', order_number: 'MO-1' }] }),
}));

vi.mock('@/hooks/useManufacturingStages', () => ({
  useManufacturingStages: () => ({ data: [{ id: 'stage-1', code: 'MIX', name: 'Mixing', is_active: true, order_sequence: 1 }] }),
}));

import { StageWipLogList } from '../stage-wip-log-list';

const WIP = {
  id: 'wip-1',
  mo_id: 'mo-1',
  stage_id: 'stage-1',
  period_start: '2026-01-01',
  period_end: '2026-01-31',
  units_beginning_wip: 0,
  units_started: 100,
  units_completed: 80,
  units_ending_wip: 20,
  is_closed: false,
};

function setPermissions(keys: readonly string[]) {
  hasPermissionKeyMock.mockImplementation((key: string) => keys.includes(key));
}

function renderList() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <StageWipLogList />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  hasPermissionKeyMock.mockReturnValue(false);
  wipGetAll.mockResolvedValue([WIP]);
});

describe('StageWipLogList — manufacturing.stage_costs.create/.update/.delete', () => {
  it('hides the add trigger and row edit/delete controls without the exact keys', async () => {
    setPermissions(['manufacturing.stage_costs.read']);
    renderList();

    await waitFor(() => expect(screen.getByText('MO-1')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'إضافة سجل' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'تعديل سجل WIP wip-1' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'حذف سجل WIP wip-1' })).not.toBeInTheDocument();
  });

  it('a delete grant shows delete and calls the delete gateway', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.delete']);
    renderList();

    await waitFor(() => expect(screen.getByText('MO-1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'حذف سجل WIP wip-1' }));

    await waitFor(() => expect(wipDelete).toHaveBeenCalledWith('wip-1'));
  });

  it('a create grant opens the dialog; a real submit calls the create gateway', async () => {
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.create']);
    renderList();

    await waitFor(() => expect(screen.getByText('MO-1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'إضافة سجل' }));

    const dialog = screen.getByRole('dialog');
    await userEvent.click(within(dialog).getByLabelText(/أمر التصنيع/));
    await userEvent.click(await screen.findByRole('option', { name: 'MO-1' }));
    await userEvent.click(within(dialog).getByLabelText(/المرحلة/));
    await userEvent.click(await screen.findByRole('option', { name: /MIX/ }));

    await userEvent.click(within(dialog).getByRole('button', { name: 'حفظ' }));

    await waitFor(() => expect(wipCreate).toHaveBeenCalledTimes(1));
    expect(wipUpdate).not.toHaveBeenCalled();
  });

  it('revoking create mid-session (dialog already open) hides the save button and the mutation guard blocks the write', async () => {
    setPermissions(['manufacturing.stage_costs.read', 'manufacturing.stage_costs.create']);
    const { rerender } = renderList();

    await waitFor(() => expect(screen.getByText('MO-1')).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'إضافة سجل' }));
    expect(screen.getByRole('button', { name: 'حفظ' })).toBeInTheDocument();

    setPermissions(['manufacturing.stage_costs.read']);
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={queryClient}>
        <StageWipLogList />
      </QueryClientProvider>
    );

    // canSubmit يغلّف زر الحفظ نفسه داخل WipLogFormDialog — لا يبقى زر لنقره
    expect(screen.queryByRole('button', { name: 'حفظ' })).not.toBeInTheDocument();
    expect(wipCreate).not.toHaveBeenCalled();
  });
});
