/**
 * Round 7 P1: live-write authorization for the global uiEvents actions
 * registered by stage-costing-actions.js.
 *
 * These actions (apply-labor-time, apply-overhead, calculate-stage-cost,
 * refresh-stage-costs, view-stage-report) are registered on the app-wide
 * uiEvents singleton, not scoped to the mounted StageCostingPanel — hiding
 * the button or unmounting the panel does not unregister them. Each handler
 * must ask the backend LIVE (hasLiveStageCostingPermission, never the cached
 * usePermissions() snapshot) immediately before the real service call, so a
 * grant revoked mid-session — after the button was rendered as enabled — is
 * still honored on the very next click.
 *
 * The registered handlers are captured directly off the mocked uiEvents
 * singleton and invoked with a hand-built context, exercising the real
 * production handler code with a real spied processCostingService reference
 * (not a mocked sibling).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const registeredActions = new Map<string, (context: unknown) => Promise<unknown>>()

vi.mock('../../../ui/events.js', () => ({
  default: {
    registerAction: vi.fn((name: string, handler: (context: unknown) => Promise<unknown>) => {
      registeredActions.set(name, handler)
    }),
    unregisterAction: vi.fn(),
  },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

vi.mock('@/services/process-costing-service', () => ({
  processCostingService: {
    getStageCosts: vi.fn(),
    applyLaborTime: vi.fn(),
    applyOverhead: vi.fn(),
    upsertStageCost: vi.fn(),
  },
}))

const hasLiveStageCostingPermission = vi.fn()
const hasLiveStageCostingPermissionAll = vi.fn()
vi.mock('../stage-costing-permissions', () => ({
  hasLiveStageCostingPermission: (...args: unknown[]) => hasLiveStageCostingPermission(...args),
  hasLiveStageCostingPermissionAll: (...args: unknown[]) => hasLiveStageCostingPermissionAll(...args),
  STAGE_COSTING_PERMISSIONS: {
    ORDERS_READ: 'manufacturing.orders.read',
    STAGES_READ: 'manufacturing.stages.read',
    WORK_CENTERS_READ: 'manufacturing.work_centers.read',
    STAGE_COSTS_READ: 'manufacturing.stage_costs.read',
    STAGE_COSTS_CREATE: 'manufacturing.stage_costs.create',
    STAGE_COSTS_UPDATE: 'manufacturing.stage_costs.update',
  },
}))

// The handlers under test build their payload with `new FormData(form)`,
// which in jsdom requires a real HTMLFormElement — not the plain mock
// object a unit test wants to hand it. Stubbing FormData to read a map
// attached directly to the mock `form` keeps the handlers' real parsing
// code (`formData.get('laborHours')`, etc.) exercised as written.
class FakeFormData {
  private readonly map: Map<string, string>
  constructor(form: unknown) {
    this.map = (form as { __fieldMap?: Map<string, string> })?.__fieldMap ?? new Map()
  }
  get(key: string) {
    return this.map.get(key) ?? null
  }
}

function contextWithForm(fields: Record<string, string>) {
  const map = new Map(Object.entries(fields))
  const form = {
    __fieldMap: map,
    dispatchEvent: vi.fn(),
    querySelector: vi.fn(() => null),
  }
  const element = {
    disabled: false,
    textContent: 'original',
    closest: (selector: string) => (selector === 'form' ? form : null),
  }
  return { element, form }
}

let originalFormData: typeof globalThis.FormData

beforeEach(async () => {
  registeredActions.clear()
  vi.clearAllMocks()
  hasLiveStageCostingPermission.mockReset()
  hasLiveStageCostingPermissionAll.mockReset()

  originalFormData = globalThis.FormData
  ;(globalThis as unknown as { FormData: unknown }).FormData = FakeFormData

  const { registerStageCostingActions } = await import('../stage-costing-actions.js')
  registerStageCostingActions()
})

afterEach(() => {
  ;(globalThis as unknown as { FormData: unknown }).FormData = originalFormData
})

describe('apply-labor-time — live permission recheck', () => {
  it('negative: service is never called when the live check denies the write', async () => {
    hasLiveStageCostingPermission.mockResolvedValue(false)
    const { processCostingService } = await import('@/services/process-costing-service')
    const { toast } = await import('sonner')

    const ctx = contextWithForm({
      laborHours: '5',
      laborRate: '20',
      stageId: 'stage-1',
      manufacturingOrderId: 'mo-1',
      workCenterId: 'wc-1',
    })

    const handler = registeredActions.get('apply-labor-time')!
    await handler(ctx)

    expect(hasLiveStageCostingPermission).toHaveBeenCalledWith('manufacturing.stage_costs.create')
    expect(processCostingService.applyLaborTime).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalled()
  })

  it('positive: service is called with the submitted values when the live check grants the write', async () => {
    hasLiveStageCostingPermission.mockResolvedValue(true)
    const { processCostingService } = await import('@/services/process-costing-service')
    ;(processCostingService.applyLaborTime as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 'log-1', totalLaborCost: 100, hours: 5, hourlyRate: 20 },
    })

    const ctx = contextWithForm({
      laborHours: '5',
      laborRate: '20',
      stageId: 'stage-1',
      manufacturingOrderId: 'mo-1',
      workCenterId: 'wc-1',
    })

    const handler = registeredActions.get('apply-labor-time')!
    await handler(ctx)

    expect(processCostingService.applyLaborTime).toHaveBeenCalledTimes(1)
    expect(processCostingService.applyLaborTime).toHaveBeenCalledWith(
      expect.objectContaining({ moId: 'mo-1', stageId: 'stage-1', laborHours: 5, hourlyRate: 20 })
    )
  })

  it('mid-session revocation: a grant present when the panel rendered the button does not survive a live recheck that now denies it', async () => {
    // Simulates: the React tree computed canApplyLaborTime = true from a
    // permission snapshot that has since been revoked server-side. The
    // button was rendered enabled, but the click still goes through the
    // uncached live check, which now answers false.
    hasLiveStageCostingPermission.mockResolvedValue(false)
    const { processCostingService } = await import('@/services/process-costing-service')

    const ctx = contextWithForm({
      laborHours: '3',
      laborRate: '15',
      stageId: 'stage-1',
      manufacturingOrderId: 'mo-1',
      workCenterId: 'wc-1',
    })

    const handler = registeredActions.get('apply-labor-time')!
    await handler(ctx)

    expect(processCostingService.applyLaborTime).not.toHaveBeenCalled()
  })
})

describe('apply-overhead — live permission recheck', () => {
  it('negative: service is never called when unauthorized', async () => {
    hasLiveStageCostingPermission.mockResolvedValue(false)
    const { processCostingService } = await import('@/services/process-costing-service')

    const ctx = contextWithForm({
      overheadRate: '0.15',
      laborHours: '5',
      laborRate: '20',
      stageId: 'stage-1',
      manufacturingOrderId: 'mo-1',
      workCenterId: 'wc-1',
    })

    const handler = registeredActions.get('apply-overhead')!
    await handler(ctx)

    expect(hasLiveStageCostingPermission).toHaveBeenCalledWith('manufacturing.stage_costs.create')
    expect(processCostingService.applyOverhead).not.toHaveBeenCalled()
  })

  it('positive: service is called when authorized', async () => {
    hasLiveStageCostingPermission.mockResolvedValue(true)
    const { processCostingService } = await import('@/services/process-costing-service')
    ;(processCostingService.applyOverhead as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: { id: 'moh-1', overheadAmount: 15, baseQty: 100, rate: 0.15 },
    })

    const ctx = contextWithForm({
      overheadRate: '0.15',
      laborHours: '5',
      laborRate: '20',
      stageId: 'stage-1',
      manufacturingOrderId: 'mo-1',
      workCenterId: 'wc-1',
    })

    const handler = registeredActions.get('apply-overhead')!
    await handler(ctx)

    expect(processCostingService.applyOverhead).toHaveBeenCalledTimes(1)
  })
})

describe('calculate-stage-cost — live permission recheck requires BOTH create AND update', () => {
  // upsertStageCost() is a genuine UPSERT: the actual statement executed
  // (INSERT or UPDATE) depends on whether a row already exists for this
  // MO/stage. Holding only one of the two keys is an authorization bypass —
  // create-only could UPDATE an existing conflicting row, update-only could
  // INSERT a brand-new one — so the live recheck must require every key
  // (hasLiveStageCostingPermissionAll), not any one of them.
  const calcCtx = () =>
    contextWithForm({
      manufacturingOrderId: 'mo-1',
      workCenterId: 'wc-1',
      goodQuantity: '100',
      stageId: 'stage-1',
      directMaterialCost: '50',
      scrapQuantity: '0',
      reworkQuantity: '0',
    })

  it('negative: upsertStageCost is never called when the all-of live check denies it', async () => {
    hasLiveStageCostingPermissionAll.mockResolvedValue(false)
    const { processCostingService } = await import('@/services/process-costing-service')

    const handler = registeredActions.get('calculate-stage-cost')!
    await handler(calcCtx())

    expect(hasLiveStageCostingPermissionAll).toHaveBeenCalledWith([
      'manufacturing.stage_costs.create',
      'manufacturing.stage_costs.update',
    ])
    expect(hasLiveStageCostingPermission).not.toHaveBeenCalled()
    expect(processCostingService.upsertStageCost).not.toHaveBeenCalled()
  })

  it('positive: upsertStageCost is called exactly once when authorized via both create and update', async () => {
    hasLiveStageCostingPermissionAll.mockResolvedValue(true)
    const { processCostingService } = await import('@/services/process-costing-service')
    ;(processCostingService.upsertStageCost as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true,
      data: {
        stageId: 'stage-1',
        totalCost: 500,
        unitCost: 5,
        transferredIn: 0,
        laborCost: 100,
        overheadCost: 50,
      },
    })

    const handler = registeredActions.get('calculate-stage-cost')!
    await handler(calcCtx())

    expect(processCostingService.upsertStageCost).toHaveBeenCalledTimes(1)
  })
})

describe('refresh-stage-costs / view-stage-report — live read recheck', () => {
  it('refresh-stage-costs does not call getStageCosts when the live read check denies it', async () => {
    hasLiveStageCostingPermission.mockResolvedValue(false)
    const { processCostingService } = await import('@/services/process-costing-service')

    const panel = { querySelector: vi.fn(() => ({ value: 'mo-1' })) }
    const element = {
      disabled: false,
      innerHTML: '',
      closest: () => panel,
    }

    const handler = registeredActions.get('refresh-stage-costs')!
    await handler({ element })

    expect(hasLiveStageCostingPermission).toHaveBeenCalledWith('manufacturing.stage_costs.read')
    expect(processCostingService.getStageCosts).not.toHaveBeenCalled()
  })

  it('view-stage-report does not call getStageCosts when the live read check denies it', async () => {
    hasLiveStageCostingPermission.mockResolvedValue(false)
    const { processCostingService } = await import('@/services/process-costing-service')

    const panel = { querySelector: vi.fn(() => ({ value: 'mo-1' })) }
    const element = { closest: () => panel }

    const handler = registeredActions.get('view-stage-report')!
    await handler({ element })

    expect(processCostingService.getStageCosts).not.toHaveBeenCalled()
  })
})

describe('post-stage-to-gl is not a registered action', () => {
  it('the stub GL-posting action was removed rather than gated', () => {
    expect(registeredActions.has('post-stage-to-gl')).toBe(false)
  })
})
