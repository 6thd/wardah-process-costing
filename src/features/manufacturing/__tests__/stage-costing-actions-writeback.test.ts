/**
 * Second (and, per the pre-work agreement, last-without-a-fresh-decision)
 * slice of the calculate-stage-cost Complex Method
 * (stage-costing-actions.js:290-387, confirmed by the GitHub check-run
 * annotation to still be flagged after extracting
 * buildUpsertStageCostPayload alone). writeBackStageIdentifiers(form,
 * stageId, stageNumber) was moved verbatim out of the handler's success
 * branch: it is a pure DOM side effect with no closure over
 * element/toast/permission state.
 *
 * Deliberately not touched or covered here: try/catch/finally, the
 * permission-await/disabled ordering, result.success, the
 * stageCostCalculated event payload, the snake_case/camelCase
 * discrepancy, or the double-click window. Those stay exactly as they
 * were, still exercised only through the existing suites re-run
 * alongside this one.
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

function fakeForm(fields: Partial<Record<'stageId' | 'stageNumber', { value: string }>>) {
  return {
    querySelector: (selector: string) => {
      if (selector === '[name="stageId"]') return fields.stageId ?? null;
      if (selector === '[name="stageNumber"]') return fields.stageNumber ?? null;
      return null;
    },
  };
}

describe('writeBackStageIdentifiers', () => {
  it('writes stageId onto the matching input when present, defaulting to an empty string for a null id', async () => {
    const { writeBackStageIdentifiers } = await import('../stage-costing-actions.js');
    const stageIdInput = { value: 'old' };
    const form = fakeForm({ stageId: stageIdInput });

    writeBackStageIdentifiers(form, 'stage-9', null);
    expect(stageIdInput.value).toBe('stage-9');

    writeBackStageIdentifiers(form, null, null);
    expect(stageIdInput.value).toBe('');
  });

  it('writes stageNumber onto the matching input when present, defaulting to an empty string for a null/falsy number', async () => {
    const { writeBackStageIdentifiers } = await import('../stage-costing-actions.js');
    const stageNumberInput = { value: 'old' };
    const form = fakeForm({ stageNumber: stageNumberInput });

    writeBackStageIdentifiers(form, null, '3');
    expect(stageNumberInput.value).toBe('3');

    writeBackStageIdentifiers(form, null, null);
    expect(stageNumberInput.value).toBe('');
  });

  it('does nothing (no throw) when a matching input is not found in the form', async () => {
    const { writeBackStageIdentifiers } = await import('../stage-costing-actions.js');
    const form = fakeForm({});

    expect(() => writeBackStageIdentifiers(form, 'stage-1', '2')).not.toThrow();
  });
});
