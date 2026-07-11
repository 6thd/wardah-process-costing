/**
 * اختبارات حساب مشتقات WIP (متوسط مرجّح): الوحدات المكافئة، الإجمالي،
 * وتكلفة الوحدة المكافئة — null عند غياب EU (لا قسمة على صفر ولا تلفيق).
 */
import { describe, it, expect } from 'vitest';
import { computeWipDerived, type WipLogFormValues } from '../components/WipLogFormDialog';

const base: WipLogFormValues = {
  mo_id: 'mo1', stage_id: 's1',
  period_start: '2026-07-01', period_end: '2026-07-31',
  units_beginning_wip: 100, units_started: 900, units_completed: 800, units_ending_wip: 200,
  material_completion_pct: 100, conversion_completion_pct: 50,
  cost_beginning_wip: 1000, cost_material: 5000, cost_labor: 2000, cost_overhead: 1000,
  notes: '',
};

describe('computeWipDerived', () => {
  it('يحسب الوحدات المكافئة (مكتمل + نهاية×نسبة الإكمال)', () => {
    const d = computeWipDerived(base);
    expect(d.equivalent_units_material).toBe(800 + 200 * 1.0);   // 1000
    expect(d.equivalent_units_conversion).toBe(800 + 200 * 0.5); // 900
  });

  it('الإجمالي = بداية WIP + مواد + عمل + أوفرهيد', () => {
    const d = computeWipDerived(base);
    expect(d.cost_total).toBe(1000 + 5000 + 2000 + 1000); // 9000
  });

  it('تكلفة الوحدة المكافئة: مواد=(بداية+مواد)/EU، تحويل=(عمل+أوفرهيد)/EU', () => {
    const d = computeWipDerived(base);
    expect(d.cost_per_eu_material).toBeCloseTo(6000 / 1000);  // 6
    expect(d.cost_per_eu_conversion).toBeCloseTo(3000 / 900); // 3.33
  });

  it('EU = 0 ⇒ تكلفة الوحدة null (لا قسمة على صفر)', () => {
    const d = computeWipDerived({
      ...base, units_completed: 0, units_ending_wip: 0,
    });
    expect(d.equivalent_units_material).toBe(0);
    expect(d.cost_per_eu_material).toBeNull();
    expect(d.cost_per_eu_conversion).toBeNull();
  });
});
