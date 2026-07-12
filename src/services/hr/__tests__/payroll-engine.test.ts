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
  round2,
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
  it('شهور 31/30 يوماً', () => {
    expect(getDaysInMonth(2026, 1)).toBe(31);  // يناير
    expect(getDaysInMonth(2026, 4)).toBe(30);  // أبريل
    expect(getDaysInMonth(2026, 12)).toBe(31); // ديسمبر
  });
  it('أيام عمل يوليو 2026 بعطلة الجمعة = 26', () => {
    expect(getWorkingDays(2026, 7, new Set(['friday']))).toBe(26);
  });
  it('أيام عمل بعطلة الجمعة+السبت', () => {
    const wd = getWorkingDays(2026, 7, new Set(['friday', 'saturday']));
    expect(wd).toBeGreaterThan(0);
    expect(wd).toBeLessThan(26);
  });
});

describe('round2', () => {
  it('يُقرّب لـ خانتين عشريتين', () => {
    expect(round2(9.999)).toBe(10);
    expect(round2(1.236)).toBe(1.24);
    expect(round2(1234.567)).toBe(1234.57);
  });
  it('أعداد سالبة', () => {
    expect(round2(-1.236)).toBe(-1.24);
  });
});

describe('evaluateComponentAmount — حالات حدية', () => {
  it('نوع null/undefined ⇒ fixed', () => {
    expect(evaluateComponentAmount(null, 500, 10000)).toBe(500);
    expect(evaluateComponentAmount(undefined, 500, 10000)).toBe(500);
  });
  it('نسبة 0% ⇒ صفر', () => {
    expect(evaluateComponentAmount('percentage', 0, 10000)).toBe(0);
  });
  it('حالة غير حساسة للأحرف', () => {
    expect(evaluateComponentAmount('FIXED', 300, 10000)).toBe(300);
    expect(evaluateComponentAmount('PERCENTAGE', 10, 10000)).toBe(1000);
  });
});

describe('dailyRateOf — حالات حدية', () => {
  it('صفر أيام عمل ⇒ /30 احتياطياً', () => {
    expect(dailyRateOf(6000, 0, 'working_days')).toBeCloseTo(200);
  });
});

describe('analyzeAttendance — حالات حدية', () => {
  it('undefined days ⇒ صفر', () => {
    const r = analyzeAttendance(undefined, 8, 0);
    expect(r.absenceDays).toBe(0);
    expect(r.unpaidLeaveDays).toBe(0);
    expect(r.overtimeHours).toBe(0);
  });
  it('check_in بعد check_out ⇒ لا إضافي', () => {
    const r = analyzeAttendance({
      '1': { status: 'present', check_in: '2026-07-01T18:00:00Z', check_out: '2026-07-01T08:00:00Z' },
    }, 8, 0);
    expect(r.overtimeHours).toBe(0);
  });
  it('in/out بديل لـ check_in/check_out', () => {
    const r = analyzeAttendance({
      '1': { status: 'present', in: '2026-07-01T08:00:00Z', out: '2026-07-01T19:00:00Z' },
    }, 8, 0);
    expect(r.overtimeHours).toBeCloseTo(3);
  });
});

// ===== اختبار عقد الحمولة (payload_version 2 — Migration 101) =====
// يثبّت أن مخرجات calculatePayrollPreview تحقق ما سيتحقق منه الخادم:
// Σ سطور الاستحقاق = gross، Σ سطور الاستقطاع = الاستقطاعات، net = الفرق،
// ومجاميع buckets تُشتق من السطور نفسها — ويثبّت إصلاح علّة E1 (ازدواج
// تعديل الأوفرتايم: كان يُدمج في سطر OT ويُدفع سطراً مستقلاً معاً).
import { calculatePayrollPreview } from '../payroll-engine';
import { supabase } from '@/lib/supabase';
import { getHrPolicies } from '../policies-service';
import { getPayrollLock } from '../payroll-lock-service';
import { listAttendanceForPeriod } from '../attendance-service';
import { listAdjustmentsForMonth } from '../adjustments-service';

const thenable = <T,>(result: T) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'neq', 'order']) q[m] = vi.fn(() => q);
  (q as { then: unknown }).then = (resolve: (v: T) => unknown) => Promise.resolve(result).then(resolve);
  return q;
};

describe('calculatePayrollPreview — عقد السطور/الإجماليات/الـbuckets', () => {
  it('Σ السطور = الإجماليات، وOT حضور منفصل عن ADJ_OVERTIME (إصلاح E1)', async () => {
    vi.mocked(getHrPolicies).mockResolvedValue({
      gosi_employee_pct: 9.75, gosi_employer_pct: 11.75, gosi_base_cap: 45000,
      gosi_applies_to: 'saudi_only', weekend_days: ['friday'], employee_daily_hours: 8,
      overtime_grace_minutes: 0, overtime_multiplier: 1.5,
      daily_rate_basis: 'working_days', overtime_base: 'basic',
    } as never);
    vi.mocked(getPayrollLock).mockResolvedValue(null as never);
    vi.mocked(listAdjustmentsForMonth).mockResolvedValue([
      { id: 'adj-1', employee_id: 'emp-1', adjustment_type: 'overtime', amount: 500, description: 'إضافي معتمد' },
      { id: 'adj-2', employee_id: 'emp-1', adjustment_type: 'deduction', amount: 200, description: 'جزاء' },
    ] as never);
    vi.mocked(listAttendanceForPeriod).mockResolvedValue([{
      employee_id: 'emp-1',
      days: { '2025-01-05': { status: 'present', check_in: '2025-01-05T08:00:00Z', check_out: '2025-01-05T18:00:00Z' } },
    }] as never);
    vi.mocked(supabase.from).mockImplementation(((table: string) => {
      if (table === 'employees') {
        return thenable({
          data: [{ id: 'emp-1', employee_id: 'E-001', first_name: 'أحمد', last_name: 'صالح',
                   department: null, salary: 0, status: 'active', is_saudi: true }],
          error: null,
        });
      }
      if (table === 'employee_salary_structures') {
        return thenable({
          data: [
            { employee_id: 'emp-1', value: 10000, component: { code: 'BASIC', name_ar: 'أساسي', component_type: 'earning', calculation_type: 'fixed' } },
            { employee_id: 'emp-1', value: 2000, component: { code: 'HOUSING', name_ar: 'سكن', component_type: 'earning', calculation_type: 'fixed' } },
          ],
          error: null,
        });
      }
      throw new Error(`جدول غير متوقع في الاختبار: ${table}`);
    }) as never);

    const preview = await calculatePayrollPreview(2025, 1);
    expect(preview.employees).toHaveLength(1);
    const lines = preview.employees.flatMap((e) => e.lines);

    // 1) إصلاح E1: سطر OT = إضافي الحضور فقط (ساعتان)، وتعديل الإضافي سطر مستقل
    const otLines = lines.filter((l) => l.component_code === 'OT');
    const adjOtLines = lines.filter((l) => l.component_code === 'ADJ_OVERTIME');
    expect(otLines).toHaveLength(1);
    expect(adjOtLines).toHaveLength(1);
    expect(adjOtLines[0].amount).toBe(500);
    const emp = preview.employees[0];
    expect(round2(otLines[0].amount + adjOtLines[0].amount)).toBeCloseTo(emp.overtimeAmount, 2);

    // 2) عقد الإجماليات: Σ سطور = gross/deductions/net
    const sumEarnings = round2(lines.filter((l) => !l.is_deduction).reduce((s, l) => s + l.amount, 0));
    const sumDeductions = round2(lines.filter((l) => l.is_deduction).reduce((s, l) => s + l.amount, 0));
    expect(sumEarnings).toBeCloseTo(preview.totals.gross, 2);
    expect(sumDeductions).toBeCloseTo(
      round2(preview.totals.gosiEmployee + preview.totals.deductions + preview.totals.absence), 2);
    expect(round2(sumEarnings - sumDeductions)).toBeCloseTo(preview.totals.net, 2);

    // 3) عقد الـbuckets: كل bucket مدعوم بسطور يساوي مجموعها (ما سيتحقق منه الخادم)
    const bucketFromLines = (bucket: string) =>
      round2(lines.filter((l) => l.bucket === bucket).reduce((s, l) => s + l.amount, 0));
    for (const b of ['basic_salary', 'housing_allowance', 'transport_allowance',
                     'other_allowance', 'overtime', 'deductions', 'loans', 'absence_recovery'] as const) {
      expect(bucketFromLines(b)).toBeCloseTo(preview.buckets[b] ?? 0, 2);
    }
    // gosi_payable = سطور حصة الموظف + مصروف صاحب العمل (بلا سطر)
    expect(round2(bucketFromLines('gosi_employee') + (preview.buckets.gosi_employer_expense ?? 0)))
      .toBeCloseTo(preview.buckets.gosi_payable ?? 0, 2);
    // payable = الصافي، وتوازن القيد: Σمدين = Σدائن
    expect(preview.buckets.payable ?? 0).toBeCloseTo(preview.totals.net, 2);
    const debits = round2((preview.buckets.basic_salary ?? 0) + (preview.buckets.housing_allowance ?? 0)
      + (preview.buckets.transport_allowance ?? 0) + (preview.buckets.other_allowance ?? 0)
      + (preview.buckets.overtime ?? 0) + (preview.buckets.gosi_employer_expense ?? 0));
    const credits = round2((preview.buckets.gosi_payable ?? 0) + (preview.buckets.deductions ?? 0)
      + (preview.buckets.loans ?? 0) + (preview.buckets.absence_recovery ?? 0) + (preview.buckets.payable ?? 0));
    expect(debits).toBeCloseTo(credits, 2);
  });

  it('يرفض تعديلاً بمبلغ سالب برسالة واضحة (عقد Migration 101: مبالغ موجبة فقط)', async () => {
    vi.mocked(listAdjustmentsForMonth).mockResolvedValue([
      { id: 'adj-neg', employee_id: 'emp-1', adjustment_type: 'allowance', amount: -300, description: 'تصحيح' },
    ] as never);
    vi.mocked(listAttendanceForPeriod).mockResolvedValue([] as never);
    await expect(calculatePayrollPreview(2025, 1)).rejects.toThrow(/سالب/);
  });
});
