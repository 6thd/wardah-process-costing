/**
 * اختبارات دوال محرّك الرواتب الصافية (P12-C) — تثبّت تصحيحات علل «حاسبني»:
 * GOSI محسوب بالسقف والتمييز، الإجازة المدفوعة لا تُخصم، النسب تُقيَّم من
 * أساسها وformula تُرفض، والمعدل اليومي/وعاء الإضافي بسياسة.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}));
vi.mock('../attendance-service', () => ({ listAttendanceForPeriod: vi.fn() }));
vi.mock('../payroll-lock-service', () => ({ getPayrollLock: vi.fn() }));
vi.mock('../policies-service', () => ({ getHrPolicies: vi.fn() }));
vi.mock('../adjustments-service', () => ({ listAdjustmentsForMonth: vi.fn() }));

import {
  evaluateComponentAmount,
  computeGosi,
  analyzeAttendance,
  dailyRateOf,
  overtimeHourlyRate,
  getWorkingDays,
  getDaysInMonth,
} from '../payroll-engine';

const gosiPolicies = {
  gosi_employee_pct: 9.75,
  gosi_employer_pct: 11.75,
  gosi_base_cap: 45000,
  gosi_applies_to: 'saudi_only' as const,
};

describe('computeGosi — GOSI صحيح (عكس حاسبني الميت)', () => {
  it('سعودي: وعاء أساسي+سكن، حصتا موظف/صاحب عمل', () => {
    const g = computeGosi(10000, 2000, gosiPolicies, true);
    expect(g.base).toBe(12000);
    expect(g.employee).toBeCloseTo(1170);   // 12000×9.75%
    expect(g.employer).toBeCloseTo(1410);   // 12000×11.75%
  });

  it('السقف 45,000 يُفعَّل (كان غائباً في حاسبني)', () => {
    const g = computeGosi(50000, 10000, gosiPolicies, true);
    expect(g.base).toBe(45000);
    expect(g.employee).toBeCloseTo(4387.5);
  });

  it('saudi_only: الوافد بلا حصص', () => {
    const g = computeGosi(10000, 2000, gosiPolicies, false);
    expect(g.employee).toBe(0);
    expect(g.employer).toBe(0);
  });

  it('none: معطَّل للجميع؛ all: يشمل الوافد', () => {
    expect(computeGosi(10000, 0, { ...gosiPolicies, gosi_applies_to: 'none' }, true).employee).toBe(0);
    expect(computeGosi(10000, 0, { ...gosiPolicies, gosi_applies_to: 'all' }, false).employee).toBeCloseTo(975);
  });
});

describe('evaluateComponentAmount — تقييم النسب (كانت تُعامل كمبالغ ثابتة)', () => {
  it('fixed: القيمة كما هي', () => {
    expect(evaluateComponentAmount('fixed', 2000, 10000)).toBe(2000);
  });
  it('percentage: نسبة من الأساسي', () => {
    expect(evaluateComponentAmount('percentage', 25, 10000)).toBe(2500);
  });
  it('formula: رفض واضح لا تجاهل صامت', () => {
    expect(() => evaluateComponentAmount('formula', 1, 10000)).toThrow('غير مدعوم');
  });
});

describe('analyzeAttendance — الإجازة المدفوعة لا تُخصم (علّة حاسبني)', () => {
  it('غياب يُخصم، إجازة مدفوعة لا، إجازة غير مدفوعة تُخصم', () => {
    const r = analyzeAttendance({
      '1': { status: 'absent' },
      '2': { status: 'leave', paid: true },
      '3': { status: 'leave' },                 // بلا علم ⇒ مدفوعة (آمن نظاماً)
      '4': { status: 'leave', paid: false },
      '5': { status: 'unpaid_leave' },
    }, 8, 0);
    expect(r.absenceDays).toBe(1);
    expect(r.unpaidLeaveDays).toBe(2);
  });

  it('الإضافي من in/out فوق ساعات اليوم وضمن السماحية', () => {
    const r = analyzeAttendance({
      '1': { status: 'present', check_in: '2026-07-01T08:00:00Z', check_out: '2026-07-01T18:00:00Z' }, // 10h ⇒ 2 إضافي
      '2': { status: 'present', check_in: '2026-07-02T08:00:00Z', check_out: '2026-07-02T16:10:00Z' }, // 8h10m ⇒ ضمن سماحية 15د
    }, 8, 15);
    expect(r.overtimeHours).toBeCloseTo(2);
  });
});

describe('dailyRateOf / overtimeHourlyRate — سياسات الوعاء', () => {
  it('working_days مقابل thirty', () => {
    expect(dailyRateOf(9000, 26, 'working_days')).toBeCloseTo(9000 / 26);
    expect(dailyRateOf(9000, 26, 'thirty')).toBeCloseTo(300);
  });
  it('وعاء الإضافي: أساسي أو أساسي+سكن', () => {
    expect(overtimeHourlyRate(8000, 2000, 25, 8, 'basic')).toBeCloseTo(8000 / 200);
    expect(overtimeHourlyRate(8000, 2000, 25, 8, 'basic_housing')).toBeCloseTo(10000 / 200);
  });
});

describe('أيام الشهر/العمل', () => {
  it('فبراير كبيسة/بسيطة', () => {
    expect(getDaysInMonth(2024, 2)).toBe(29);
    expect(getDaysInMonth(2026, 2)).toBe(28);
  });
  it('أيام عمل يوليو 2026 بعطلة الجمعة = 26', () => {
    expect(getWorkingDays(2026, 7, new Set(['friday']))).toBe(26);
  });
});
