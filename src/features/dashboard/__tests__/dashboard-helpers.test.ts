/**
 * اختبارات دوال اللوحة الصافية — نمو شهري وهامش شهري بلا تلفيق:
 * غياب أساس المقارنة/الإيراد ⇒ null (لا نسبة مُختلَقة).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/services/dashboard-data-service', () => ({
  fetchRealDashboardData: vi.fn(),
  fetchOperationalCounts: vi.fn(),
}));

import { monthOverMonthGrowth } from '../dashboard-overview';
import { monthlyMargin } from '../dashboard-performance';

describe('monthOverMonthGrowth', () => {
  it('يحسب النمو من آخر شهرين', () => {
    expect(monthOverMonthGrowth([0, 0, 0, 0, 100, 150])).toBeCloseTo(50);
    expect(monthOverMonthGrowth([0, 0, 0, 0, 200, 150])).toBeCloseTo(-25);
  });

  it('لا أساس مقارنة (الشهر السابق 0 أو سلسلة قصيرة) ⇒ null', () => {
    expect(monthOverMonthGrowth([0, 0, 0, 0, 0, 150])).toBeNull();
    expect(monthOverMonthGrowth([150])).toBeNull();
    expect(monthOverMonthGrowth([])).toBeNull();
  });
});

describe('monthlyMargin', () => {
  it('يحسب الهامش من إيراد وربح حقيقيين', () => {
    expect(monthlyMargin(1000, 250)).toBeCloseTo(25);
    expect(monthlyMargin(1000, -100)).toBeCloseTo(-10);
  });

  it('لا إيراد ⇒ null (لا هامش مُختلَق)', () => {
    expect(monthlyMargin(0, 100)).toBeNull();
  });
});
