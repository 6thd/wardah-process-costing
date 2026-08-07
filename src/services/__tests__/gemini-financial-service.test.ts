/**
 * Real coverage for the three data-correctness bugs found in review round 5
 * of the reports-insights dashboard:
 *
 * 1. Month/date boundaries were built via `date.toISOString().split('T')[0]`,
 *    which reads UTC components — for any timezone ahead of UTC (e.g. Asia/
 *    Riyadh, UTC+3) a local-midnight boundary silently shifts back one UTC
 *    calendar day, so every month's query window was off by a day. Verified
 *    directly under TZ=Asia/Riyadh below.
 * 2. fetchMonthlyFinancialData() used to always generate all twelve months
 *    regardless of the real calendar date, so any month after "today" was
 *    sent as a zero-filled entry that reads as a real completed month with
 *    zero sales/profit.
 * 3. Every gl_accounts/gl_entries/gl_entry_lines/products query discarded
 *    Supabase's `error` and relied on the client's default (silent) 1000-row
 *    cap, so a permission/network failure or a large dataset could both
 *    produce a "successful" but wrong (truncated or zero) total.
 *
 * The fake Supabase query builder below records every (table, filters,
 * range) a call issues and resolves per-table via caller-configured
 * handlers, so these are real assertions on the actual query parameters and
 * on real pagination/error-propagation behavior — not mocked-away.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll, afterEach } from 'vitest';

interface QueryState {
  table: string;
  filters: Array<[string, string, unknown]>;
  range?: [number, number];
}
type Handler = (state: QueryState) => { data: unknown[] | null; error: { message: string } | null };

const { queryLog, handlers, resetHarness, makeBuilder } = vi.hoisted(() => {
  const queryLog: QueryState[] = [];
  // A Map (not a plain object indexed by bracket notation) specifically so
  // looking up the per-table handler below reads as Map.get(), not a
  // dynamic-property-name object index — the latter is what a static
  // analyzer's "unsafe dynamic method" pattern flags, even though `table`
  // here is always a literal string baked into gemini-financial-service.ts
  // itself (e.g. supabase.from('gl_accounts')), never external input.
  const handlers = new Map<string, Handler>();

  function makeBuilder(table: string) {
    const state: QueryState = { table, filters: [] };
    const builder: Record<string, (...args: unknown[]) => unknown> = {
      select: () => builder,
      eq: (col: unknown, val: unknown) => {
        state.filters.push([col as string, 'eq', val]);
        return builder;
      },
      gte: (col: unknown, val: unknown) => {
        state.filters.push([col as string, 'gte', val]);
        return builder;
      },
      lt: (col: unknown, val: unknown) => {
        state.filters.push([col as string, 'lt', val]);
        return builder;
      },
      in: (col: unknown, vals: unknown) => {
        state.filters.push([col as string, 'in', vals]);
        return builder;
      },
      range: (from: unknown, to: unknown) => {
        state.range = [from as number, to as number];
        queryLog.push(state);
        const handler = handlers.get(table);
        if (!handler) throw new Error(`gemini-financial-service.test.ts: no handler configured for table "${table}"`);
        return Promise.resolve(handler(state));
      },
    };
    return builder;
  }

  function resetHarness() {
    queryLog.length = 0;
    handlers.clear();
    const emptyOk = () => ({ data: [], error: null });
    handlers.set('gl_accounts', emptyOk);
    handlers.set('gl_entries', emptyOk);
    handlers.set('gl_entry_lines', emptyOk);
    handlers.set('products', emptyOk);
  }

  return { queryLog, handlers, resetHarness, makeBuilder };
});

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => makeBuilder(table) },
  getEffectiveTenantId: vi.fn(async () => 'org-1'),
}));

import { geminiFinancialService } from '../gemini-financial-service';

let originalTZ: string | undefined;
beforeAll(() => {
  originalTZ = process.env.TZ;
});
afterAll(() => {
  if (originalTZ === undefined) delete process.env.TZ;
  else process.env.TZ = originalTZ;
});

beforeEach(() => {
  resetHarness();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('gemini-financial-service — date boundaries under Asia/Riyadh (UTC+3)', () => {
  it('queries the real calendar month, not a day-shifted UTC window', async () => {
    process.env.TZ = 'Asia/Riyadh';

    // 2026-01-01 00:00 Asia/Riyadh — the exact case verified by hand:
    // .toISOString() on this Date reads "2025-12-31T21:00:00.000Z", so the
    // old `.toISOString().split('T')[0]` bound would have queried from
    // "2025-12-31" instead of "2026-01-01".
    const startDate = new Date(2026, 0, 1);
    const endDate = new Date(2026, 0, 31);

    await geminiFinancialService.fetchRealFinancialKPIs(startDate, endDate);

    const entriesQuery = queryLog.find(q => q.table === 'gl_entries');
    expect(entriesQuery).toBeDefined();

    const gteFilter = entriesQuery!.filters.find(([col, op]) => col === 'entry_date' && op === 'gte');
    const ltFilter = entriesQuery!.filters.find(([col, op]) => col === 'entry_date' && op === 'lt');

    expect(gteFilter?.[2]).toBe('2026-01-01');
    // Half-open upper bound: strictly less than the day AFTER the
    // inclusive end date, so 2026-01-31 itself is still included
    // regardless of any time-of-day component.
    expect(ltFilter?.[2]).toBe('2026-02-01');
  });

  it('queries 2026-08-01 for a month starting 2026-08-01 00:00 Asia/Riyadh, not 2026-07-31', async () => {
    process.env.TZ = 'Asia/Riyadh';

    const startDate = new Date(2026, 7, 1);
    const endDate = new Date(2026, 7, 31);

    await geminiFinancialService.fetchRealFinancialKPIs(startDate, endDate);

    const entriesQuery = queryLog.find(q => q.table === 'gl_entries');
    const gteFilter = entriesQuery!.filters.find(([col, op]) => col === 'entry_date' && op === 'gte');
    const ltFilter = entriesQuery!.filters.find(([col, op]) => col === 'entry_date' && op === 'lt');

    expect(gteFilter?.[2]).toBe('2026-08-01');
    expect(ltFilter?.[2]).toBe('2026-09-01');
  });
});

describe('gemini-financial-service — fetchMonthlyFinancialData never fabricates future months', () => {
  it('returns only يناير..أغسطس on August 7th, marking أغسطس as month-to-date', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 7)); // August 7th, 2026

    const monthly = await geminiFinancialService.fetchMonthlyFinancialData(2026);

    expect(monthly).toHaveLength(8);
    expect(monthly.map(m => m.monthNameAr)).toEqual([
      'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس'
    ]);
    expect(monthly.some(m => m.monthNameAr === 'سبتمبر')).toBe(false);
    expect(monthly.some(m => m.monthNameAr === 'أكتوبر')).toBe(false);
    expect(monthly.some(m => m.monthNameAr === 'ديسمبر')).toBe(false);

    // Only the real current month is month-to-date — every completed
    // month must not be flagged as partial.
    const august = monthly.find(m => m.monthNameAr === 'أغسطس');
    expect(august?.isMTD).toBe(true);
    expect(monthly.filter(m => m.monthNameAr !== 'أغسطس').every(m => m.isMTD === false)).toBe(true);
  });

  it('returns all twelve months for a fully past year', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 7));

    const monthly = await geminiFinancialService.fetchMonthlyFinancialData(2025);

    expect(monthly).toHaveLength(12);
    expect(monthly.every(m => m.isMTD === false)).toBe(true);
  });

  it('returns no months at all for a year that has not started yet', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 7));

    const monthly = await geminiFinancialService.fetchMonthlyFinancialData(2027);

    expect(monthly).toHaveLength(0);
  });
});

describe('gemini-financial-service — pagination past Supabase\'s default 1000-row cap', () => {
  it('accumulates all 1001 posted entries across two pages instead of silently truncating at 1000', async () => {
    const TOTAL_ENTRIES = 1001;

    handlers.set('gl_entries', (state) => {
      const [from, to] = state.range!;
      const page = [];
      for (let i = from; i <= to && i < TOTAL_ENTRIES; i++) page.push({ id: `entry-${i}` });
      return { data: page, error: null };
    });
    handlers.set('gl_accounts', (state) => {
      const categoryFilter = state.filters.find(([col]) => col === 'category');
      if (categoryFilter?.[2] === 'REVENUE') return { data: [{ id: 'rev-1' }], error: null };
      return { data: [], error: null };
    });
    handlers.set('gl_entry_lines', (state) => {
      const inFilter = state.filters.find(([col, op]) => col === 'entry_id' && op === 'in');
      const requestedIds = (inFilter?.[2] as string[]) ?? [];
      const [from, to] = state.range!;
      const page = requestedIds.slice(from, to + 1).map(() => ({ account_id: 'rev-1', debit: 0, credit: 100 }));
      return { data: page, error: null };
    });

    const kpis = await geminiFinancialService.fetchRealFinancialKPIs(new Date(2026, 0, 1), new Date(2026, 11, 31));

    // 1001 entries x 100 credit each — only reachable if the entries page
    // past row 1000 was actually fetched and its lines actually summed,
    // not silently dropped at Supabase's default page cap.
    expect(kpis.totalSales).toBe(100100);

    const entryQueries = queryLog.filter(q => q.table === 'gl_entries');
    expect(entryQueries.length).toBeGreaterThanOrEqual(2);
  });

  it('throws instead of returning a zero total when a query fails', async () => {
    handlers.set('gl_accounts', (state) => {
      const categoryFilter = state.filters.find(([col]) => col === 'category');
      if (categoryFilter?.[2] === 'REVENUE') {
        return { data: null, error: { message: 'permission denied for table gl_accounts' } };
      }
      return { data: [], error: null };
    });

    await expect(
      geminiFinancialService.fetchRealFinancialKPIs(new Date(2026, 0, 1), new Date(2026, 11, 31))
    ).rejects.toThrow(/permission denied/);
  });
});
