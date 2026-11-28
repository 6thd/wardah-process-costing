import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryResult = { data: unknown; error: { message: string } | null };

const db = vi.hoisted(() => {
  const responses = new Map<string, QueryResult[]>();
  const calls = {
    from: [] as string[],
    select: [] as unknown[][],
    eq: [] as unknown[][],
    in: [] as unknown[][],
  };

  const from = vi.fn((table: string) => {
    calls.from.push(table);
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'in'] as const) {
      chain[method] = vi.fn((...args: unknown[]) => {
        calls[method].push(args);
        return chain;
      });
    }
    chain.then = (
      resolve: (value: QueryResult) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(
      responses.get(table)?.shift() ?? { data: [], error: null },
    ).then(resolve, reject);
    return chain;
  });

  return {
    responses,
    calls,
    from,
    getTenant: vi.fn(),
    getPolicies: vi.fn(),
  };
});

vi.mock('@/lib/supabase', () => ({
  getEffectiveTenantId: db.getTenant,
  supabase: { from: db.from },
}));

vi.mock('../policies-service', () => ({
  getHrPoliciesReadOnly: db.getPolicies,
}));

vi.mock('../attendance-service', () => ({
  setDayStatusFallback: vi.fn(),
}));

import {
  computeLeaveAccrual,
  computeLeaveBalance,
  computeLeaveEntitlement,
  getLeaveBalance,
  listLeaveBalances,
} from '../leave-service';

const policies = {
  annual_leave_days_before_5y: 21,
  annual_leave_days_after_5y: 30,
};

const queue = (table: string, ...results: QueryResult[]) => {
  db.responses.set(table, results);
};

describe('leave balance pure functions', () => {
  it('uses the configured Saudi Labor Law service bands', () => {
    expect(computeLeaveEntitlement(4.9, policies)).toBe(21);
    expect(computeLeaveEntitlement(5, policies)).toBe(30);
  });

  it('prorates accrual and never returns a negative balance', () => {
    const accrued = computeLeaveAccrual(
      new Date('2026-01-01'),
      new Date('2026-07-01'),
      21,
    );
    expect(accrued).toBeGreaterThan(10);
    expect(accrued).toBeLessThan(11);
    expect(computeLeaveBalance(5, 20)).toBe(0);
  });
});

describe('listLeaveBalances', () => {
  beforeEach(() => {
    db.responses.clear();
    for (const calls of Object.values(db.calls)) calls.length = 0;
    db.from.mockClear();
    db.getTenant.mockReset().mockResolvedValue('org-1');
    db.getPolicies.mockReset().mockResolvedValue(policies);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('batches three reads, uses the latest settlement watermark, and excludes old or unpaid leave', async () => {
    queue('employees', {
      data: [{ id: 'emp-1', hire_date: '2020-01-01' }],
      error: null,
    });
    queue('hr_settlements', {
      data: [
        { employee_id: 'emp-1', service_end: '2025-01-01' },
        { employee_id: 'emp-1', service_end: '2026-01-01' },
      ],
      error: null,
    });
    queue('employee_leaves', {
      data: [
        { employee_id: 'emp-1', start_date: '2025-12-20', total_days: 5, leave_type: { is_paid: true } },
        { employee_id: 'emp-1', start_date: '2026-02-01', total_days: 3, leave_type: [{ is_paid: true }] },
        { employee_id: 'emp-1', start_date: '2026-03-01', total_days: 4, leave_type: { is_paid: false } },
      ],
      error: null,
    });

    const balances = await listLeaveBalances(['emp-1'], 'org-submitted');

    expect(balances.get('emp-1')).toMatchObject({
      entitlementPerYear: 30,
      used: 3,
      referenceDate: '2026-01-01',
    });
    expect(db.calls.from).toEqual(['employees', 'hr_settlements', 'employee_leaves']);
    expect(db.calls.in).toEqual([
      ['id', ['emp-1']],
      ['employee_id', ['emp-1']],
      ['employee_id', ['emp-1']],
    ]);
    expect(db.getPolicies).toHaveBeenCalledWith('org-submitted');
  });

  it('keeps hire date when an approved settlement watermark is older', async () => {
    queue('employees', { data: [{ id: 'emp-1', hire_date: '2026-02-01' }], error: null });
    queue('hr_settlements', { data: [{ employee_id: 'emp-1', service_end: '2026-01-01' }], error: null });
    queue('employee_leaves', { data: [], error: null });

    await expect(listLeaveBalances(['emp-1'])).resolves.toEqual(new Map([
      ['emp-1', expect.objectContaining({ referenceDate: '2026-02-01', used: 0 })],
    ]));
  });

  it.each([
    ['employees', 'employee read failed'],
    ['hr_settlements', 'settlement read failed'],
    ['employee_leaves', 'leave read failed'],
  ])('propagates %s query errors', async (failedTable, message) => {
    for (const table of ['employees', 'hr_settlements', 'employee_leaves']) {
      queue(table, table === failedTable
        ? { data: null, error: { message } }
        : { data: [], error: null });
    }

    await expect(listLeaveBalances(['emp-1'])).rejects.toThrow(message);
  });

  it('does no query for an empty employee set and fails for a missing employee wrapper result', async () => {
    await expect(listLeaveBalances([])).resolves.toEqual(new Map());
    expect(db.from).not.toHaveBeenCalled();

    queue('employees', { data: [], error: null });
    queue('hr_settlements', { data: [], error: null });
    queue('employee_leaves', { data: [], error: null });
    await expect(getLeaveBalance('missing')).rejects.toThrow('Employee not found');
  });
});
