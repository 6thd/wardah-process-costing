/**
 * اختبارات محرّك نهاية الخدمة (P12-E) — مطابقة يدوية لنظام العمل السعودي.
 */
import { describe, it, expect } from 'vitest';
import {
  calcEos,
  computeBaseEos,
  resignationMultiplier,
  computeArt77Compensation,
  yearsOfServiceBetween,
} from '../settlement-service';

describe('yearsOfServiceBetween', () => {
  it('سنة كاملة', () => {
    expect(
      yearsOfServiceBetween(new Date('2020-01-01'), new Date('2021-01-01')),
    ).toBeCloseTo(1, 0);
  });
  it('تاريخ نهاية قبل البداية ⇒ صفر', () => {
    expect(
      yearsOfServiceBetween(new Date('2025-01-01'), new Date('2020-01-01')),
    ).toBe(0);
  });
});

describe('computeBaseEos — م109', () => {
  it('3 سنوات × نصف شهر: 3 × 0.5 × 10000 = 15000', () => {
    expect(computeBaseEos(10000, 3)).toBeCloseTo(15000);
  });
  it('7 سنوات: (5×0.5 + 2×1) × 10000 = 45000', () => {
    expect(computeBaseEos(10000, 7)).toBeCloseTo(45000);
  });
});

describe('resignationMultiplier — م109', () => {
  it('أقل من سنتين ⇒ صفر', () => {
    expect(resignationMultiplier(1.5)).toBe(0);
  });
  it('3 سنوات ⇒ ثلث', () => {
    expect(resignationMultiplier(3)).toBeCloseTo(1 / 3);
  });
  it('7 سنوات ⇒ ثلثان', () => {
    expect(resignationMultiplier(7)).toBeCloseTo(2 / 3);
  });
  it('10 سنوات ⇒ كامل', () => {
    expect(resignationMultiplier(10)).toBe(1);
  });
});

describe('computeArt77Compensation — م77', () => {
  it('سنة واحدة ⇒ حد أدنى شهرين', () => {
    expect(computeArt77Compensation(10000, 1)).toBeCloseTo(20000);
  });
  it('5 سنوات ⇒ 5 أشهر', () => {
    expect(computeArt77Compensation(10000, 5)).toBeCloseTo(50000);
  });
});

describe('calcEos — سيناريوهات كاملة', () => {
  const base = {
    basic: 8000,
    housing: 2000,
    transport: 1000,
    other_allowances: 0,
    service_start: '2017-01-01',
    service_end:   '2024-01-01', // 7 سنوات
  };

  it('فصل بدون سبب (م77) 7 سنوات: مكافأة كاملة + تعويض م77', () => {
    const r = calcEos({ ...base, termination_type: 'termination_without_cause' });
    // ~6.997 سنة بسبب 365.25 يوم/سنة
    expect(r.years_of_service).toBeGreaterThan(6.9);
    expect(r.years_of_service).toBeLessThan(7.1);
    expect(r.eos_multiplier).toBe(1);
    // base EOS ≈ (5×0.5 + ~2×1) × 11000 ≈ 49500 (±100)
    expect(r.eos_amount).toBeGreaterThan(49000);
    expect(r.eos_amount).toBeLessThan(50000);
    // م77: max(2, ~7) أشهر × 11000 ≈ 77000 (±100)
    expect(r.art77_compensation).toBeGreaterThan(76000);
    expect(r.art77_compensation).toBeLessThan(78000);
    expect(r.total).toBeCloseTo(r.eos_amount + r.art77_compensation, 0);
  });

  it('استقالة 7 سنوات ⇒ ثلثا المكافأة', () => {
    const r = calcEos({ ...base, termination_type: 'resignation' });
    expect(r.eos_multiplier).toBeCloseTo(2 / 3);
    // base_eos × 2/3: نتحقق من النسبة لا القيمة المطلقة
    expect(r.eos_amount).toBeCloseTo(r.base_eos * (2 / 3), 2);
    expect(r.art77_compensation).toBe(0);
  });

  it('استقالة < 2 سنة ⇒ صفر', () => {
    const r = calcEos({
      ...base,
      service_end: '2018-06-01', // ~1.4 سنة
      termination_type: 'resignation',
    });
    expect(r.eos_amount).toBe(0);
    expect(r.total).toBe(0);
  });

  it('م80 (مخالفة جسيمة) ⇒ صفر بغض النظر عن الخدمة', () => {
    const r = calcEos({ ...base, termination_type: 'termination_for_cause' });
    expect(r.eos_amount).toBe(0);
    expect(r.total).toBe(0);
  });

  it('رصيد إجازات يُضاف', () => {
    const r = calcEos({
      ...base,
      termination_type: 'end_of_contract',
      leave_balance_days: 15,
    });
    // يومي = 11000/30 ≈ 366.67 × 15 ≈ 5500
    expect(r.leave_encashment).toBeCloseTo((11000 / 30) * 15, 0);
    expect(r.total).toBeCloseTo(r.eos_amount + r.leave_encashment, 0);
  });
});
