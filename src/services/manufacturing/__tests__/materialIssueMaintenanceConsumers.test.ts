import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => ({ manage: vi.fn(), snapshot: vi.fn(), from: vi.fn(), rpc: vi.fn(), tenant: vi.fn() }))
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc }, getEffectiveTenantId: mocks.tenant }))
vi.mock('../materialIssueMaintenance', () => ({ manageMaterialIssueSetup: mocks.manage, issueSetupSnapshot: mocks.snapshot }))
import { createManufacturingOrder } from '../createOrder'
import { updateManufacturingOrderStatus } from '../updateStatus'
import { createMaterialIssueWorkOrder, pauseWorkOrder, updateWorkOrderStatus } from '../mesService'
import { inventoryTransactionService } from '../../inventory-transaction-service'

const org = 'ed000000-0000-4000-8000-000000000001'
const client = { from: mocks.from, rpc: mocks.rpc } as unknown as SupabaseClient
beforeEach(() => {
  vi.resetAllMocks(); vi.stubEnv('PROD', false); vi.stubEnv('VITE_MATERIAL_ISSUE_ISOLATED', 'true')
  mocks.tenant.mockResolvedValue(org)
  mocks.manage.mockResolvedValue({ id: 'mo', org_id: org })
  mocks.snapshot.mockResolvedValue({ mo_id: 'mo', maintenance_version: 7, quantity_reserved: 20, quantity_consumed: 5, quantity_released: 3 })
})
afterEach(() => vi.unstubAllEnvs())
describe('isolated maintenance consumers never fall back', () => {
  it('creates order plus materials in one guarded event, no legacy write', async () => {
    await createManufacturingOrder(async () => client, { quantity: 1, status: 'draft' }, [{ item_id: 'item', quantity: 2 }])
    expect(mocks.manage).toHaveBeenCalledWith({ operation: 'create_order', order: { quantity: 1 }, materials: [{ item_id: 'item', quantity: 2 }] })
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it('does not call a legacy path when candidate RPC is missing', async () => {
    mocks.manage.mockRejectedValue({ code: 'PGRST202' })
    await expect(createManufacturingOrder(async () => client, { quantity: 1 })).rejects.toMatchObject({ code: 'PGRST202' })
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('rejects a non-draft initial state or foreign organization before sending', async () => {
    await expect(createManufacturingOrder(async () => client, { quantity: 1, status: 'done' })).rejects.toThrow('ISSUE_SETUP_INITIAL_DRAFT_REQUIRED')
    await expect(createManufacturingOrder(async () => client, { quantity: 1, org_id: 'foreign' })).rejects.toThrow('ISSUE_SETUP_IDENTITY_CHANGED')
    expect(mocks.manage).not.toHaveBeenCalled()
  })
  it('uses a scoped version and never falls into status-update catch/fallback', async () => {
    mocks.manage.mockRejectedValue({ code: '40001' })
    await expect(updateManufacturingOrderStatus(async () => client, { id: 'mo', status: 'in_progress' })).rejects.toMatchObject({ code: '40001' })
    expect(mocks.manage).toHaveBeenCalledWith({ operation: 'set_order_status', mo_id: 'mo', status: 'in_progress', expected_version: 7 })
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it('limits work-order edits to eligibility and rejects pause before logging', async () => {
    await updateWorkOrderStatus('wo', 'IN_PROGRESS')
    expect(mocks.manage).toHaveBeenCalledWith({ operation: 'set_work_order_status', mo_id: 'mo', work_order_id: 'wo', status: 'IN_PROGRESS', expected_version: 7 })
    await expect(pauseWorkOrder('wo', 'reason')).rejects.toThrow('ISSUE_SETUP_MES_EXECUTION_DEFERRED')
    await expect(updateWorkOrderStatus('wo', 'ON_HOLD', 'reason')).rejects.toThrow('ISSUE_SETUP_ELIGIBILITY_ONLY')
    expect(mocks.from).not.toHaveBeenCalled()
  })
  it('offers explicit manual WO preparation without general routing generation', async () => {
    await createMaterialIssueWorkOrder('mo', 'wc', 'Preparation', 1, 7)
    expect(mocks.manage).toHaveBeenCalledWith({ operation: 'create_work_order', mo_id: 'mo', work_center_id: 'wc', name: 'Preparation', quantity: 1, expected_version: 7 })
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it.each([undefined, null, true, '7', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('refuses invalid child parent version %s before reads or persistence', async value => {
    await expect(createMaterialIssueWorkOrder('mo', 'wc', 'Preparation', 1, value as number)).rejects.toThrow('ISSUE_SETUP_VERSION_REQUIRED')
    await expect(inventoryTransactionService.reserveMaterials('mo', [{ item_id: 'item', quantity: 2 }], undefined, value as number)).rejects.toThrow('ISSUE_SETUP_VERSION_REQUIRED')
    expect(mocks.manage).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it('refuses partial multi-line maintenance and release-all loops', async () => {
    await expect(inventoryTransactionService.reserveMaterials('mo', [{ item_id: 'one', quantity: 1 }, { item_id: 'two', quantity: 1 }])).rejects.toThrow('ISSUE_SETUP_SINGLE_RESERVATION_REQUIRED')
    await expect(inventoryTransactionService.releaseAllReservations('mo')).rejects.toThrow('ISSUE_SETUP_SINGLE_RESERVATION_REQUIRED')
    expect(mocks.rpc).not.toHaveBeenCalled(); expect(mocks.from).not.toHaveBeenCalled()
  })
  it('takes base UOM from the scoped read RPC, not the quarantined resolver', async () => {
    mocks.rpc.mockResolvedValue({ data: { org_id: org, item_id: 'item', uom_id: 'uom' }, error: null })
    await inventoryTransactionService.reserveMaterials('mo', [{ item_id: 'item', quantity: 2 }], undefined, 7)
    expect(mocks.rpc).toHaveBeenCalledWith('rpc_get_material_reservation_setup', { p_org_id: org, p_item_id: 'item' })
    expect(mocks.manage).toHaveBeenCalledWith({ operation: 'reserve', mo_id: 'mo', item_id: 'item', uom_id: 'uom', quantity: 2, expected_version: 7 })
    expect(mocks.from).not.toHaveBeenCalled(); expect(mocks.snapshot).not.toHaveBeenCalled()
  })
})
