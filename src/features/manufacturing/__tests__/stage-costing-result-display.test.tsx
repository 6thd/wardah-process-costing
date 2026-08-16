// src/features/manufacturing/__tests__/stage-costing-result-display.test.tsx
//
// CodeFactor flagged StageCostingPanel's whole function body (previously
// L59-681) as a Complex Method. This first slice (A+B+C) extracts only the
// parts fully outside the <form> and untouched by the global data-action /
// uiEvents wiring: the two status-label IIFEs, the result-display block, and
// the history table. Nothing about <form>, field names, data-action, the
// three useEffects, or the overheadRate*100/÷100 duality is touched here —
// those stay covered by the existing RBAC/calculate-permission/panel test
// files, which are re-run unmodified alongside this one.

import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  moStatusLabel,
  stageCostStatusLabel,
  StageCostResultDisplay,
  StageCostsHistoryTable,
  type StageCostResult,
} from '../stage-costing-panel';
import type { StageCost } from '@/hooks/useStageCosts';

describe('moStatusLabel — MO status badge text', () => {
  it('maps every known status to its Arabic label', () => {
    expect(moStatusLabel('pending')).toBe('في الانتظار');
    expect(moStatusLabel('in_progress')).toBe('قيد التنفيذ');
    expect(moStatusLabel('completed')).toBe('مكتمل');
  });

  it('falls back to the raw value for an unknown status — not a cleaned-up placeholder', () => {
    expect(moStatusLabel('cancelled')).toBe('cancelled');
    expect(moStatusLabel(undefined)).toBeUndefined();
  });
});

describe('stageCostStatusLabel — stage cost row status text', () => {
  it('maps every known status to its Arabic label', () => {
    expect(stageCostStatusLabel('precosted')).toBe('تكلفة مُقدرة');
    expect(stageCostStatusLabel('actual')).toBe('تكلفة فعلية');
    expect(stageCostStatusLabel('completed')).toBe('مكتملة');
  });
});

const RESULT: StageCostResult = {
  stageId: 'stage-1',
  totalCost: 725.5,
  unitCost: 7.255,
  transferredIn: 200,
  laborCost: 150,
  overheadCost: 75,
  efficiency: 97.5,
  calculatedAt: '2026-08-16T10:00:00.000Z',
};

describe('StageCostResultDisplay', () => {
  it('renders every stat, the cost breakdown including the derived direct-materials remainder, and the disabled Post-to-GL control', () => {
    render(<StageCostResultDisplay result={RESULT} />);

    expect(screen.getByText('725.50')).toBeInTheDocument();
    expect(screen.getByText('7.25')).toBeInTheDocument(); // unitCost.toFixed(2) — 7.255 -> "7.25" (float repr.)
    expect(screen.getByText('200.00')).toBeInTheDocument();
    expect(screen.getByText('97.5% كفاءة')).toBeInTheDocument();
    expect(screen.getByText('150.00')).toBeInTheDocument();
    expect(screen.getByText('75.00')).toBeInTheDocument();
    // direct materials = totalCost - transferredIn - laborCost - overheadCost = 725.5-200-150-75 = 300.5
    expect(screen.getByText('300.50')).toBeInTheDocument();

    const postToGl = screen.getByRole('button', { name: /ترحيل للدفتر العام/ });
    expect(postToGl).toBeDisabled();
    expect(postToGl).toHaveAttribute('title', 'ترحيل المرحلة للدفتر العام غير متاح حاليًا');

    expect(screen.getByText(/تم الحساب في:/)).toBeInTheDocument();
  });

  it('uses the default badge variant at or above 95% efficiency and destructive below it', () => {
    const { rerender } = render(<StageCostResultDisplay result={{ ...RESULT, efficiency: 95 }} />);
    expect(screen.getByText('95.0% كفاءة')).toHaveClass('bg-primary');

    rerender(<StageCostResultDisplay result={{ ...RESULT, efficiency: 94.9 }} />);
    expect(screen.getByText('94.9% كفاءة')).toHaveClass('bg-destructive');
  });

  it('carries the raw result on data-result for any external reader relying on it', () => {
    const { container } = render(<StageCostResultDisplay result={RESULT} />);
    const root = container.querySelector('[data-result]');
    expect(root).not.toBeNull();
    expect(JSON.parse(root!.getAttribute('data-result')!)).toEqual(RESULT);
  });
});

function stageCost(overrides: Partial<StageCost> = {}): StageCost {
  return {
    id: 'sc-1',
    org_id: 'org-1',
    manufacturing_order_id: 'mo-1',
    work_center_id: 'wc-1',
    good_quantity: 100,
    defective_quantity: 0,
    material_cost: 10,
    labor_cost: 20,
    overhead_cost: 5,
    total_cost: 35,
    unit_cost: 0.35,
    status: 'completed',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-02T00:00:00.000Z',
    ...overrides,
  };
}

describe('StageCostsHistoryTable', () => {
  it('renders a full row using the Arabic stage name, the work-center name, and every numeric/status cell', () => {
    const stage = stageCost({
      manufacturing_stage: { id: 'stage-1', name: 'Mixing', name_ar: 'الخلط' } as StageCost['manufacturing_stage'],
      work_center: { id: 'wc-1', name: 'Welding Center' } as StageCost['work_center'],
    });
    render(<StageCostsHistoryTable stageCosts={[stage]} />);

    const row = screen.getByText('الخلط').closest('tr')!;
    expect(within(row).getByText('Welding Center')).toBeInTheDocument();
    expect(within(row).getByText('100')).toBeInTheDocument();
    expect(within(row).getByText('35.00 ريال')).toBeInTheDocument();
    expect(within(row).getByText('0.35 ريال')).toBeInTheDocument();
    expect(within(row).getByText('مكتملة')).toBeInTheDocument();
  });

  it('falls back to the stage number, then the stage id, then N/A, and to the raw work_center_id when the relations are missing', () => {
    const byNumber = stageCost({ id: 'a', manufacturing_stage: undefined, stage_number: 3, work_center: undefined });
    const byStageId = stageCost({ id: 'b', manufacturing_stage: undefined, stage_number: undefined, stage_id: 'stage-9', work_center: undefined });
    const bareId = stageCost({ id: 'c', manufacturing_stage: undefined, stage_number: undefined, stage_id: undefined, work_center: undefined });
    render(<StageCostsHistoryTable stageCosts={[byNumber, byStageId, bareId]} />);

    expect(screen.getByText('Stage 3')).toBeInTheDocument();
    expect(screen.getByText('Stage stage-9')).toBeInTheDocument();
    expect(screen.getByText('Stage N/A')).toBeInTheDocument();
    expect(screen.getAllByText('wc-1').length).toBeGreaterThan(0);
  });

  it('uses updated_at over created_at for the date column, falling back to created_at when updated_at is absent', () => {
    const withUpdated = stageCost({ id: 'x', updated_at: '2026-08-10T00:00:00.000Z', created_at: '2026-08-01T00:00:00.000Z' });
    render(<StageCostsHistoryTable stageCosts={[withUpdated]} />);
    expect(screen.getByText(new Date('2026-08-10T00:00:00.000Z').toLocaleDateString('en-US'))).toBeInTheDocument();
  });

  it('uses stage.id as the row key when present, not the array index — precosted/actual rows keep the outline badge variant', () => {
    const precosted = stageCost({ id: 'p-1', status: 'precosted' });
    const actual = stageCost({ id: 'a-1', status: 'actual' });
    render(<StageCostsHistoryTable stageCosts={[precosted, actual]} />);

    expect(screen.getByText('تكلفة مُقدرة')).not.toHaveClass('bg-primary');
    expect(screen.getByText('تكلفة فعلية')).not.toHaveClass('bg-primary');
  });
});
