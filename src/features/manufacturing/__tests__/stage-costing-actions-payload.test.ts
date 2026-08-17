/**
 * Smallest safe slice of the calculate-stage-cost Complex Method
 * (stage-costing-actions.js:265-374): buildUpsertStageCostPayload(formData)
 * was moved verbatim out of the handler's try block. It is pure and
 * side-effect-free — no DOM access, no await, no closure over
 * element/form/toast — so it is unit-tested directly against a minimal
 * FormData-shaped fixture (only `.get(key)` is used by the function, and
 * real FormData.get() returns null — not undefined or '' — for a missing
 * key, which this fixture mirrors exactly).
 *
 * Deliberately NOT covered here (out of scope for this slice, per the
 * decision to freeze rather than fix pre-existing quirks): the
 * `if (result.success)` branch, the toast/CustomEvent snake_case vs
 * camelCase discrepancy, the NaN efficiency fallback, and the DOM
 * write-back on stageId/stageNumber inputs. Those stay exactly as they
 * were, still exercised only through the existing permission and FormData
 * integration suites re-run below.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../ui/events.js', () => ({
  default: { registerAction: vi.fn(), unregisterAction: vi.fn() },
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('@/services/process-costing-service', () => ({
  processCostingService: {
    getStageCosts: vi.fn(),
    applyLaborTime: vi.fn(),
    applyOverhead: vi.fn(),
    upsertStageCost: vi.fn(),
  },
}));

function fakeFormData(fields: Record<string, string>) {
  const map = new Map(Object.entries(fields));
  return { get: (key: string) => (map.has(key) ? (map.get(key) as string) : null) };
}

describe('buildUpsertStageCostPayload', () => {
  it('maps every field from a fully-populated FormData snapshot, including the stageNumber fallback branch', async () => {
    const { buildUpsertStageCostPayload } = await import('../stage-costing-actions.js');

    const formData = fakeFormData({
      manufacturingOrderId: 'mo-1',
      stageId: 'stage-1',
      stageNumber: '7',
      workCenterId: 'wc-1',
      goodQuantity: '100',
      directMaterialCost: '50.5',
      scrapQuantity: '5',
      reworkQuantity: '2',
      notes: 'ملاحظة',
    });

    expect(buildUpsertStageCostPayload(formData)).toEqual({
      moId: 'mo-1',
      stageId: 'stage-1',
      stageNo: 7,
      workCenterId: 'wc-1',
      goodQty: 100,
      directMaterialCost: 50.5,
      mode: 'actual',
      scrapQty: 5,
      reworkQty: 2,
      notes: 'ملاحظة',
    });
  });

  it('defaults missing/empty fields to the literal || 0 and stageNo: null fallbacks — not a cleaned-up 0/undefined', async () => {
    const { buildUpsertStageCostPayload } = await import('../stage-costing-actions.js');

    // stageId, stageNumber, directMaterialCost, scrapQuantity, reworkQuantity,
    // notes are all absent — FormData.get() would return null for each, not ''.
    const formData = fakeFormData({
      manufacturingOrderId: 'mo-2',
      workCenterId: 'wc-2',
      goodQuantity: '0',
    });

    expect(buildUpsertStageCostPayload(formData)).toEqual({
      moId: 'mo-2',
      stageId: null,
      stageNo: null,
      workCenterId: 'wc-2',
      goodQty: 0,
      directMaterialCost: 0,
      mode: 'actual',
      scrapQty: 0,
      reworkQty: 0,
      notes: null,
    });
  });
});
