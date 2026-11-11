/**
 * #260 interim: the three stage-costing write actions run against the REAL processCostingService (not a mock).
 * The service refuses before any request (StageCostingUnavailableError), so each action must
 *  - send nothing to Supabase,
 *  - show the explicit "unavailable pending #260" refusal (never a success toast or a generic error),
 *  - dispatch no result event and log nothing as a completed calculation.
 * Permissions are granted here on purpose: the refusal must not depend on the caller lacking a grant.
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

vi.mock('@/lib/supabase', () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
  getEffectiveTenantId: vi.fn(() => Promise.resolve('org-1')),
}))

vi.mock('../stage-costing-permissions', () => ({
  hasLiveStageCostingPermission: vi.fn(() => Promise.resolve(true)),
  hasLiveStageCostingPermissionAll: vi.fn(() => Promise.resolve(true)),
  STAGE_COSTING_PERMISSIONS: {
    ORDERS_READ: 'manufacturing.orders.read',
    STAGES_READ: 'manufacturing.stages.read',
    WORK_CENTERS_READ: 'manufacturing.work_centers.read',
    STAGE_COSTS_READ: 'manufacturing.stage_costs.read',
    STAGE_COSTS_CREATE: 'manufacturing.stage_costs.create',
    STAGE_COSTS_UPDATE: 'manufacturing.stage_costs.update',
  },
}))

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
  const form = { __fieldMap: new Map(Object.entries(fields)), dispatchEvent: vi.fn(), querySelector: vi.fn(() => null) }
  const element = { disabled: false, textContent: 'original', closest: (s: string) => (s === 'form' ? form : null) }
  return { element, form }
}

const FIELDS = {
  manufacturingOrderId: 'mo-1',
  stageId: 'stage-1',
  workCenterId: 'wc-1',
  laborHours: '5',
  laborRate: '20',
  overheadRate: '0.5',
  goodQuantity: '10',
  directMaterialCost: '100',
}

let originalFormData: typeof globalThis.FormData

beforeEach(async () => {
  registeredActions.clear()
  vi.clearAllMocks()
  originalFormData = globalThis.FormData
  ;(globalThis as unknown as { FormData: unknown }).FormData = FakeFormData
  const { registerStageCostingActions } = await import('../stage-costing-actions.js')
  registerStageCostingActions()
})

afterEach(() => {
  ;(globalThis as unknown as { FormData: unknown }).FormData = originalFormData
})

describe.each(['apply-labor-time', 'apply-overhead', 'calculate-stage-cost'])('%s — unavailable until #260', (action) => {
  it('sends no request, shows the explicit refusal, and reports no result', async () => {
    const { supabase } = await import('@/lib/supabase')
    const { toast } = await import('sonner')
    const ctx = contextWithForm(FIELDS)

    await registeredActions.get(action)!(ctx)

    expect(supabase.from).not.toHaveBeenCalled()
    expect(supabase.rpc).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledTimes(1)
    expect(String((toast.error as ReturnType<typeof vi.fn>).mock.calls[0][0])).toContain('STAGE_COSTING_UNAVAILABLE_PENDING_260')
    expect(ctx.form.dispatchEvent).not.toHaveBeenCalled()
    expect(ctx.element.disabled).toBe(false)
  })
})
