/**
 * Round 8: the mounted calculate-stage-cost button must require BOTH
 * manufacturing.stage_costs.create AND manufacturing.stage_costs.update —
 * not either one. upsertStageCost() is a genuine UPSERT (INSERT or UPDATE
 * depending on server-side state), so create-only or update-only alone is a
 * bypass: create-only could UPDATE an existing conflicting row, update-only
 * could INSERT a brand-new one.
 *
 * These tests mount the real StageCostingPanel with real action registration
 * (stage-costing-actions.js is NOT mocked here, unlike
 * stage-costing-panel-rbac.test.tsx), so a click goes through the actual
 * global uiEvents delegation into the actual calculate-stage-cost handler —
 * proving both the mounted-button gate (usePermissions, cached) and the
 * uncached live recheck (hasLiveStageCostingPermissionAll) independently.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { render } from '../../../test/test-utils'
import StageCostingPanel from '../stage-costing-panel'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/hooks/useManufacturingOrders', () => ({
  useManufacturingOrders: () => ({
    data: [{ id: 'mo-1', order_number: 'MO-001', product_id: 'p-1', status: 'in_progress' }],
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/hooks/useWorkCenters', () => ({
  useWorkCenters: () => ({
    data: [{ id: 'wc-1', code: 'WC1', name: 'Welding' }],
    isLoading: false,
    isError: false,
  }),
}))
vi.mock('@/hooks/useManufacturingStages', () => ({
  useManufacturingStages: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('@/hooks/useStageCosts', () => ({
  useStageCosts: () => ({ data: [], isLoading: false, isError: false }),
}))
vi.mock('@/hooks/useRealtimeSubscription', () => ({
  useRealtimeSubscription: vi.fn(),
}))

const permissionState = { create: true, update: true }

vi.mock('@/hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermissionKey: (key: string) => {
      switch (key) {
        case 'manufacturing.orders.read':
        case 'manufacturing.stages.read':
        case 'manufacturing.work_centers.read':
        case 'manufacturing.stage_costs.read':
          return true
        case 'manufacturing.stage_costs.create':
          return permissionState.create
        case 'manufacturing.stage_costs.update':
          return permissionState.update
        default:
          return false
      }
    },
  }),
}))

const hasLiveStageCostingPermissionAllMock = vi.fn(async (..._args: unknown[]) => true)
vi.mock('../stage-costing-permissions', async () => {
  const actual = await vi.importActual<typeof import('../stage-costing-permissions')>('../stage-costing-permissions')
  return {
    ...actual,
    hasLiveStageCostingPermissionAll: (...args: unknown[]) => hasLiveStageCostingPermissionAllMock(...args),
  }
})

vi.mock('@/services/process-costing-service', () => ({
  processCostingService: {
    getStageCosts: vi.fn(),
    applyLaborTime: vi.fn(),
    applyOverhead: vi.fn(),
    upsertStageCost: vi.fn(),
  },
}))

function resetPermissions() {
  permissionState.create = true
  permissionState.update = true
}

async function fillRequiredFields() {
  const moSelect = screen.getByLabelText('أمر التصنيع') as HTMLSelectElement
  const wcSelect = screen.getByLabelText('مركز العمل') as HTMLSelectElement
  const goodQuantity = screen.getByLabelText('الكمية الجيدة') as HTMLInputElement

  await userEvent.selectOptions(moSelect, 'mo-1')
  await userEvent.selectOptions(wcSelect, 'wc-1')
  await userEvent.clear(goodQuantity)
  await userEvent.type(goodQuantity, '100')
}

function calculateButton() {
  return screen.getByText('احتساب تكلفة المرحلة').closest('button') as HTMLButtonElement
}

describe('StageCostingPanel — calculate-stage-cost requires create AND update', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    resetPermissions()
    hasLiveStageCostingPermissionAllMock.mockResolvedValue(true)
  })

  it('create only: the mounted button is disabled and the service is never called', async () => {
    permissionState.create = true
    permissionState.update = false

    render(<StageCostingPanel />)
    await fillRequiredFields()

    expect(calculateButton()).toBeDisabled()
    const { processCostingService } = await import('@/services/process-costing-service')
    expect(processCostingService.upsertStageCost).not.toHaveBeenCalled()
  })

  it('update only: the mounted button is disabled and the service is never called', async () => {
    permissionState.create = false
    permissionState.update = true

    render(<StageCostingPanel />)
    await fillRequiredFields()

    expect(calculateButton()).toBeDisabled()
    const { processCostingService } = await import('@/services/process-costing-service')
    expect(processCostingService.upsertStageCost).not.toHaveBeenCalled()
  })

  it('both create and update: the button is enabled and exactly one service call happens', async () => {
    permissionState.create = true
    permissionState.update = true
    hasLiveStageCostingPermissionAllMock.mockResolvedValue(true)
    const { processCostingService } = await import('@/services/process-costing-service')
    ;(processCostingService.upsertStageCost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { stageId: 'stage-1', totalCost: 500, unitCost: 5, transferredIn: 0, laborCost: 100, overheadCost: 50 },
    })

    render(<StageCostingPanel />)
    await fillRequiredFields()

    await waitFor(() => expect(calculateButton()).not.toBeDisabled())
    await userEvent.click(calculateButton())

    await waitFor(() => expect(processCostingService.upsertStageCost).toHaveBeenCalledTimes(1))
  })

  it('cached both, live check revoked: the mounted button is enabled (stale cache) but the uncached live recheck denies the write before the service is ever called', async () => {
    permissionState.create = true
    permissionState.update = true
    // Simulates one of the two keys having been revoked server-side after
    // the permission snapshot the panel rendered from was captured — the
    // live, uncached recheck must still catch it.
    hasLiveStageCostingPermissionAllMock.mockResolvedValue(false)
    const { processCostingService } = await import('@/services/process-costing-service')

    render(<StageCostingPanel />)
    await fillRequiredFields()

    await waitFor(() => expect(calculateButton()).not.toBeDisabled())
    await userEvent.click(calculateButton())

    await waitFor(() => expect(hasLiveStageCostingPermissionAllMock).toHaveBeenCalled())
    expect(processCostingService.upsertStageCost).not.toHaveBeenCalled()
  })
})
