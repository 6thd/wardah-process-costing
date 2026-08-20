import type { SupabaseClient } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/supabase';
import { submitStockAdjustmentDraft } from '../stockAdjustmentSubmit';

type HarnessOptions = {
  adjustment?: Record<string, unknown> | null;
  adjustmentError?: Error | null;
  items?: ReadonlyArray<Record<string, unknown>> | null;
  itemsError?: Error | null;
  ledgerError?: Error | null;
  warehouseAccounts?: Array<string | null>;
  rpcData?: { success?: boolean; error?: string } | null;
  rpcError?: Error | null;
  updateError?: Error | null;
};

const defaultAdjustment = {
  status: 'DRAFT',
  warehouse_id: 'warehouse-1',
  posting_date: '2026-08-20',
  adjustment_number: 'ADJ-135',
  reference_number: 'REF-135',
  adjustment_type: 'PHYSICAL_COUNT',
  increase_account_id: 'increase-account',
  decrease_account_id: 'decrease-account',
  reason: 'Focused submit helper test',
};

const defaultItems = [
  {
    product_id: 'product-increase',
    warehouse_id: null,
    difference_qty: 3,
    new_qty: 13,
    current_rate: 5,
    value_difference: 15,
  },
  {
    product_id: 'product-decrease',
    warehouse_id: 'warehouse-item',
    difference_qty: -2,
    new_qty: 6,
    current_rate: 7,
    value_difference: -14,
  },
];

function createSubmitHarness(options: HarnessOptions = {}) {
  const operations: string[] = [];
  const ledgerWrites: Array<Array<Record<string, unknown>>> = [];
  const statusWrites: Array<Record<string, unknown>> = [];
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const warehouseAccounts = [...(options.warehouseAccounts ?? ['inventory-account', 'inventory-account'])];

  const adjustmentResult = {
    data: options.adjustment === undefined ? defaultAdjustment : options.adjustment,
    error: options.adjustmentError ?? null,
  };
  const itemsResult = {
    data: options.items === undefined ? defaultItems : options.items,
    error: options.itemsError ?? null,
  };

  const from = vi.fn((table: string) => {
    if (table === 'stock_adjustments') {
      return {
        select: vi.fn(() => {
          operations.push('select:adjustment');
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => adjustmentResult),
              })),
            })),
          };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          operations.push('update:submitted');
          statusWrites.push(payload);
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(async () => ({ data: null, error: options.updateError ?? null })),
            })),
          };
        }),
      };
    }

    if (table === 'stock_adjustment_items') {
      return {
        select: vi.fn(() => {
          operations.push('select:items');
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(async () => itemsResult),
            })),
          };
        }),
      };
    }

    if (table === 'stock_ledger_entries') {
      return {
        insert: vi.fn(async (payload: Array<Record<string, unknown>>) => {
          operations.push('insert:ledger');
          ledgerWrites.push(payload);
          return { data: null, error: options.ledgerError ?? null };
        }),
      };
    }

    if (table === 'warehouses') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              single: vi.fn(async () => {
                operations.push('select:warehouse');
                return {
                  data: { inventory_account_id: warehouseAccounts.shift() ?? null },
                  error: null,
                };
              }),
            })),
          })),
        })),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    operations.push('rpc:journal');
    rpcCalls.push({ name, args });
    return {
      data: options.rpcData === undefined ? { success: true } : options.rpcData,
      error: options.rpcError ?? null,
    };
  });

  return {
    supabase: { from, rpc } as unknown as SupabaseClient<Database>,
    operations,
    ledgerWrites,
    statusWrites,
    rpcCalls,
  };
}

function submit(
  harness: ReturnType<typeof createSubmitHarness>,
  overrides: {
    validateUom?: () => string | null;
    onJournalWarning?: (message: string) => void;
  } = {},
) {
  return submitStockAdjustmentDraft({
    supabase: harness.supabase,
    adjustmentId: 'adjustment-135',
    orgId: 'org-1',
    userId: 'user-1',
    validateUom: overrides.validateUom ?? (() => null),
    onJournalWarning: overrides.onJournalWarning ?? vi.fn(),
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('submitStockAdjustmentDraft', () => {
  it.each([
    ['missing adjustment', { adjustment: null }, 'لم يتم العثور على التسوية'],
    ['adjustment lookup failure', { adjustmentError: new Error('lookup failed') }, 'لم يتم العثور على التسوية'],
    ['non-draft adjustment', { adjustment: { ...defaultAdjustment, status: 'SUBMITTED' } }, 'يمكن فقط ترحيل التسويات بحالة مسودة'],
    ['missing items', { items: [] }, 'لم يتم العثور على بنود التسوية'],
    ['item lookup failure', { itemsError: new Error('items failed') }, 'لم يتم العثور على بنود التسوية'],
  ] as const)('returns before ledger writes for %s', async (_case, options, message) => {
    const harness = createSubmitHarness(options);

    await expect(submit(harness)).resolves.toEqual({ ok: false, message });
    expect(harness.operations).not.toContain('insert:ledger');
    expect(harness.operations).not.toContain('update:submitted');
  });

  it('fails closed on UoM validation before ledger writes', async () => {
    const harness = createSubmitHarness();

    await expect(submit(harness, {
      validateUom: () => 'UoM is not ready',
    })).resolves.toEqual({ ok: false, message: 'UoM is not ready' });

    expect(harness.operations).toEqual(['select:adjustment', 'select:items']);
  });

  it('requires an adjustment warehouse before ledger writes', async () => {
    const harness = createSubmitHarness({
      adjustment: { ...defaultAdjustment, warehouse_id: null },
    });

    await expect(submit(harness)).resolves.toEqual({
      ok: false,
      message: 'لم يتم تحديد المخزن في التسوية',
    });
    expect(harness.operations).not.toContain('insert:ledger');
  });

  it('creates ledger and journal entries in the locked order before marking submitted', async () => {
    const harness = createSubmitHarness();

    await expect(submit(harness)).resolves.toEqual({ ok: true });

    expect(harness.operations).toEqual([
      'select:adjustment',
      'select:items',
      'insert:ledger',
      'select:warehouse',
      'select:warehouse',
      'rpc:journal',
      'update:submitted',
    ]);
    expect(harness.ledgerWrites[0]).toEqual([
      expect.objectContaining({
        org_id: 'org-1',
        product_id: 'product-increase',
        warehouse_id: 'warehouse-1',
        actual_qty: 3,
        incoming_rate: 5,
        outgoing_rate: 0,
      }),
      expect.objectContaining({
        org_id: 'org-1',
        product_id: 'product-decrease',
        warehouse_id: 'warehouse-item',
        actual_qty: -2,
        incoming_rate: 0,
        outgoing_rate: 7,
      }),
    ]);
    expect(harness.rpcCalls).toEqual([{
      name: 'rpc_create_journal_entry',
      args: {
        p_payload: expect.objectContaining({
          org_id: 'org-1',
          idempotency_key: 'stock-adj-adjustment-135',
          lines: [
            expect.objectContaining({ line_number: 1, account_id: 'inventory-account', debit: 15, credit: 0 }),
            expect.objectContaining({ line_number: 2, account_id: 'increase-account', debit: 0, credit: 15 }),
            expect.objectContaining({ line_number: 3, account_id: 'decrease-account', debit: 14, credit: 0 }),
            expect.objectContaining({ line_number: 4, account_id: 'inventory-account', debit: 0, credit: 14 }),
          ],
        }),
      },
    }]);
    expect(harness.statusWrites).toEqual([
      expect.objectContaining({ status: 'SUBMITTED', submitted_by: 'user-1' }),
    ]);
  });

  it('surfaces a ledger failure before journal or status writes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const harness = createSubmitHarness({ ledgerError: new Error('ledger failed') });

    await expect(submit(harness)).rejects.toThrow('فشل في إنشاء قيود المخزون: ledger failed');
    expect(harness.operations).not.toContain('rpc:journal');
    expect(harness.operations).not.toContain('update:submitted');
  });

  it.each([
    ['RPC transport failure', { rpcError: new Error('rpc failed') }, 'فشل في إنشاء القيد المحاسبي: rpc failed'],
    ['RPC business failure', { rpcData: { success: false, error: 'posting refused' } }, 'posting refused'],
  ] as const)('warns but still marks submitted after %s', async (_case, options, warning) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onJournalWarning = vi.fn();
    const harness = createSubmitHarness(options);

    await expect(submit(harness, { onJournalWarning })).resolves.toEqual({ ok: true });
    expect(onJournalWarning).toHaveBeenCalledWith(warning);
    expect(harness.operations.at(-1)).toBe('update:submitted');
  });

  it('skips the journal RPC when no journal lines can be built', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const harness = createSubmitHarness({ warehouseAccounts: [null, null] });

    await expect(submit(harness)).resolves.toEqual({ ok: true });
    expect(harness.operations).not.toContain('rpc:journal');
    expect(harness.operations.at(-1)).toBe('update:submitted');
  });

  it('surfaces a submitted-status update failure after successful accounting writes', async () => {
    const updateError = new Error('status update failed');
    const harness = createSubmitHarness({ updateError });

    await expect(submit(harness)).rejects.toBe(updateError);
    expect(harness.operations).toContain('rpc:journal');
    expect(harness.operations.at(-1)).toBe('update:submitted');
  });
});
