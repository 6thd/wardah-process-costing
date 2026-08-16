// src/features/manufacturing/__tests__/stage-wip-log-row.test.tsx
//
// CodeFactor flagged the per-row render closure inside StageWipLogList
// (wipLogs.map(...), previously L328-419) as a Complex Method. This file
// covers the two extractions taken to address it — the pure
// toWipLogFormValues() mapper and the WipLogTableRow presentational
// component — with focus on the four points most likely to break silently
// during extraction: the asymmetric 100/50 completion-percentage defaults,
// the "Invalid Date" rendering when a period is missing, the mutation-wide
// (not per-row) deleteMutation.isPending disabling every delete button at
// once, and that the edit button actually populates WipLogFormDialog with
// the mapped values, not just that a dialog opens.

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const hasPermissionKeyMock = vi.fn((_key: string) => false);
vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermissionKey: (key: string) => hasPermissionKeyMock(key) }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const wipGetAll = vi.fn();
const wipDelete = vi.fn();
const wipCreate = vi.fn().mockResolvedValue({ id: 'new-wip' });
const wipUpdate = vi.fn().mockResolvedValue({ id: 'wip-1' });
const manufacturingGetAll = vi.fn().mockResolvedValue([{ id: 'mo-1', order_number: 'MO-1' }]);
const stagesGetAll = vi.fn().mockResolvedValue([
  { id: 'stage-1', code: 'MIX', name: 'Mixing', is_active: true, order_sequence: 1 },
]);

vi.mock('@/services/supabase-service', () => ({
  stageWipLogService: {
    getAll: (...args: unknown[]) => wipGetAll(...args),
    delete: (...args: unknown[]) => wipDelete(...args),
    create: (...args: unknown[]) => wipCreate(...args),
    update: (...args: unknown[]) => wipUpdate(...args),
  },
  manufacturingService: {
    getAll: (...args: unknown[]) => manufacturingGetAll(...args),
  },
  manufacturingStagesService: {
    getAll: (...args: unknown[]) => stagesGetAll(...args),
  },
}));

import { StageWipLogList, toWipLogFormValues, type WipLog } from '../stage-wip-log-list';

const FULL_PERMISSIONS = [
  'manufacturing.stage_costs.read',
  'manufacturing.stage_costs.create',
  'manufacturing.stage_costs.update',
  'manufacturing.stage_costs.delete',
  'manufacturing.orders.read',
  'manufacturing.stages.read',
];

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
  wipDelete.mockResolvedValue(undefined);
});

describe('toWipLogFormValues — pure field mapping used by the edit action', () => {
  it('maps every field from a fully-populated log, truncating datetime periods to their date part', () => {
    const log: WipLog = {
      id: 'wip-1',
      mo_id: 'mo-1',
      stage_id: 'stage-1',
      period_start: '2026-02-01T00:00:00.000Z',
      period_end: '2026-02-28T00:00:00.000Z',
      units_beginning_wip: 10,
      units_started: 200,
      units_completed: 180,
      units_ending_wip: 30,
      material_completion_pct: 60,
      conversion_completion_pct: 40,
      cost_beginning_wip: 500,
      cost_material: 1000,
      cost_labor: 300,
      cost_overhead: 150,
      notes: 'ملاحظة',
    };

    expect(toWipLogFormValues(log)).toEqual({
      id: 'wip-1',
      mo_id: 'mo-1',
      stage_id: 'stage-1',
      period_start: '2026-02-01',
      period_end: '2026-02-28',
      units_beginning_wip: 10,
      units_started: 200,
      units_completed: 180,
      units_ending_wip: 30,
      material_completion_pct: 60,
      conversion_completion_pct: 40,
      cost_beginning_wip: 500,
      cost_material: 1000,
      cost_labor: 300,
      cost_overhead: 150,
      notes: 'ملاحظة',
    });
  });

  it('defaults missing optional fields — including the asymmetric 100/50 completion percentages', () => {
    expect(toWipLogFormValues({ id: 'wip-2' })).toEqual({
      id: 'wip-2',
      mo_id: '',
      stage_id: '',
      period_start: '',
      period_end: '',
      units_beginning_wip: 0,
      units_started: 0,
      units_completed: 0,
      units_ending_wip: 0,
      material_completion_pct: 100,
      conversion_completion_pct: 50,
      cost_beginning_wip: 0,
      cost_material: 0,
      cost_labor: 0,
      cost_overhead: 0,
      notes: '',
    });
  });
});

describe('WipLogTableRow — rendered inside StageWipLogList', () => {
  it('renders every cell for a fully-populated row', async () => {
    const log = {
      id: 'wip-full',
      mo_id: 'mo-1',
      stage_id: 'stage-1',
      period_start: '2026-02-01T00:00:00.000Z',
      period_end: '2026-02-28T00:00:00.000Z',
      units_beginning_wip: 10,
      units_started: 200,
      units_completed: 180,
      units_ending_wip: 30,
      cost_material: 1000,
      cost_labor: 300,
      cost_overhead: 150,
      cost_total: 1950,
      equivalent_units_material: 198,
      equivalent_units_conversion: 192,
      is_closed: false,
    };
    wipGetAll.mockResolvedValue([log]);
    setPermissions(FULL_PERMISSIONS);
    renderList();

    await waitFor(() => expect(screen.getByText('MO-1')).toBeInTheDocument());

    const expectedPeriod =
      `${new Date(log.period_start).toLocaleDateString('en-US')} - ` +
      `${new Date(log.period_end).toLocaleDateString('en-US')}`;
    expect(screen.getByText(expectedPeriod)).toBeInTheDocument();

    expect(screen.getByText('MIX - Mixing')).toBeInTheDocument();
    expect(screen.getByText('بداية: 10')).toBeInTheDocument();
    expect(screen.getByText('بدأ: 200')).toBeInTheDocument();
    expect(screen.getByText('مكتمل: 180')).toBeInTheDocument();
    expect(screen.getByText('نهاية: 30')).toBeInTheDocument();
    expect(screen.getByText('مواد: 1000.00')).toBeInTheDocument();
    expect(screen.getByText('عمل: 300.00')).toBeInTheDocument();
    expect(screen.getByText('مصروفات: 150.00')).toBeInTheDocument();
    expect(screen.getByText('إجمالي: 1950.00')).toBeInTheDocument();
    expect(screen.getByText('مواد: 198.00')).toBeInTheDocument();
    expect(screen.getByText('تحويل: 192.00')).toBeInTheDocument();
    expect(screen.getByText('مسودة')).toBeInTheDocument();
  });

  it('falls back to N/A and a truncated id when the stage or order lookup misses', async () => {
    wipGetAll.mockResolvedValue([{ id: 'wip-orphan', mo_id: 'missing-mo', stage_id: 'missing-stage', is_closed: false }]);
    setPermissions(FULL_PERMISSIONS);
    renderList();

    await waitFor(() => expect(screen.getByText('missing-')).toBeInTheDocument());
    expect(screen.getByText('N/A - N/A')).toBeInTheDocument();
  });

  it('renders the literal "Invalid Date" text when a log carries no period — frozen edge case, not a bug to silently fix', async () => {
    wipGetAll.mockResolvedValue([{ id: 'wip-no-period', mo_id: 'mo-1', stage_id: 'stage-1', is_closed: false }]);
    setPermissions(FULL_PERMISSIONS);
    renderList();

    await waitFor(() => expect(screen.getByText('MO-1')).toBeInTheDocument());
    expect(screen.getByText('Invalid Date - Invalid Date')).toBeInTheDocument();
  });

  it('shared deleteMutation.isPending disables every row\'s delete button, not just the row being deleted', async () => {
    let resolveDelete!: () => void;
    wipDelete.mockImplementation(
      () => new Promise<void>((resolve) => { resolveDelete = resolve; })
    );
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    wipGetAll.mockResolvedValue([
      { id: 'wip-a', mo_id: 'mo-1', stage_id: 'stage-1', is_closed: false },
      { id: 'wip-b', mo_id: 'mo-1', stage_id: 'stage-1', is_closed: false },
    ]);
    setPermissions(FULL_PERMISSIONS);
    renderList();

    const deleteA = await screen.findByRole('button', { name: 'حذف سجل WIP wip-a' });
    const deleteB = await screen.findByRole('button', { name: 'حذف سجل WIP wip-b' });
    expect(deleteA).not.toBeDisabled();
    expect(deleteB).not.toBeDisabled();

    await userEvent.click(deleteA);

    await waitFor(() => expect(deleteA).toBeDisabled());
    expect(deleteB).toBeDisabled();

    resolveDelete();
    await waitFor(() => expect(deleteA).not.toBeDisabled());
    expect(deleteB).not.toBeDisabled();
  });

  it('clicking edit actually populates WipLogFormDialog with the mapped log values, not just opens it', async () => {
    wipGetAll.mockResolvedValue([{
      id: 'wip-edit',
      mo_id: 'mo-1',
      stage_id: 'stage-1',
      period_start: '2026-03-05',
      period_end: '2026-03-10',
      units_beginning_wip: 5,
      units_started: 40,
      units_completed: 35,
      units_ending_wip: 10,
      material_completion_pct: 70,
      conversion_completion_pct: 20,
      cost_beginning_wip: 12,
      cost_material: 34,
      cost_labor: 56,
      cost_overhead: 78,
      notes: 'ملاحظة تعديل',
      is_closed: false,
    }]);
    setPermissions(FULL_PERMISSIONS);
    renderList();

    await userEvent.click(await screen.findByRole('button', { name: 'تعديل سجل WIP wip-edit' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('تعديل سجل WIP');
    expect(screen.getByLabelText('بداية الفترة *')).toHaveValue('2026-03-05');
    expect(screen.getByLabelText('نهاية الفترة *')).toHaveValue('2026-03-10');
    expect(screen.getByLabelText('وحدات بداية WIP')).toHaveValue(5);
    expect(screen.getByLabelText('وحدات بدأت')).toHaveValue(40);
    expect(screen.getByLabelText('وحدات مكتملة')).toHaveValue(35);
    expect(screen.getByLabelText('وحدات نهاية WIP')).toHaveValue(10);
    expect(screen.getByLabelText('نسبة إكمال المواد %')).toHaveValue(70);
    expect(screen.getByLabelText('نسبة إكمال التحويل %')).toHaveValue(20);
    expect(screen.getByLabelText('تكلفة بداية WIP')).toHaveValue(12);
    expect(screen.getByLabelText('تكلفة المواد')).toHaveValue(34);
    expect(screen.getByLabelText('تكلفة العمل')).toHaveValue(56);
    expect(screen.getByLabelText('الأوفرهيد')).toHaveValue(78);
    expect(screen.getByLabelText('ملاحظات')).toHaveValue('ملاحظة تعديل');
  });

  it('an is_closed row disables edit while a delete grant still allows delete', async () => {
    wipGetAll.mockResolvedValue([{ id: 'wip-closed', mo_id: 'mo-1', stage_id: 'stage-1', is_closed: true }]);
    setPermissions(FULL_PERMISSIONS);
    renderList();

    expect(await screen.findByRole('button', { name: 'تعديل سجل WIP wip-closed' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'حذف سجل WIP wip-closed' })).not.toBeDisabled();
    expect(screen.getByText('مقفل')).toBeInTheDocument();
  });
});
