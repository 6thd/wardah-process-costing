import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const tenant = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
  getEffectiveTenantId: () => tenant(),
}))

import {
  costPolicyErrorDetail,
  costPolicyErrorKey,
  createCostPolicyVersion,
  getCostPolicy,
  previewAbsorption,
  withdrawCostPolicyVersion,
  type CostPolicyDraft,
} from '../mfg-cost-policy-service'

const ORG = '22222222-2222-2222-2222-222222222222'
const STATE = {
  org_id: ORG, today: '2026-10-22', current_version_id: null, latest_version_no: 0, versions: [],
  supported: { labor_cost_sources: ['work_center_rate', 'recorded_entry_rate'], overhead_bases: ['labor_hours', 'machine_hours'], stage_costing_methods: ['weighted_average'], pin_events: ['mo_created', 'production_started'] },
  capabilities: { can_manage: true },
}

describe('mfg-cost-policy-service', () => {
  beforeEach(() => {
    rpc.mockReset()
    tenant.mockReset()
    tenant.mockResolvedValue(ORG)
  })

  it('reads the policy and the save capability from the database', async () => {
    rpc.mockResolvedValue({ data: STATE, error: null })

    const state = await getCostPolicy()

    expect(rpc).toHaveBeenCalledWith('rpc_get_mfg_cost_policy', { p_org_id: ORG })
    expect(state.canManage).toBe(true)
    expect(state.latestVersionNo).toBe(0)
    expect(state.supported.overhead_bases).toEqual(['labor_hours', 'machine_hours'])
    expect(state.supported.pin_events).toEqual(['mo_created', 'production_started'])
  })

  it('reports an environment without Migration 204 as COST_POLICY_NOT_DEPLOYED, not as a generic error', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.rpc_get_mfg_cost_policy(p_org_id) in the schema cache' },
    })

    await expect(getCostPolicy()).rejects.toThrow('COST_POLICY_NOT_DEPLOYED')
  })

  it('creates a version with the expected latest version and the caller idempotency key', async () => {
    rpc.mockResolvedValue({ data: { ...STATE, latest_version_no: 1, policy_version_id: 'v1', replayed: false }, error: null })
    const draft: CostPolicyDraft = {
      effective_from: '2026-11-01', labor_cost_source: 'work_center_rate', default_labor_rate_per_hour: 30, pin_event: 'production_started',
      overhead_pools: [{ pool_code: 'MACHINE_OH', name: 'Machine', basis: 'machine_hours', rate: 40 }],
      work_center_rules: [{ work_center_id: 'wc-1', pools: [{ pool_code: 'MACHINE_OH', applies: false }] }],
    }

    const result = await createCostPolicyVersion(draft, 0, 'key-1')

    expect(rpc).toHaveBeenCalledWith('rpc_create_mfg_cost_policy_version', {
      p_org_id: ORG, p_policy: draft, p_expected_latest_version_no: 0, p_idempotency_key: 'key-1',
    })
    expect(result).toMatchObject({ versionId: 'v1', replayed: false })
  })

  it('withdraws with a reason and previews with NULL for an unmeasured driver', async () => {
    rpc.mockResolvedValue({ data: STATE, error: null })
    await withdrawCostPolicyVersion('v2', 'Rates not approved')
    expect(rpc).toHaveBeenLastCalledWith('rpc_withdraw_mfg_cost_policy_version', {
      p_org_id: ORG, p_policy_version_id: 'v2', p_reason: 'Rates not approved',
    })

    rpc.mockResolvedValue({ data: { total: 0 }, error: null })
    await previewAbsorption({ versionId: 'v1', workCenterId: 'wc-1', laborHours: 0, machineHours: null, recordedLaborCost: null })
    expect(rpc).toHaveBeenLastCalledWith('rpc_preview_mfg_cost_absorption', {
      p_org_id: ORG, p_policy_version_id: 'v1', p_work_center_id: 'wc-1',
      p_labor_hours: 0, p_machine_hours: null, p_recorded_labor_cost: null,
    })
  })

  it('maps 204 codes to translation keys and keeps the detail after the colon', () => {
    expect(costPolicyErrorKey('COST_POLICY_RATE_INVALID: overhead_pools[2].rate'))
      .toBe('manufacturingSettings.costPolicy.errors.COST_POLICY_RATE_INVALID')
    expect(costPolicyErrorDetail('COST_POLICY_RATE_INVALID: overhead_pools[2].rate')).toBe('overhead_pools[2].rate')
    expect(costPolicyErrorKey('COST_POLICY_INVALID: effective_from'))
      .toBe('manufacturingSettings.costPolicy.errors.COST_POLICY_INVALID')
    expect(costPolicyErrorKey('MANUFACTURING_SETTINGS_UPDATE_DENIED'))
      .toBe('manufacturingSettings.costPolicy.errors.MANUFACTURING_SETTINGS_UPDATE_DENIED')
    expect(costPolicyErrorKey('COST_POLICY_PIN_EVENT_UNSUPPORTED'))
      .toBe('manufacturingSettings.costPolicy.errors.COST_POLICY_PIN_EVENT_UNSUPPORTED')
    expect(costPolicyErrorDetail('COST_POLICY_INVALID: pin_event')).toBe('pin_event')
    expect(costPolicyErrorKey('network down')).toBeNull()
  })
})
