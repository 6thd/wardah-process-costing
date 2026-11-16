import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ar from '@/locales/ar/translation.json'
import en from '@/locales/en/translation.json'

const mockRpc = vi.fn()
const fromCalls: Array<[string, unknown]> = []
let fromRows: unknown[] = []
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => {
      const chain = {
        select: () => chain,
        eq: (column: string, value: unknown) => { fromCalls.push([`${table}.${column}`, value]); return chain },
        order: () => Promise.resolve({ data: fromRows, error: null }),
      }
      return chain
    },
  },
}))

import {
  approveDraft205,
  centsToRiyal,
  checkDraft205,
  createLegacyResolutionDraft205,
  createVersionDraft205,
  errorDetail205,
  errorGroup205,
  errorKey205,
  listBudgetGlAccounts205,
  previewAbsorption205,
  rejectDraft205,
  serverRefusalCode,
  setSelfApproval205,
  setUnallocatedPolicy205,
  updateVersionDraft205,
  withdrawDraft205,
  type VersionDraftPayload205,
} from '../mfg-cost-policy-205-write-service'

const ORG = '52050205-0000-0000-0000-0000000000a1'
const ok = (data: unknown) => mockRpc.mockResolvedValueOnce({ data, error: null })
const fails = (error: { message: string; code?: string }) => mockRpc.mockResolvedValueOnce({ data: null, error })
const DRAFT: VersionDraftPayload205 = {
  effective_from: '2026-12-01', labor_cost_source: 'work_center_rate', default_labor_rate_per_hour: 30, pin_event: 'mo_created',
  overhead_pools: [{ pool_code: 'LABOR_OH', name: 'Labor', basis: 'labor_hours', rate: 12.5, activity: 'run', budgets: ['ELEC'] }],
  work_center_rules: [], budgets: [{ budget_code: 'ELEC', gl_account_id: 'gl-1', setup_related: false, amount: 9000 }], setup_acks: [],
}

beforeEach(() => {
  mockRpc.mockReset()
  fromCalls.length = 0
  fromRows = []
})

describe('each 205 write is one literal RPC for the organization it is given (design §4)', () => {
  it('creates a version draft with the expected latest version and the idempotency key', async () => {
    ok({ draft_id: 'd1', status: 'draft', revision: 1, replayed: false })
    await expect(createVersionDraft205(ORG, DRAFT, 2, 'key-1')).resolves.toEqual({ draftId: 'd1', revision: 1, replayed: false })
    expect(mockRpc).toHaveBeenCalledWith('rpc_create_mfg_cost_policy_draft_205', {
      p_org_id: ORG, p_draft: DRAFT, p_expected_latest_version_no: 2, p_idempotency_key: 'key-1',
    })
  })

  it('reports a replayed create as the same draft', async () => {
    ok({ draft_id: 'd1', status: 'draft', revision: 2, replayed: true })
    await expect(createVersionDraft205(ORG, DRAFT, 2, 'key-1')).resolves.toEqual({ draftId: 'd1', revision: 2, replayed: true })
  })

  it('updates a draft and reports unchanged content without a new revision', async () => {
    ok({ draft_id: 'd1', status: 'draft', revision: 3, unchanged: true })
    await expect(updateVersionDraft205(ORG, 'd1', DRAFT, 2)).resolves.toEqual({ revision: 3, unchanged: true })
    expect(mockRpc).toHaveBeenCalledWith('rpc_update_mfg_cost_policy_draft_205', {
      p_org_id: ORG, p_draft_id: 'd1', p_draft: DRAFT, p_expected_latest_version_no: 2,
    })
  })

  it('creates a legacy resolution with its reason and key', async () => {
    ok({ draft_id: 'd2', status: 'draft', revision: 1, replayed: false })
    const resolution = { pools: [{ pool_code: 'LABOR_OH', activity: 'run' as const, budgets: ['ELEC'] }], budgets: [], setup_acks: [] }
    await createLegacyResolutionDraft205(ORG, 'ver-1', resolution, 'resolve v1', 'key-2')
    expect(mockRpc).toHaveBeenCalledWith('rpc_create_legacy_resolution_draft_205', {
      p_org_id: ORG, p_policy_version_id: 'ver-1', p_resolution: resolution, p_reason: 'resolve v1', p_idempotency_key: 'key-2',
    })
  })

  it('withdraws and rejects with a reason', async () => {
    ok({ draft_id: 'd1', status: 'withdrawn' })
    ok({ draft_id: 'd1', status: 'rejected' })
    await withdrawDraft205(ORG, 'd1', 'no longer needed')
    await rejectDraft205(ORG, 'd1', 'rates not agreed')
    expect(mockRpc.mock.calls).toEqual([
      ['rpc_withdraw_mfg_cost_policy_draft_205', { p_org_id: ORG, p_draft_id: 'd1', p_reason: 'no longer needed' }],
      ['rpc_reject_mfg_cost_policy_draft_205', { p_org_id: ORG, p_draft_id: 'd1', p_reason: 'rates not agreed' }],
    ])
  })

  it('approves the revision it is given and turns the cents of the reply into riyal', async () => {
    ok({ draft_id: 'd1', status: 'approved', policy_version_id: 'v3', self_approved: true, unallocated: { SUPERVISION: 480050, AUDIT: 5 }, exception: true })
    await expect(approveDraft205(ORG, 'd1', 4)).resolves.toEqual({
      policyVersionId: 'v3', selfApproved: true, exception: true,
      unallocated: [{ budgetCode: 'AUDIT', amount: '0.05' }, { budgetCode: 'SUPERVISION', amount: '4800.50' }],
    })
    expect(mockRpc).toHaveBeenCalledWith('rpc_approve_mfg_cost_policy_draft_205', { p_org_id: ORG, p_draft_id: 'd1', p_expected_revision: 4 })
  })

  it('refuses an approval reply whose unallocated is not a map of cents', async () => {
    ok({ draft_id: 'd1', policy_version_id: 'v3', self_approved: false, unallocated: [], exception: false })
    await expect(approveDraft205(ORG, 'd1', 1)).rejects.toThrow('COST_POLICY_205_RESPONSE_INVALID: unallocated')
  })

  it('changes the two approval settings and reads back their values', async () => {
    ok({ self_approval_enabled: true, unallocated_budget_policy: 'block' })
    ok({ self_approval_enabled: true, unallocated_budget_policy: 'controlled_exception' })
    await expect(setSelfApproval205(ORG, true, 'small team')).resolves.toEqual({ selfApprovalEnabled: true, unallocatedBudgetPolicy: 'block' })
    await expect(setUnallocatedPolicy205(ORG, 'controlled_exception', 'period costs')).resolves.toEqual({
      selfApprovalEnabled: true, unallocatedBudgetPolicy: 'controlled_exception',
    })
    expect(mockRpc.mock.calls.map(c => c[0])).toEqual(['rpc_set_cost_policy_self_approval_205', 'rpc_set_cost_policy_unallocated_policy_205'])
    expect(mockRpc.mock.calls[1][1]).toEqual({ p_org_id: ORG, p_policy: 'controlled_exception', p_reason: 'period costs' })
  })

  it('refuses a settings reply of another shape', async () => {
    ok({ self_approval_enabled: 'yes', unallocated_budget_policy: 'block' })
    await expect(setSelfApproval205(ORG, true, 'x')).rejects.toThrow('COST_POLICY_205_RESPONSE_INVALID: settings')
  })

  it('calls nothing without an organization', async () => {
    await expect(withdrawDraft205('', 'd1', 'r')).rejects.toThrow('ORG_UNRESOLVED')
    expect(mockRpc).not.toHaveBeenCalled()
  })
})

describe('preview and draft check (design §10 and §17)', () => {
  const preview = { labor: { source: 'work_center_rate', amount: 300 }, overhead: [], excluded_pools: [], overhead_total: 0, total: 300 }

  it('previews a stored version, sends no recorded cost when there is none, and keeps the riyal budgets outside the total', async () => {
    ok({ ...preview, unallocated_budgets: [{ budget_code: 'SUPERVISION', amount: 4800.5 }], cents: { labor: 30000 } })
    const result = await previewAbsorption205(ORG, { versionId: 'v2', workCenterId: 'wc-a', hours: { labor: { run: 10 } }, recordedLaborCost: null })
    expect(result.total).toBe(300)
    expect(result.unallocated_budgets).toEqual([{ budget_code: 'SUPERVISION', amount: 4800.5 }])
    expect(mockRpc).toHaveBeenCalledWith('rpc_preview_mfg_cost_absorption_205', {
      p_org_id: ORG, p_policy_version_id: 'v2', p_work_center_id: 'wc-a', p_hours: { labor: { run: 10 } },
    })
  })

  it('sends the recorded cost when given, and refuses a preview without its unallocated list', async () => {
    ok({ ...preview })
    await expect(previewAbsorption205(ORG, { versionId: 'v2', workCenterId: 'wc-a', hours: {}, recordedLaborCost: 12.5 }))
      .rejects.toThrow('COST_POLICY_205_RESPONSE_INVALID: unallocated_budgets')
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_recorded_labor_cost: 12.5 })
  })

  it('checks the revision on screen, without preview inputs when there is no work center', async () => {
    ok({
      draft_id: 'd1', kind: 'version', revision: 3, latest_version_no: 2, policy_at_check: { self_approval_enabled: false, unallocated_budget_policy: 'block' },
      valid: false, refusal: { code: 'COST_POLICY_POOL_WITHOUT_BUDGET', detail: 'MACHINE_OH' }, unallocated: [], preview: null, preview_refusal: null, checked_at: 't',
    })
    const result = await checkDraft205(ORG, { draftId: 'd1', revision: 3, workCenterId: null, hours: null, recordedLaborCost: null })
    expect(result).toMatchObject({ valid: false, refusal: { code: 'COST_POLICY_POOL_WITHOUT_BUDGET', detail: 'MACHINE_OH' }, preview: null })
    expect(mockRpc).toHaveBeenCalledWith('rpc_check_mfg_cost_policy_draft_205', { p_org_id: ORG, p_draft_id: 'd1', p_expected_revision: 3 })
  })

  it('returns the preview of a valid draft with its preview refusal, and the inputs it was given', async () => {
    ok({
      draft_id: 'd1', kind: 'version', revision: 3, latest_version_no: 2, policy_at_check: { self_approval_enabled: true, unallocated_budget_policy: 'controlled_exception' },
      valid: true, refusal: null, unallocated: [{ budget_code: 'SUPERVISION', amount: 4800.5 }], preview, preview_refusal: { code: 'COST_POLICY_DRIVER_MISSING' }, checked_at: 't',
    })
    const result = await checkDraft205(ORG, { draftId: 'd1', revision: 3, workCenterId: 'wc-a', hours: { machine: { setup: 0 } }, recordedLaborCost: 5 })
    expect(result.preview?.total).toBe(300)
    expect(result.previewRefusal).toEqual({ code: 'COST_POLICY_DRIVER_MISSING', detail: null })
    expect(mockRpc.mock.calls[0][1]).toEqual({
      p_org_id: ORG, p_draft_id: 'd1', p_expected_revision: 3, p_work_center_id: 'wc-a', p_hours: { machine: { setup: 0 } }, p_recorded_labor_cost: 5,
    })
  })

  it('never shows a check reply for another revision', async () => {
    ok({ draft_id: 'd1', revision: 4, latest_version_no: 2, policy_at_check: {}, valid: true, unallocated: [], checked_at: 't' })
    await expect(checkDraft205(ORG, { draftId: 'd1', revision: 3, workCenterId: null, hours: null, recordedLaborCost: null }))
      .rejects.toThrow('COST_POLICY_205_RESPONSE_INVALID: revision')
  })
})

describe('errors', () => {
  it('PGRST202 from a 205 write is a contract error, never an absence', async () => {
    fails({ code: 'PGRST202', message: 'Could not find the function public.rpc_reject_mfg_cost_policy_draft_205' })
    await expect(rejectDraft205(ORG, 'd1', 'r')).rejects.toThrow('COST_POLICY_205_CONTRACT_MISMATCH')
  })

  it('a revoked function is a closed action, and any other message passes as it is', async () => {
    fails({ code: '42501', message: 'permission denied for function rpc_approve_mfg_cost_policy_draft_205' })
    await expect(approveDraft205(ORG, 'd1', 1)).rejects.toThrow('COST_POLICY_FUNCTION_NOT_PERMITTED')
    fails({ code: 'P0001', message: 'COST_POLICY_DRAFT_REVISION_CONFLICT: current=4' })
    await expect(approveDraft205(ORG, 'd1', 1)).rejects.toThrow('COST_POLICY_DRAFT_REVISION_CONFLICT: current=4')
    fails({ message: '', code: '' })
    await expect(approveDraft205(ORG, 'd1', 1)).rejects.toThrow('RPC_ERROR')
  })

  it('groups each refusal by what the screen does next; a message that is not the server is an unknown outcome', () => {
    expect(errorGroup205(new Error('COST_POLICY_APPROVE_DENIED'))).toBe('permission')
    expect(errorGroup205(new Error('NOT_ORG_MEMBER'))).toBe('permission')
    expect(errorGroup205(new Error('COST_POLICY_DRAFT_NOT_PENDING'))).toBe('concurrency')
    expect(errorGroup205(new Error('TypeError: Failed to fetch'))).toBe('concurrency')
    expect(errorGroup205(new Error('COST_POLICY_SETTING_UNCHANGED'))).toBe('settings')
    expect(errorGroup205(new Error('COST_POLICY_UNKNOWN_KEY: budgets[1].cost_center'))).toBe('contract')
    expect(errorGroup205(new Error('COST_POLICY_POOL_WITHOUT_BUDGET: LABOR_OH'))).toBe('input')
    expect(serverRefusalCode('COST_POLICY_VERSION_CONFLICT: latest=3')).toBe('COST_POLICY_VERSION_CONFLICT')
    expect(errorKey205(new Error('Failed to fetch'))).toBeNull()
    expect(errorDetail205(new Error('COST_POLICY_VERSION_CONFLICT: latest=3'))).toBe('latest=3')
    expect(errorDetail205('COST_POLICY_INVALID:')).toBeNull()
  })

  /** Every refusal code the 205 file and the 204 withdrawal it reuses can raise, read from the files themselves. */
  it('has an Arabic and an English message for every code the server can raise', () => {
    const root = resolve(__dirname, '../../..')
    const m205 = readFileSync(resolve(root, 'sql/migrations/205_manufacturing_cost_policy_approval_and_overhead.sql'), 'utf8')
    const m204 = readFileSync(resolve(root, 'sql/migrations/204_manufacturing_cost_policies.sql'), 'utf8')
    const withdraw = m204.slice(m204.indexOf('CREATE FUNCTION public.rpc_withdraw_mfg_cost_policy_version'))
    const withdrawBody = withdraw.slice(0, withdraw.indexOf('$fn$;', withdraw.indexOf('$fn$') + 4))
    const codes = new Set<string>(['NOT_AUTHENTICATED', 'NOT_ORG_MEMBER', 'ORG_UNRESOLVED', 'COST_POLICY_ORG_TIMEZONE_INVALID'])
    for (const text of [m205, withdrawBody]) {
      for (const m of text.matchAll(/'((?:COST_POLICY|MANUFACTURING_SETTINGS)_[A-Z0-9_]+)/g)) codes.add(m[1])
    }
    expect(codes.size).toBeGreaterThan(60)
    const errorsOf = (lang: { manufacturingSettings: { costPolicy205: unknown } }) => (lang.manufacturingSettings.costPolicy205 as { errors: Record<string, string> }).errors
    const missing = [...codes].filter(c => !errorsOf(ar)[c] || !errorsOf(en)[c])
    expect(missing).toEqual([])
  })
})

describe('amounts', () => {
  it('turns whole cents into riyal by text, never by a float', () => {
    expect(centsToRiyal(480050)).toBe('4800.50')
    expect(centsToRiyal(5)).toBe('0.05')
    expect(centsToRiyal(100)).toBe('1.00')
    expect(centsToRiyal(0)).toBe('0.00')
    expect(centsToRiyal(-5)).toBe('-0.05')
    expect(centsToRiyal('900719925474099312')).toBe('9007199254740993.12')
  })

  it('refuses anything that is not whole cents, so no amount is shown a hundred times off', () => {
    expect(() => centsToRiyal(4800.5)).toThrow('COST_POLICY_205_RESPONSE_INVALID: cents')
    expect(() => centsToRiyal('48.00')).toThrow('COST_POLICY_205_RESPONSE_INVALID: cents')
    expect(() => centsToRiyal(null)).toThrow('COST_POLICY_205_RESPONSE_INVALID: cents')
  })
})

describe('budget accounts', () => {
  it('lists the active accounts of the organization it is given', async () => {
    fromRows = [{ id: 'gl-1', code: '5100', name: 'Electricity', name_ar: 'كهرباء' }]
    await expect(listBudgetGlAccounts205(ORG)).resolves.toEqual([{ id: 'gl-1', code: '5100', name: 'Electricity', nameAr: 'كهرباء' }])
    expect(fromCalls).toEqual([['gl_accounts.org_id', ORG], ['gl_accounts.is_active', true]])
  })
})
