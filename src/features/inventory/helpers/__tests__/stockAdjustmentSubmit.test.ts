import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Database } from '@/lib/supabase'
import { submitStockAdjustmentDraft } from '../stockAdjustmentSubmit'

type HarnessOptions = {
  adjustment?: { status: string; warehouse_id: string | null } | null
  adjustmentError?: { message: string } | null
  items?: ReadonlyArray<{ product_id: string }> | null
  itemsError?: { message: string } | null
  rpcData?: { success?: boolean; error?: string } | null
  rpcError?: { message: string } | null
}

const defaultAdjustment = {
  status: 'DRAFT',
  warehouse_id: 'warehouse-1',
}

const defaultItems = [
  { product_id: 'product-increase' },
  { product_id: 'product-decrease' },
]

function createSubmitHarness(options: HarnessOptions = {}) {
  const operations: string[] = []
  const directMutations: string[] = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []

  const adjustmentResult = {
    data: options.adjustment === undefined ? defaultAdjustment : options.adjustment,
    error: options.adjustmentError ?? null,
  }
  const itemsResult = {
    data: options.items === undefined ? defaultItems : options.items,
    error: options.itemsError ?? null,
  }

  const from = vi.fn((table: string) => {
    if (table === 'stock_adjustments') {
      return {
        select: vi.fn(() => {
          operations.push('select:adjustment')
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                single: vi.fn(async () => adjustmentResult),
              })),
            })),
          }
        }),
        update: vi.fn(() => {
          directMutations.push('stock_adjustments:update')
          throw new Error('direct stock_adjustments mutation must not occur')
        }),
      }
    }

    if (table === 'stock_adjustment_items') {
      return {
        select: vi.fn(() => {
          operations.push('select:items')
          return {
            eq: vi.fn(() => ({
              eq: vi.fn(async () => itemsResult),
            })),
          }
        }),
      }
    }

    if (table === 'stock_ledger_entries') {
      return {
        insert: vi.fn(() => {
          directMutations.push('stock_ledger_entries:insert')
          throw new Error('direct ledger mutation must not occur')
        }),
      }
    }

    throw new Error(`Unexpected table: ${table}`)
  })

  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    operations.push(`rpc:${name}`)
    rpcCalls.push({ name, args })
    return {
      data: options.rpcData === undefined ? { success: true } : options.rpcData,
      error: options.rpcError ?? null,
    }
  })

  return {
    supabase: { from, rpc } as unknown as SupabaseClient<Database>,
    operations,
    directMutations,
    rpcCalls,
  }
}

function submit(
  harness: ReturnType<typeof createSubmitHarness>,
  overrides: { validateUom?: () => string | null } = {},
) {
  return submitStockAdjustmentDraft({
    supabase: harness.supabase,
    adjustmentId: 'adjustment-135',
    orgId: 'org-1',
    userId: 'user-1',
    validateUom: overrides.validateUom ?? (() => null),
    onJournalWarning: vi.fn(),
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('stockAdjustmentSubmit atomic RPC contract', () => {
  it.each([
    ['missing adjustment', { adjustment: null }, 'لم يتم العثور على التسوية'],
    ['adjustment lookup failure', { adjustmentError: { message: 'lookup failed' } }, 'لم يتم العثور على التسوية'],
    ['non-draft adjustment', { adjustment: { ...defaultAdjustment, status: 'SUBMITTED' } }, 'يمكن فقط ترحيل التسويات بحالة مسودة'],
    ['missing items', { items: [] }, 'لم يتم العثور على بنود التسوية'],
    ['item lookup failure', { itemsError: { message: 'items failed' } }, 'لم يتم العثور على بنود التسوية'],
  ] as const)('fails before the mutation RPC for %s', async (_case, options, message) => {
    const harness = createSubmitHarness(options)

    await expect(submit(harness)).resolves.toEqual({ ok: false, message })
    expect(harness.rpcCalls).toEqual([])
    expect(harness.directMutations).toEqual([])
  })

  it('fails closed on UoM validation before the mutation RPC', async () => {
    const harness = createSubmitHarness()

    await expect(submit(harness, { validateUom: () => 'UoM is not ready' }))
      .resolves.toEqual({ ok: false, message: 'UoM is not ready' })

    expect(harness.operations).toEqual(['select:adjustment', 'select:items'])
    expect(harness.rpcCalls).toEqual([])
    expect(harness.directMutations).toEqual([])
  })

  it('requires a warehouse before the mutation RPC', async () => {
    const harness = createSubmitHarness({ adjustment: { ...defaultAdjustment, warehouse_id: null } })

    await expect(submit(harness)).resolves.toEqual({
      ok: false,
      message: 'لم يتم تحديد المخزن في التسوية',
    })
    expect(harness.rpcCalls).toEqual([])
    expect(harness.directMutations).toEqual([])
  })

  it('submits exclusively through the canonical atomic server RPC', async () => {
    const harness = createSubmitHarness()

    await expect(submit(harness)).resolves.toEqual({ ok: true })

    expect(harness.operations).toEqual([
      'select:adjustment',
      'select:items',
      'rpc:rpc_submit_stock_adjustment',
    ])
    expect(harness.rpcCalls).toEqual([{
      name: 'rpc_submit_stock_adjustment',
      args: { p_adjustment_id: 'adjustment-135' },
    }])
    expect(harness.directMutations).toEqual([])
  })

  it('fails closed when the atomic RPC transport fails', async () => {
    const harness = createSubmitHarness({ rpcError: { message: 'permission denied' } })

    await expect(submit(harness)).resolves.toEqual({ ok: false, message: 'permission denied' })
    expect(harness.rpcCalls).toHaveLength(1)
    expect(harness.directMutations).toEqual([])
  })

  it('fails closed when the atomic RPC reports a business failure', async () => {
    const harness = createSubmitHarness({ rpcData: { success: false, error: 'posting refused' } })

    await expect(submit(harness)).resolves.toEqual({ ok: false, message: 'posting refused' })
    expect(harness.rpcCalls).toHaveLength(1)
    expect(harness.directMutations).toEqual([])
  })

  it('uses a stable fallback when the RPC returns no usable result', async () => {
    const harness = createSubmitHarness({ rpcData: null })

    await expect(submit(harness)).resolves.toEqual({ ok: false, message: 'فشل ترحيل التسوية' })
    expect(harness.directMutations).toEqual([])
  })
})
