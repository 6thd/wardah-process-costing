import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StockController, type StockMove } from '../StockController'
import type { BaseDocument } from '../BaseController'

/**
 * Guards the tenant-scoping hardening on the legacy stock write path: every
 * SLE/bin/product read and write must be pinned to the document's org_id, and
 * the path must fail closed when no organization context is present. CI going
 * green does not prove a future edit keeps org_id on each query — these tests do.
 */

interface Recorded {
  table: string
  type: 'select' | 'insert' | 'update' | 'delete'
  filters: Array<[string, unknown]>
  payload?: Record<string, unknown>
  recordOnThen?: boolean
}

const h = vi.hoisted(() => ({
  recorded: [] as Recorded[],
  singleQueues: {} as Record<string, Array<{ data: unknown; error: unknown }>>,
}))

vi.mock('@/lib/supabase', () => {
  function from(table: string) {
    const rec: Recorded = { table, type: 'select', filters: [] }
    const builder: Record<string, unknown> = {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      is: () => builder,
      in: () => builder,
      eq: (col: string, val: unknown) => {
        rec.filters.push([col, val])
        return builder
      },
      insert: (payload: Record<string, unknown>) => {
        rec.type = 'insert'
        rec.payload = payload
        h.recorded.push(rec)
        return builder
      },
      update: (payload: Record<string, unknown>) => {
        rec.type = 'update'
        rec.payload = payload
        rec.recordOnThen = true
        return builder
      },
      delete: () => {
        rec.type = 'delete'
        return builder
      },
      single: () => {
        h.recorded.push(rec)
        const queue = h.singleQueues[table] ?? []
        return Promise.resolve(queue.length ? queue.shift() : { data: null, error: null })
      },
      then: (onFulfilled: (v: unknown) => unknown, onRejected?: (e: unknown) => unknown) => {
        if (rec.recordOnThen) {
          h.recorded.push(rec)
          rec.recordOnThen = false
        }
        return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected)
      },
    }
    return builder
  }
  return { supabase: { from } }
})

class TestStockController extends StockController<BaseDocument> {
  private readonly moves: StockMove[]

  constructor(doc: Partial<BaseDocument>, moves: StockMove[]) {
    super('test_documents', doc)
    this.moves = moves
  }

  protected async getStockMoves(): Promise<StockMove[]> {
    return this.moves
  }

  runSubmit(): Promise<void> {
    return this.on_submit()
  }

  runCancel(): Promise<void> {
    return this.on_cancel()
  }

  runValidateAvailability(moves: StockMove[]): Promise<void> {
    return this.validateStockAvailability(moves)
  }

  runGetStockBalance(productId: string, warehouseId: string) {
    return this.getStockBalance(productId, warehouseId)
  }
}

function move(overrides: Partial<StockMove> = {}): StockMove {
  return {
    product_id: 'product-1',
    warehouse_id: 'warehouse-1',
    quantity: 5,
    rate: 10,
    posting_date: new Date('2026-07-22T00:00:00.000Z'),
    voucher_type: 'Goods Receipt',
    voucher_id: 'gr-1',
    ...overrides,
  }
}

function recordsFor(table: string, type: Recorded['type']) {
  return h.recorded.filter((entry) => entry.table === table && entry.type === type)
}

function hasFilter(record: Recorded, col: string, val: unknown) {
  return record.filters.some(([c, v]) => c === col && v === val)
}

const ORG = 'org-1'

describe('StockController org scoping', () => {
  beforeEach(() => {
    h.recorded.length = 0
    h.singleQueues = {}
  })

  it('fails closed when the document has no organization context', async () => {
    const controller = new TestStockController({}, [move()])

    await expect(controller.runSubmit()).rejects.toThrow('ORG_CONTEXT_REQUIRED')
    await expect(controller.runGetStockBalance('product-1', 'warehouse-1')).rejects.toThrow(
      'ORG_CONTEXT_REQUIRED',
    )
    // No query may run without a tenant.
    expect(h.recorded).toHaveLength(0)
  })

  it('creates an org-scoped SLE and bin on submit', async () => {
    // Fresh product+warehouse: no prior SLE, no existing bin -> insert paths.
    h.singleQueues = {
      stock_ledger_entries: [{ data: null, error: null }],
      bins: [{ data: null, error: null }],
    }
    const controller = new TestStockController({ org_id: ORG }, [move({ quantity: 5, rate: 10 })])

    await controller.runSubmit()

    const sleRead = recordsFor('stock_ledger_entries', 'select')[0]
    expect(hasFilter(sleRead, 'org_id', ORG)).toBe(true)

    const sleInsert = recordsFor('stock_ledger_entries', 'insert')[0]
    expect(sleInsert.payload?.org_id).toBe(ORG)
    expect(sleInsert.payload?.actual_qty).toBe(5)

    const binInsert = recordsFor('bins', 'insert')[0]
    expect(binInsert.payload?.org_id).toBe(ORG)
  })

  it('keeps bin reads and updates pinned to the same organization', async () => {
    h.singleQueues = {
      stock_ledger_entries: [
        { data: { qty_after_transaction: 4, valuation_rate: 10, stock_value: 40 }, error: null },
        { data: { valuation_rate: 10, stock_value: 60 }, error: null },
      ],
      bins: [{ data: { actual_qty: 4 }, error: null }],
    }
    const controller = new TestStockController({ org_id: ORG }, [move({ quantity: 2, rate: 10 })])

    await controller.runSubmit()

    const binRead = recordsFor('bins', 'select')[0]
    expect(hasFilter(binRead, 'org_id', ORG)).toBe(true)

    const binUpdate = recordsFor('bins', 'update')[0]
    expect(binUpdate).toBeDefined()
    expect(hasFilter(binUpdate, 'org_id', ORG)).toBe(true)
    expect(hasFilter(binUpdate, 'product_id', 'product-1')).toBe(true)
  })

  it('reverses the movement within the same organization on cancel', async () => {
    h.singleQueues = {
      stock_ledger_entries: [{ data: { qty_after_transaction: 5, valuation_rate: 10, stock_value: 50 }, error: null }],
      bins: [{ data: { actual_qty: 5 }, error: null }, { data: { valuation_rate: 10, stock_value: 50 }, error: null }],
    }
    const controller = new TestStockController({ org_id: ORG }, [move({ quantity: 5 })])

    await controller.runCancel()

    const sleInsert = recordsFor('stock_ledger_entries', 'insert')[0]
    expect(sleInsert.payload?.org_id).toBe(ORG)
    // Cancel negates the original movement.
    expect(sleInsert.payload?.actual_qty).toBe(-5)
  })

  it('cannot read another organization when validating availability', async () => {
    // Balance (2) is below the requested outgoing quantity (10) -> product lookup.
    h.singleQueues = {
      bins: [{ data: { actual_qty: 2, valuation_rate: 10, stock_value: 20 }, error: null }],
      products: [{ data: { name: 'Widget' }, error: null }],
    }
    const controller = new TestStockController({ org_id: ORG }, [])

    await expect(
      controller.runValidateAvailability([move({ quantity: -10 })]),
    ).rejects.toThrow(/Insufficient stock/)

    const productRead = recordsFor('products', 'select')[0]
    expect(hasFilter(productRead, 'org_id', ORG)).toBe(true)
    expect(hasFilter(productRead, 'id', 'product-1')).toBe(true)
  })
})
