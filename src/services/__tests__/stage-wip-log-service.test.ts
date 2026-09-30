// #278 / M194: the WIP service may send only editable inputs and must close a period
// through the audited RPC. The real service runs against a capturing fake client; the
// database guard itself is proven separately by docs/db/stage-wip-278.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../lib/supabase', () => ({
  getSupabase: vi.fn(),
  getTenantId: vi.fn(),
}))
vi.mock('../../lib/performance-monitor', () => ({
  PerformanceMonitor: { measure: (_label: string, fn: () => Promise<unknown>) => fn() },
}))
vi.mock('../manufacturing', () => ({
  updateManufacturingOrderStatus: vi.fn(),
  createManufacturingOrder: vi.fn(),
  getManufacturingOrderById: vi.fn(),
}))
vi.mock('../manufacturing/manufacturing-helpers', () => ({
  isTableNotFoundError: vi.fn(() => false),
  isRelationshipNotFoundError: vi.fn(() => false),
  handleTableNotFound: vi.fn(() => []),
  fetchOrdersSimple: vi.fn(),
  extractItemIds: vi.fn(() => []),
  fetchRelatedItems: vi.fn(),
  attachRelatedItems: vi.fn(),
  normalizeOrderStatuses: vi.fn(),
}))

import { getSupabase, getTenantId } from '../../lib/supabase'
import { fetchOrdersSimple } from '../manufacturing/manufacturing-helpers'
import {
  stageWipLogService,
  subscribeToItems,
  subscribeToManufacturingOrders,
} from '../supabase-service'

type Call = {
  kind: 'insert' | 'update' | 'rpc'
  table?: string
  payload?: Record<string, unknown>
  name?: string
  args?: Record<string, unknown>
  eq?: [string, unknown]
}

const calls: Call[] = []

function writeQuery(kind: 'insert' | 'update', table: string, payload: Record<string, unknown>) {
  const record: Call = { kind, table, payload }
  calls.push(record)
  const query = {
    eq: (column: string, value: unknown) => {
      record.eq = [column, value]
      return query
    },
    select: () => query,
    single: async () => ({ data: { id: 'row' }, error: null }),
  }
  return query
}

function capturingClient() {
  return {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => writeQuery('insert', table, payload),
      update: (payload: Record<string, unknown>) => writeQuery('update', table, payload),
    }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ kind: 'rpc', name, args })
      return { data: { id: args.p_wip_id, is_closed: true }, error: null }
    },
  }
}

const EDITABLE = {
  units_beginning_wip: 1,
  units_started: 2,
  units_completed: 3,
  units_ending_wip: 4,
  material_completion_pct: 100,
  conversion_completion_pct: 50,
  cost_beginning_wip: 5,
  cost_labor: 6,
  cost_overhead: 7,
  notes: 'n',
}
const IDENTITY = {
  mo_id: 'mo-1',
  stage_id: 'st-1',
  period_start: '2026-01-01',
  period_end: '2026-01-31',
}
// Server-owned columns that a stale or hostile caller could still put in the object.
const PROTECTED = {
  id: 'evil-id',
  org_id: 'evil-org',
  cost_material: 999,
  cost_total: 1,
  equivalent_units_material: 1,
  equivalent_units_conversion: 1,
  cost_per_eu_material: 1,
  cost_per_eu_conversion: 1,
  cost_completed_transferred: 1,
  cost_ending_wip: 1,
  cost_transferred_in: 55,
  is_closed: true,
  closed_at: 'now',
  closed_by: 'someone',
  created_by: 'someone',
  updated_by: 'someone',
}

describe('stageWipLogService write payloads', () => {
  beforeEach(() => {
    calls.length = 0
    vi.mocked(getSupabase).mockReturnValue(capturingClient() as never)
    vi.mocked(getTenantId).mockResolvedValue('tenant-1')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ORG_ID: 'cfg-org' }) })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('create sends the editable inputs and the identity, takes org_id from the tenant and no protected column', async () => {
    await stageWipLogService.create({ ...EDITABLE, ...IDENTITY, ...PROTECTED })

    const insert = calls.find((call) => call.kind === 'insert')!
    expect(insert.table).toBe('stage_wip_log')
    expect(Object.keys(insert.payload!).sort()).toEqual(
      [...Object.keys(EDITABLE), ...Object.keys(IDENTITY), 'org_id'].sort()
    )
    expect(insert.payload).toMatchObject({ ...EDITABLE, ...IDENTITY, org_id: 'tenant-1' })
  })

  it('create sends only the editable fields that were provided', async () => {
    await stageWipLogService.create({ ...IDENTITY, cost_labor: 6 })

    const insert = calls.find((call) => call.kind === 'insert')!
    expect(insert.payload).toEqual({ ...IDENTITY, cost_labor: 6, org_id: 'tenant-1' })
  })

  it('update sends only the editable inputs plus updated_at, never identity, dates, cost_material or close fields', async () => {
    await stageWipLogService.update('wip-1', { ...EDITABLE, ...IDENTITY, ...PROTECTED })

    const update = calls.find((call) => call.kind === 'update')!
    expect(update.table).toBe('stage_wip_log')
    expect(Object.keys(update.payload!).sort()).toEqual([...Object.keys(EDITABLE), 'updated_at'].sort())
    expect(update.payload).toMatchObject(EDITABLE)
    expect(update.eq).toEqual(['id', 'wip-1'])
  })

  it('closePeriod goes through the audited RPC only and forwards nothing but the row id', async () => {
    const closePeriod = stageWipLogService.closePeriod as (id: string, closedBy?: string) => Promise<unknown>

    const result = await closePeriod('wip-9', 'someone-else')

    expect(calls).toEqual([{ kind: 'rpc', name: 'rpc_close_stage_wip_194', args: { p_wip_id: 'wip-9' } }])
    expect(result).toEqual({ id: 'wip-9', is_closed: true })
  })

  it('rethrows a database rejection unchanged so the form can show it', async () => {
    const rejection = { message: 'WIP_POSTED_MATERIAL_IMMUTABLE', code: 'P0001' }
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(getSupabase).mockReturnValue({
      from: () => ({
        update: () => ({
          eq: () => ({ select: () => ({ single: async () => ({ data: null, error: rejection }) }) }),
        }),
      }),
      rpc: async () => ({ data: null, error: rejection }),
    } as never)

    await expect(stageWipLogService.update('wip-1', { cost_labor: 1 })).rejects.toBe(rejection)
    await expect(stageWipLogService.closePeriod('wip-1')).rejects.toBe(rejection)

    errorSpy.mockRestore()
  })
})

// A realtime change refreshes a list without awaiting it, so a failed refresh must be
// handled inside the subscription: vitest fails the run on any unhandled rejection.
function subscriptionClient(readRows: () => Promise<{ data: unknown; error: unknown }>) {
  let onChange: (() => void) | undefined
  const channel = {
    on: (_event: string, _filter: unknown, handler: () => void) => {
      onChange = handler
      return channel
    },
    subscribe: () => 'subscription',
  }
  return {
    client: {
      channel: () => channel,
      from: () => ({ select: () => ({ order: readRows }) }),
    },
    fireChange: () => onChange!(),
  }
}

describe('realtime subscription refresh', () => {
  beforeEach(() => {
    vi.mocked(fetchOrdersSimple).mockReset()
  })

  it('items: a change refreshes the list and hands it to the callback', async () => {
    const rows = [{ id: 'p1' }]
    const { client, fireChange } = subscriptionClient(async () => ({ data: rows, error: null }))
    vi.mocked(getSupabase).mockReturnValue(client as never)
    const callback = vi.fn()

    expect(subscribeToItems(callback)).toBe('subscription')
    fireChange()

    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(rows))
  })

  it('items: a failed refresh is logged and does not become an unhandled rejection', async () => {
    const failure = new Error('refresh failed')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client, fireChange } = subscriptionClient(async () => ({ data: null, error: failure }))
    vi.mocked(getSupabase).mockReturnValue(client as never)
    const callback = vi.fn()

    subscribeToItems(callback)
    fireChange()

    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('items'), failure))
    expect(callback).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('manufacturing orders: a change refreshes the orders and hands them to the callback', async () => {
    const orders = [{ id: 'mo-1' }]
    vi.mocked(fetchOrdersSimple).mockResolvedValue(orders as never)
    const { client, fireChange } = subscriptionClient(async () => ({ data: null, error: null }))
    vi.mocked(getSupabase).mockReturnValue(client as never)
    const callback = vi.fn()

    expect(subscribeToManufacturingOrders(callback)).toBe('subscription')
    fireChange()

    await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(orders))
  })

  it('manufacturing orders: a failed refresh is logged and does not become an unhandled rejection', async () => {
    const failure = new Error('refresh failed')
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(fetchOrdersSimple).mockRejectedValue(failure)
    const { client, fireChange } = subscriptionClient(async () => ({ data: null, error: null }))
    vi.mocked(getSupabase).mockReturnValue(client as never)
    const callback = vi.fn()

    subscribeToManufacturingOrders(callback)
    fireChange()

    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('manufacturing orders'), failure)
    )
    expect(callback).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
