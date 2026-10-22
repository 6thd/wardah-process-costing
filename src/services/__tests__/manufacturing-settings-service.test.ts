import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.fn()
const tenant = vi.fn()
const queryResult = { current: { data: [] as unknown[], error: null as null | { message: string } } }
const queries: Array<{ table: string; calls: Array<[string, unknown[]]> }> = []

function builder(table: string) {
  const record = { table, calls: [] as Array<[string, unknown[]]> }
  queries.push(record)
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order']) {
    chain[method] = (...args: unknown[]) => {
      record.calls.push([method, args])
      return chain
    }
  }
  chain.then = (resolve: (value: unknown) => unknown) => resolve(queryResult.current)
  return chain
}

vi.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args), from: (table: string) => builder(table) },
  getEffectiveTenantId: () => tenant(),
}))

import {
  getQualityPolicy,
  listGlEventMappings,
  listPostingAccounts,
  manufacturingSettingsErrorKey,
  setGlEventMapping,
  setMaterialIssueStatuses,
  setQualityPolicy,
} from '../manufacturing-settings-service'

const ORG = '11111111-1111-1111-1111-111111111111'

describe('manufacturing-settings-service', () => {
  beforeEach(() => {
    rpc.mockReset()
    tenant.mockReset()
    tenant.mockResolvedValue(ORG)
    queries.length = 0
    queryResult.current = { data: [], error: null }
  })

  it('sends material-issue statuses in the only order M192 accepts, IN_PROGRESS first', async () => {
    rpc.mockResolvedValue({ data: { allowed_statuses: ['IN_PROGRESS', 'READY', 'IN_SETUP'], version: 4 }, error: null })

    const result = await setMaterialIssueStatuses(['IN_SETUP', 'READY'])

    expect(rpc).toHaveBeenCalledWith('rpc_set_material_issue_wo_statuses', {
      p_org_id: ORG,
      p_allowed_statuses: ['IN_PROGRESS', 'READY', 'IN_SETUP'],
    })
    expect(result).toEqual({ allowedStatuses: ['IN_PROGRESS', 'READY', 'IN_SETUP'], version: 4 })
  })

  it('takes the save capability from the database (can_manage_policy), never assumes it', async () => {
    rpc.mockResolvedValue({
      data: {
        release_gate_mode: 'off', inspection_scope: 'final_only', allow_conditional_release: false,
        segregation_of_duties: true, admins_subject_to_quality_controls: true, version: 7,
        capabilities: { can_manage_policy: false },
      },
      error: null,
    })

    const policy = await getQualityPolicy()

    expect(rpc).toHaveBeenCalledWith('rpc_get_quality_policy', { p_org_id: ORG })
    expect(policy.canManage).toBe(false)
    expect(policy.version).toBe(7)
  })

  it('saves the quality policy against the version the user loaded', async () => {
    rpc.mockResolvedValue({ data: { version: 8, capabilities: { can_manage_policy: true } }, error: null })
    const values = {
      release_gate_mode: 'all_orders' as const, inspection_scope: 'stages_and_final' as const,
      allow_conditional_release: true, segregation_of_duties: true, admins_subject_to_quality_controls: false,
    }

    await setQualityPolicy(values, 7)

    expect(rpc).toHaveBeenCalledWith('rpc_set_quality_policy', { p_org_id: ORG, p_policy: values, p_expected_version: 7 })
  })

  it('omits the work center for a global mapping and passes it for an OH_APPLIED override', async () => {
    rpc.mockResolvedValue({ data: {}, error: null })

    await setGlEventMapping({
      eventCode: 'FG_RECEIPT', workCenterCode: null, debitAccountCode: '135100',
      creditAccountCode: '134100', description: null, isActive: true,
    })
    await setGlEventMapping({
      eventCode: 'OH_APPLIED', workCenterCode: 'WC-A', debitAccountCode: '134100',
      creditAccountCode: '520100', description: 'Mixing', isActive: true,
    })

    expect(rpc).toHaveBeenNthCalledWith(1, 'rpc_set_gl_event_mapping', {
      p_org_id: ORG, p_event_code: 'FG_RECEIPT', p_debit_account_code: '135100', p_credit_account_code: '134100',
      p_work_center_code: undefined, p_description: undefined, p_is_active: true,
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'rpc_set_gl_event_mapping', expect.objectContaining({
      p_event_code: 'OH_APPLIED', p_work_center_code: 'WC-A', p_description: 'Mixing',
    }))
  })

  it('reads mappings of the manufacturing events only, scoped to the current org', async () => {
    queryResult.current = {
      data: [{
        id: 'm1', event_code: 'OH_APPLIED', work_center_code: 'WC-A', debit_account_code: '134100',
        credit_account_code: '520100', description: null, is_active: true,
      }],
      error: null,
    }

    const rows = await listGlEventMappings()

    expect(queries[0].table).toBe('gl_event_mappings')
    expect(queries[0].calls).toContainEqual(['eq', ['org_id', ORG]])
    const inCall = queries[0].calls.find(([method]) => method === 'in')
    expect(inCall?.[1][0]).toBe('event_code')
    expect(inCall?.[1][1]).toContain('FG_RECEIPT')
    expect(rows).toEqual([{
      id: 'm1', eventCode: 'OH_APPLIED', workCenterCode: 'WC-A', debitAccountCode: '134100',
      creditAccountCode: '520100', description: null, isActive: true,
    }])
  })

  it('offers only accounts the writer accepts (active, posting not disallowed)', async () => {
    queryResult.current = {
      data: [
        { code: '1000', name: 'Assets', name_ar: null, allow_posting: false },
        { code: '134100', name: 'WIP', name_ar: 'تحت التشغيل', allow_posting: true },
        { code: '135100', name: 'FG', name_ar: null, allow_posting: null },
      ],
      error: null,
    }

    const accounts = await listPostingAccounts()

    expect(queries[0].calls).toContainEqual(['eq', ['is_active', true]])
    expect(accounts.map(a => a.code)).toEqual(['134100', '135100'])
  })

  it('refuses to call any RPC without an organization', async () => {
    tenant.mockResolvedValue(null)

    await expect(getQualityPolicy()).rejects.toThrow('ORG_UNRESOLVED')
    expect(rpc).not.toHaveBeenCalled()
  })

  it('surfaces database errors and maps known codes to translation keys', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'MANUFACTURING_SETTINGS_UPDATE_DENIED' } })

    await expect(setMaterialIssueStatuses([])).rejects.toThrow('MANUFACTURING_SETTINGS_UPDATE_DENIED')
    expect(manufacturingSettingsErrorKey('MANUFACTURING_SETTINGS_UPDATE_DENIED'))
      .toBe('manufacturingSettings.errors.updateDenied')
    expect(manufacturingSettingsErrorKey('QUALITY_POLICY_VERSION_CONFLICT: current=9'))
      .toBe('manufacturingSettings.errors.versionConflict')
    expect(manufacturingSettingsErrorKey('something else')).toBeNull()
  })
})
