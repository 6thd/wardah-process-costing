import { beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = { data: unknown[] | null; error: { message: string } | null };

const db = vi.hoisted(() => {
  const responses: QueryResult[] = [];
  const calls = {
    from: [] as string[],
    eq: [] as unknown[][],
    gte: [] as unknown[][],
    lte: [] as unknown[][],
    range: [] as unknown[][],
  };

  const from = vi.fn((table: string) => {
    calls.from.push(table);
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['select', 'eq', 'gte', 'lte', 'order'] as const) {
      chain[method] = vi.fn((...args: unknown[]) => {
        if (method === 'eq') calls.eq.push(args);
        if (method === 'gte') calls.gte.push(args);
        if (method === 'lte') calls.lte.push(args);
        return chain;
      });
    }
    chain.range = vi.fn((...args: unknown[]) => {
      calls.range.push(args);
      return Promise.resolve(responses.shift() ?? { data: [], error: null });
    });
    return chain;
  });

  return { responses, calls, from, getTenant: vi.fn() };
});

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: db.getTenant,
  supabase: { from: db.from },
}));

import {
  listEmployeesForReports,
  listPayrollRunsForReport,
} from '../reports-service';

const employee = (index: number) => ({
  id: `emp-${String(index).padStart(4, '0')}`,
  employee_id: `E-${index}`,
  full_name: `Employee ${index}`,
  department: 'Production',
  position: 'Operator',
  status: 'active',
  hire_date: '2026-01-01',
  termination_date: null,
});

describe('HR reports service', () => {
  beforeEach(() => {
    db.responses.length = 0;
    for (const calls of Object.values(db.calls)) calls.length = 0;
    db.from.mockClear();
    db.getTenant.mockReset().mockResolvedValue('org-1');
  });

  it('fully paginates employees and stops after the first short page', async () => {
    db.responses.push(
      { data: Array.from({ length: 1000 }, (_, index) => employee(index)), error: null },
      { data: [employee(1000)], error: null },
    );

    const rows = await listEmployeesForReports();

    expect(rows).toHaveLength(1001);
    expect(db.calls.range).toEqual([[0, 999], [1000, 1999]]);
    expect(db.calls.eq).toContainEqual(['org_id', 'org-1']);
  });

  it('propagates an error from any employee page instead of returning partial data', async () => {
    db.responses.push(
      { data: Array.from({ length: 1000 }, (_, index) => employee(index)), error: null },
      { data: null, error: { message: 'page two denied' } },
    );

    await expect(listEmployeesForReports()).rejects.toThrow('page two denied');
  });

  it('paginates date-scoped payroll rows with the submitted organization', async () => {
    db.responses.push({
      data: [{
        id: 'run-1', period_id: 'period-1', run_date: '2026-03-31',
        status: 'approved', total_gross: 100, total_deductions: 10, total_net: 90,
      }],
      error: null,
    });

    const rows = await listPayrollRunsForReport({
      orgId: 'org-submitted',
      from: '2026-03-01',
      to: '2026-03-31',
    });

    expect(rows).toHaveLength(1);
    expect(db.getTenant).not.toHaveBeenCalled();
    expect(db.calls.eq).toContainEqual(['org_id', 'org-submitted']);
    expect(db.calls.gte).toEqual([['run_date', '2026-03-01']]);
    expect(db.calls.lte).toEqual([['run_date', '2026-03-31']]);
  });

  it('fails closed when no organization can be resolved', async () => {
    db.getTenant.mockResolvedValue(null);
    await expect(listEmployeesForReports()).rejects.toThrow('Organization not found');
    expect(db.from).not.toHaveBeenCalled();
  });
});
