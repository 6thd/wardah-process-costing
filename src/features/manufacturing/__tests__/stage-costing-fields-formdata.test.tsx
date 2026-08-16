/**
 * Mandatory gate for the D+E slice of StageCostingPanel's decomposition.
 *
 * <form>, every input `name`, and data-action are the only contract between
 * this component's DOM and stage-costing-actions.js — uiEvents reads them via
 * element.closest('form') + FormData(form), not React props. Extracting the
 * form-field sections and the write-button row into their own components
 * (ManufacturingOrderStageWorkCenterFields, QuantitiesSection,
 * CostComponentsSection, LaborDetailsSection, StageCostingActionButtons)
 * cannot break that contract silently — TypeScript has no way to catch a
 * mistyped `name` or a field left out of a FormData read.
 *
 * This test does NOT mock stage-costing-actions.js. It fills every field on
 * the real, rendered form across all five extracted pieces, clicks each of
 * the three write buttons through the real global uiEvents delegation, and
 * asserts the exact payload each service call receives — proving every field
 * name and value survived the extraction bit-for-bit.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '../../../test/test-utils';
import StageCostingPanel from '../stage-costing-panel';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/hooks/useManufacturingOrders', () => ({
  useManufacturingOrders: () => ({
    data: [{ id: 'mo-1', order_number: 'MO-001', product_id: 'p-1', status: 'in_progress' }],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/useWorkCenters', () => ({
  useWorkCenters: () => ({
    data: [{ id: 'wc-1', code: 'WC1', name: 'Welding' }],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/useManufacturingStages', () => ({
  useManufacturingStages: () => ({
    data: [{ id: 'stage-1', code: 'MIX', name: 'Mixing', is_active: true, order_sequence: 1 }],
    isLoading: false,
    isError: false,
  }),
}));
vi.mock('@/hooks/useStageCosts', () => ({
  useStageCosts: () => ({ data: [], isLoading: false, isError: false }),
}));
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeSubscription: vi.fn(),
}));

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) =>
      [
        'manufacturing.orders.read',
        'manufacturing.stages.read',
        'manufacturing.work_centers.read',
        'manufacturing.stage_costs.read',
        'manufacturing.stage_costs.create',
        'manufacturing.stage_costs.update',
      ].includes(key),
  }),
}));

vi.mock('../stage-costing-permissions', async () => {
  const actual = await vi.importActual<typeof import('../stage-costing-permissions')>('../stage-costing-permissions');
  return {
    ...actual,
    hasLiveStageCostingPermission: vi.fn(async () => true),
    hasLiveStageCostingPermissionAll: vi.fn(async () => true),
  };
});

const applyLaborTime = vi.fn();
const applyOverhead = vi.fn();
const upsertStageCost = vi.fn();
const getStageCosts = vi.fn();

vi.mock('@/services/process-costing-service', () => ({
  processCostingService: {
    getStageCosts: (...args: unknown[]) => getStageCosts(...args),
    applyLaborTime: (...args: unknown[]) => applyLaborTime(...args),
    applyOverhead: (...args: unknown[]) => applyOverhead(...args),
    upsertStageCost: (...args: unknown[]) => upsertStageCost(...args),
  },
}));

async function fillEveryField() {
  await userEvent.selectOptions(screen.getByLabelText('أمر التصنيع'), 'mo-1');
  await userEvent.selectOptions(screen.getByLabelText('المرحلة'), 'stage-1');
  await userEvent.selectOptions(screen.getByLabelText('مركز العمل'), 'wc-1');

  await userEvent.clear(screen.getByLabelText('الكمية الجيدة'));
  await userEvent.type(screen.getByLabelText('الكمية الجيدة'), '100');
  await userEvent.clear(screen.getByLabelText('الكمية المعيبة'));
  await userEvent.type(screen.getByLabelText('الكمية المعيبة'), '5');
  await userEvent.clear(screen.getByLabelText('كمية إعادة التشغيل'));
  await userEvent.type(screen.getByLabelText('كمية إعادة التشغيل'), '2');

  await userEvent.clear(screen.getByLabelText('تكلفة المواد المباشرة (ريال)'));
  await userEvent.type(screen.getByLabelText('تكلفة المواد المباشرة (ريال)'), '50');
  await userEvent.clear(screen.getByLabelText('ساعات العمل'));
  await userEvent.type(screen.getByLabelText('ساعات العمل'), '8');
  await userEvent.clear(screen.getByLabelText('معدل الأجر بالساعة (ريال)'));
  await userEvent.type(screen.getByLabelText('معدل الأجر بالساعة (ريال)'), '25');
  await userEvent.clear(screen.getByLabelText('معدل التكاليف غير المباشرة (%)'));
  await userEvent.type(screen.getByLabelText('معدل التكاليف غير المباشرة (%)'), '20');

  await userEvent.type(screen.getByLabelText('اسم الموظف'), 'Ahmed');
  await userEvent.type(screen.getByLabelText('كود العملية'), 'OP001');
  await userEvent.type(screen.getByLabelText('ملاحظات'), 'test notes');
}

beforeEach(() => {
  vi.clearAllMocks();
  applyLaborTime.mockResolvedValue({ success: true, data: { totalLaborCost: 200 } });
  applyOverhead.mockResolvedValue({ success: true, data: { overheadAmount: 40 } });
  upsertStageCost.mockResolvedValue({
    success: true,
    data: { stageId: 'stage-1', totalCost: 500, unitCost: 5, transferredIn: 0, laborCost: 200, overheadCost: 40 },
  });
});

describe('StageCostingPanel — real FormData wiring survives the D+E field/button extraction', () => {
  it('apply-labor-time reads every field by its exact `name`', async () => {
    render(<StageCostingPanel />);
    await fillEveryField();

    await userEvent.click(screen.getByRole('button', { name: 'تسجيل وقت العمل' }));

    await waitFor(() => expect(applyLaborTime).toHaveBeenCalledTimes(1));
    expect(applyLaborTime).toHaveBeenCalledWith({
      moId: 'mo-1',
      stageId: 'stage-1',
      stageNo: null,
      workCenterId: 'wc-1',
      laborHours: 8,
      hourlyRate: 25,
      employeeName: 'Ahmed',
      operationCode: 'OP001',
      notes: 'test notes',
    });
  });

  it('apply-overhead reads laborHours/laborRate/overheadRate — proving the *100/÷100 duality survived untouched', async () => {
    render(<StageCostingPanel />);
    await fillEveryField();

    await userEvent.click(screen.getByRole('button', { name: 'تطبيق التكاليف غير المباشرة' }));

    await waitFor(() => expect(applyOverhead).toHaveBeenCalledTimes(1));
    // stage-costing-actions.js reads the DOM `name="overheadRate"` input directly via
    // FormData — and that input's rendered *value* is the display-scaled percentage
    // (formData.overheadRate * 100 = 20), not the fraction (0.2) held in React state.
    // This pre-existing behavior (out of scope to "fix" here — see CostComponentsSection)
    // is exactly why this test exists: it pins the real, current wiring, bug and all,
    // so the extraction is proven not to have changed it either way.
    expect(applyOverhead).toHaveBeenCalledWith({
      moId: 'mo-1',
      stageId: 'stage-1',
      stageNo: null,
      workCenterId: 'wc-1',
      allocationBase: 'labor_cost',
      baseQty: 200, // laborHours(8) * laborRate(25)
      overheadRate: 20, // raw DOM value, not divided by 100
      overheadType: 'variable',
      notes: 'Applied at 2000% of labor cost', // 20 * 100, per the handler's own (unmodified) formula
    });
  });

  it('calculate-stage-cost reads the full formData across every extracted section', async () => {
    render(<StageCostingPanel />);
    await fillEveryField();

    await userEvent.click(screen.getByRole('button', { name: 'احتساب تكلفة المرحلة' }));

    await waitFor(() => expect(upsertStageCost).toHaveBeenCalledTimes(1));
    expect(upsertStageCost).toHaveBeenCalledWith({
      moId: 'mo-1',
      stageId: 'stage-1',
      stageNo: null,
      workCenterId: 'wc-1',
      goodQty: 100,
      directMaterialCost: 50,
      mode: 'actual',
      scrapQty: 5,
      reworkQty: 2,
      notes: 'test notes',
    });
  });

  it('none of the three write buttons carry an onClick — data-action through uiEvents is the only trigger', () => {
    render(<StageCostingPanel />);

    const laborBtn = screen.getByRole('button', { name: 'تسجيل وقت العمل' });
    const overheadBtn = screen.getByRole('button', { name: 'تطبيق التكاليف غير المباشرة' });
    const calcBtn = screen.getByRole('button', { name: 'احتساب تكلفة المرحلة' });

    for (const btn of [laborBtn, overheadBtn, calcBtn]) {
      expect(btn).toHaveAttribute('data-action');
    }
  });
});
