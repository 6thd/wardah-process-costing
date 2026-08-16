/**
 * Round 7 P1: per-resource read gating on the live StageCostingPanel.
 *
 * Prior to this round, manufacturing.stage_costs.read (the key ModuleGuard
 * checks to allow entry to /manufacturing/process-costing at all) was
 * treated as sufficient for every reference-data query on the screen —
 * manufacturing orders, manufacturing stages, and work centers included.
 * Each now checks its own exact catalog key, and the panel additionally
 * guards against two failure modes TanStack Query does not solve by itself:
 *
 *  - "cached-data revocation": a query's `enabled` flag flipping to false
 *    pauses future fetches, but does NOT erase what an earlier authorized
 *    fetch already stored in cache — a naive read of `data` would keep
 *    showing rows from before a mid-session revocation.
 *  - "in-flight revocation": a request already in flight when permission is
 *    revoked must not populate the screen when it resolves afterward.
 *
 * These tests render the real StageCostingPanel (no mocked hook doubles for
 * useManufacturingOrders) against a real QueryClient, with a controllable
 * usePermissions() mock and a controllable manufacturingService.getAll()
 * spy standing in for the network boundary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '../../../test/test-utils'
import StageCostingPanel from '../stage-costing-panel'

// Action registration is exercised separately in
// stage-costing-actions-permissions.test.ts; keep this file focused on
// query/read gating.
vi.mock('../stage-costing-actions.js', () => ({
  registerStageCostingActions: vi.fn(),
  unregisterStageCostingActions: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const permissionState = {
  canReadOrders: true,
  canReadStages: true,
  canReadWorkCenters: true,
  canReadStageCosts: true,
}

function resetPermissionState() {
  permissionState.canReadOrders = true
  permissionState.canReadStages = true
  permissionState.canReadWorkCenters = true
  permissionState.canReadStageCosts = true
}

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => {
      switch (key) {
        case 'manufacturing.orders.read':
          return permissionState.canReadOrders
        case 'manufacturing.stages.read':
          return permissionState.canReadStages
        case 'manufacturing.work_centers.read':
          return permissionState.canReadWorkCenters
        case 'manufacturing.stage_costs.read':
          return permissionState.canReadStageCosts
        case 'manufacturing.stage_costs.create':
        case 'manufacturing.stage_costs.update':
          return false
        default:
          return false
      }
    },
  }),
}))

const getAllManufacturingOrders = vi.fn()
const getAllManufacturingStages = vi.fn()

vi.mock('@/services/supabase-service', () => ({
  manufacturingService: {
    getAll: (...args: unknown[]) => getAllManufacturingOrders(...args),
  },
  manufacturingStagesService: {
    getAll: (...args: unknown[]) => getAllManufacturingStages(...args),
  },
}))

function chainable(result: { data: unknown[]; error: null }) {
  const builder = Promise.resolve(result) as Promise<typeof result> & Record<string, unknown>
  const methods = ['select', 'order', 'eq', 'limit', 'in']
  for (const m of methods) {
    builder[m] = vi.fn(() => builder)
  }
  return builder
}

const fromCalls: string[] = []

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      fromCalls.push(table)
      return chainable({ data: [], error: null })
    },
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn().mockReturnThis(),
    })),
    removeChannel: vi.fn().mockResolvedValue({}),
  },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}))

vi.mock('@/lib/config', () => ({
  loadConfig: vi.fn(() => Promise.resolve({ ORG_ID: 'org-1' })),
}))

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  })
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <StageCostingPanel />
    </QueryClientProvider>
  )
  return { ...utils, queryClient }
}

describe('StageCostingPanel — per-resource read gating', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromCalls.length = 0
    resetPermissionState()
    getAllManufacturingOrders.mockResolvedValue([
      { id: 'mo-1', order_number: 'MO-001', product_id: 'p-1', status: 'in_progress' },
    ])
    getAllManufacturingStages.mockResolvedValue([])
  })

  it('negative: without manufacturing.orders.read, the orders query never fires and the select is disabled', async () => {
    permissionState.canReadOrders = false

    renderPanel()

    await waitFor(() => {
      expect(screen.getByLabelText('أمر التصنيع')).toBeDisabled()
    })
    expect(getAllManufacturingOrders).not.toHaveBeenCalled()
    expect(screen.getByText('لا تملك صلاحية عرض أوامر التصنيع')).toBeInTheDocument()
  })

  it('negative: without manufacturing.stages.read, the stages query never fires and the select is disabled', async () => {
    permissionState.canReadStages = false

    renderPanel()

    await waitFor(() => {
      expect(screen.getByLabelText('المرحلة')).toBeDisabled()
    })
    expect(getAllManufacturingStages).not.toHaveBeenCalled()
    expect(screen.getByText('لا تملك صلاحية عرض مراحل التصنيع')).toBeInTheDocument()
  })

  it('negative: without manufacturing.work_centers.read, no work_centers request is sent and the select is disabled', async () => {
    permissionState.canReadWorkCenters = false

    renderPanel()

    await waitFor(() => {
      expect(screen.getByLabelText('مركز العمل')).toBeDisabled()
    })
    expect(fromCalls).not.toContain('work_centers')
    expect(screen.getByText('لا تملك صلاحية عرض مراكز العمل')).toBeInTheDocument()
  })

  it('negative: without manufacturing.stage_costs.read, refresh/report actions are disabled', async () => {
    permissionState.canReadStageCosts = false

    renderPanel()

    await waitFor(() => {
      expect(screen.getByText('تحديث').closest('button')).toBeDisabled()
    })
    expect(screen.getByText('تقرير المراحل').closest('button')).toBeDisabled()
  })

  it('positive: with manufacturing.orders.read granted, the order loads and renders as an option', async () => {
    renderPanel()

    await waitFor(() => {
      expect(getAllManufacturingOrders).toHaveBeenCalledTimes(1)
    })
    const select = screen.getByLabelText('أمر التصنيع') as HTMLSelectElement
    await waitFor(() => {
      expect(within(select).getByText(/MO-001/)).toBeInTheDocument()
    })
    expect(select).not.toBeDisabled()
  })

  it('cached-data revocation: an order visible under a granted permission disappears once the permission is revoked, even though TanStack Query keeps the row cached', async () => {
    const { rerender, queryClient } = renderPanel()

    const select = () => screen.getByLabelText('أمر التصنيع') as HTMLSelectElement

    await waitFor(() => {
      expect(within(select()).getByText(/MO-001/)).toBeInTheDocument()
    })

    // Confirm TanStack Query really does still hold the row after the flag
    // flips — proving the fix isn't "the query cache happened to be empty"
    // but the panel's own re-gate at render time.
    permissionState.canReadOrders = false
    rerender(
      <QueryClientProvider client={queryClient}>
        <StageCostingPanel />
      </QueryClientProvider>
    )

    await waitFor(() => {
      expect(select()).toBeDisabled()
    })
    expect(within(select()).queryByText(/MO-001/)).not.toBeInTheDocument()
    expect(queryClient.getQueryData(['manufacturing-orders'])).toBeDefined()
  })

  it('in-flight revocation: a request already pending when permission is revoked must not populate the screen once it resolves', async () => {
    let resolveOrders!: (value: unknown[]) => void
    getAllManufacturingOrders.mockReturnValue(
      new Promise((resolve) => {
        resolveOrders = resolve
      })
    )

    const { rerender, queryClient } = renderPanel()

    await waitFor(() => {
      expect(getAllManufacturingOrders).toHaveBeenCalledTimes(1)
    })

    // Revoke before the in-flight request settles.
    permissionState.canReadOrders = false
    rerender(
      <QueryClientProvider client={queryClient}>
        <StageCostingPanel />
      </QueryClientProvider>
    )

    // Now let the stale, already-in-flight response land.
    resolveOrders([{ id: 'mo-late', order_number: 'MO-LATE', status: 'in_progress' }])

    await waitFor(() => {
      expect(screen.getByLabelText('أمر التصنيع')).toBeDisabled()
    })
    expect(screen.queryByText(/MO-LATE/)).not.toBeInTheDocument()
  })
})
