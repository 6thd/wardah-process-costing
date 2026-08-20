import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@/lib/supabase';
import { saveStockAdjustmentDraft } from '../stockAdjustmentSave';
import type { AdjustmentFormState } from '../stockAdjustmentHelpers';

type SaveHarnessOptions = {
  createError?: Error | null;
  updateError?: Error | null;
  deleteError?: Error | null;
  itemsError?: Error | null;
};

type HeaderWrite = {
  action: 'insert' | 'update';
  payload: Record<string, unknown>;
};

type ItemWrite = {
  payload: Array<Record<string, unknown>>;
};

function makeForm(): AdjustmentFormState {
  return {
    adjustment_date: '2026-08-20',
    adjustment_type: 'PHYSICAL_COUNT',
    reason: 'Focused helper test',
    reference_number: 'REF-137',
    warehouse_id: 'wh-default',
    increase_account_id: 'acct-inc',
    decrease_account_id: 'acct-dec',
    items: [
      {
        id: 'item-1',
        product_id: 'product-1',
        product: {},
        warehouse_id: 'wh-item',
        current_qty: 10,
        new_qty: 13,
        difference_qty: 3,
        current_rate: 5,
        value_difference: 15,
        reason: 'count gain',
      },
      {
        id: 'item-2',
        product_id: 'product-2',
        product: {},
        warehouse_id: '',
        current_qty: 8,
        new_qty: 6,
        difference_qty: -2,
        current_rate: 7,
        value_difference: -14,
        reason: '',
      },
    ],
  };
}

function createSaveHarness(options: SaveHarnessOptions = {}) {
  const operations: string[] = [];
  const headerWrites: HeaderWrite[] = [];
  const itemWrites: ItemWrite[] = [];

  const createResult = {
    data: { id: 'adj-created' },
    error: options.createError ?? null,
  };
  const updateResult = {
    data: { id: 'adj-existing' },
    error: options.updateError ?? null,
  };

  const from = vi.fn((table: string) => {
    if (table === 'stock_adjustments') {
      return {
        insert: vi.fn((payload: Record<string, unknown>) => {
          operations.push('insert:stock_adjustments');
          headerWrites.push({ action: 'insert', payload });
          return {
            select: vi.fn(() => ({
              single: vi.fn(async () => createResult),
            })),
          };
        }),
        update: vi.fn((payload: Record<string, unknown>) => {
          operations.push('update:stock_adjustments');
          headerWrites.push({ action: 'update', payload });
          const chain = {
            eq: vi.fn(() => chain),
            select: vi.fn(() => ({
              single: vi.fn(async () => updateResult),
            })),
          };
          return chain;
        }),
      };
    }

    if (table === 'stock_adjustment_items') {
      return {
        delete: vi.fn(() => {
          operations.push('delete:stock_adjustment_items');
          const result = { data: null, error: options.deleteError ?? null };
          const chain = {
            eq: vi.fn(() => chain),
            then: (
              resolve: (value: typeof result) => unknown,
              reject: (reason: unknown) => unknown,
            ) => Promise.resolve(result).then(resolve, reject),
          };
          return chain;
        }),
        insert: vi.fn(async (payload: Array<Record<string, unknown>>) => {
          operations.push('insert:stock_adjustment_items');
          itemWrites.push({ payload });
          return { data: null, error: options.itemsError ?? null };
        }),
      };
    }

    throw new Error(`Unexpected table: ${table}`);
  });

  return {
    supabase: { from } as unknown as SupabaseClient<Database>,
    operations,
    headerWrites,
    itemWrites,
  };
}

describe('saveStockAdjustmentDraft', () => {
  it('rejects a create header failure before attempting item writes', async () => {
    const error = new Error('create failed');
    const harness = createSaveHarness({ createError: error });

    await expect(saveStockAdjustmentDraft({
      supabase: harness.supabase,
      form: makeForm(),
      orgId: 'org-1',
      userId: 'user-1',
      selectedAdjustment: null,
    })).rejects.toBe(error);

    expect(harness.operations).toEqual(['insert:stock_adjustments']);
    expect(harness.itemWrites).toHaveLength(0);
  });

  it('rejects an edit header failure before delete or replacement-item writes', async () => {
    const error = new Error('update failed');
    const harness = createSaveHarness({ updateError: error });

    await expect(saveStockAdjustmentDraft({
      supabase: harness.supabase,
      form: makeForm(),
      orgId: 'org-1',
      userId: 'user-1',
      selectedAdjustment: { id: 'adj-existing', isEditing: true },
    })).rejects.toBe(error);

    expect(harness.operations).toEqual(['update:stock_adjustments']);
    expect(harness.itemWrites).toHaveLength(0);
  });

  it('rejects an edit delete failure before inserting replacement items', async () => {
    const error = new Error('delete failed');
    const harness = createSaveHarness({ deleteError: error });

    await expect(saveStockAdjustmentDraft({
      supabase: harness.supabase,
      form: makeForm(),
      orgId: 'org-1',
      userId: 'user-1',
      selectedAdjustment: { id: 'adj-existing', isEditing: true },
    })).rejects.toBe(error);

    expect(harness.operations).toEqual([
      'update:stock_adjustments',
      'delete:stock_adjustment_items',
    ]);
    expect(harness.itemWrites).toHaveLength(0);
  });

  it('surfaces an item-insert failure to the caller', async () => {
    const error = new Error('items failed');
    const harness = createSaveHarness({ itemsError: error });

    await expect(saveStockAdjustmentDraft({
      supabase: harness.supabase,
      form: makeForm(),
      orgId: 'org-1',
      userId: 'user-1',
      selectedAdjustment: null,
    })).rejects.toBe(error);

    expect(harness.operations).toEqual([
      'insert:stock_adjustments',
      'insert:stock_adjustment_items',
    ]);
  });

  it.each([
    ['create', null, 'insert'],
    ['edit', { id: 'adj-existing', isEditing: true }, 'update'],
  ] as const)('propagates calculated totals into the %s header payload', async (_mode, selectedAdjustment, action) => {
    const harness = createSaveHarness();

    await saveStockAdjustmentDraft({
      supabase: harness.supabase,
      form: makeForm(),
      orgId: 'org-1',
      userId: 'user-1',
      selectedAdjustment,
    });

    const header = harness.headerWrites.find((write) => write.action === action)?.payload;
    expect(header).toEqual(expect.objectContaining({
      total_items: 2,
      total_qty_difference: 1,
      total_value_difference: 1,
    }));
  });

  it('uses the form warehouse when an item has no warehouse_id', async () => {
    const harness = createSaveHarness();

    await saveStockAdjustmentDraft({
      supabase: harness.supabase,
      form: makeForm(),
      orgId: 'org-1',
      userId: 'user-1',
      selectedAdjustment: null,
    });

    expect(harness.itemWrites).toHaveLength(1);
    expect(harness.itemWrites[0].payload).toEqual([
      expect.objectContaining({
        product_id: 'product-1',
        warehouse_id: 'wh-item',
      }),
      expect.objectContaining({
        product_id: 'product-2',
        warehouse_id: 'wh-default',
      }),
    ]);
  });
});
