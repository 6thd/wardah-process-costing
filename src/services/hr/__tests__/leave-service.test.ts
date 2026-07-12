/**
 * اختبارات حساب رصيد الإجازات (P12-D) — دوال صافية بلا DB.
 * نظام العمل م109: 21 يوماً < 5 سنوات، 30 يوماً ≥ 5 سنوات.
 */
import { describe, it, expect } from 'vitest';
import {
  computeLeaveEntitlement,
  computeLeaveAccrual,
  computeLeaveBalance,
} from '../leave-service';

const policies = {
  annual_leave_days_before_5y: 21,
  annual_leave_days_after_5y: 30,
};

describe('computeLeaveEntitlement — م109', () => {
  it('أقل من 5 سنوات ⇒ 21 يوماً', () => {
    expect(computeLeaveEntitlement(0, policies)).toBe(21);
    expect(computeLeaveEntitlement(4.9, policies)).toBe(21);
  });

  it('5 سنوات وأكثر ⇒ 30 يوماً', () => {
    expect(computeLeaveEntitlement(5, policies)).toBe(30);
    expect(computeLeaveEntitlement(10, policies)).toBe(30);
  });
});

describe('computeLeaveAccrual — تناسبي', () => {
  it('6 أشهر خدمة (21 يوم/سنة) ⇒ ~10.5 يوم', () => {
    const ref = new Date('2026-01-01');
    const asOf = new Date('2026-07-01'); // ~181 يوم
    const accrued = computeLeaveAccrual(ref, asOf, 21);
    expect(accrued).toBeGreaterThan(10);
    expect(accrued).toBeLessThan(11);
  });

  it('سنة كاملة (30 يوم/سنة) ⇒ ~30 يوماً', () => {
    const ref = new Date('2025-01-01');
    const asOf = new Date('2026-01-01'); // 365 يوم
    expect(computeLeaveAccrual(ref, asOf, 30)).toBeCloseTo(30, 0);
  });

  it('تاريخ مرجعي مستقبلي ⇒ صفر (لا سالب)', () => {
    const ref = new Date('2027-01-01');
    const asOf = new Date('2026-07-01');
    expect(computeLeaveAccrual(ref, asOf, 21)).toBe(0);
  });
});

describe('computeLeaveBalance — رصيد لا ينزل عن الصفر', () => {
  it('اكتسب 15 واستهلك 10 ⇒ رصيد 5', () => {
    expect(computeLeaveBalance(15, 10)).toBe(5);
  });

  it('استهلك أكثر مما اكتسب ⇒ يقيَّد عند 0', () => {
    expect(computeLeaveBalance(5, 20)).toBe(0);
  });
});
