import { describe, expect, it } from 'vitest'
import { parseCostPolicy205State } from '@/services/mfg-cost-policy-205-service'
import { cp205Response, SESSION_USER } from '../../../../../tests/fixtures/cost-policy-205'
import {
  ackCandidates,
  allocationWarnings,
  buildHours,
  buildResolutionPayload,
  buildVersionPayload,
  emptyBudget,
  emptyHours,
  formFromLatestVersion,
  formFromVersionPayload,
  hasInvalidNumber,
  keyForContent,
  legacyFormFor,
  unallocatedCodes,
  type VersionDraftForm,
} from '../costPolicy205Draft'

const state = parseCostPolicy205State(cp205Response(), SESSION_USER)

function form(patch: Partial<VersionDraftForm> = {}): VersionDraftForm {
  return {
    effective_from: '2026-12-01', labor_cost_source: 'work_center_rate', default_labor_rate: '30', pin_event: 'mo_created', note: '',
    pools: [
      { pool_code: 'labor_oh', name: 'Labor', name_ar: '', basis: 'labor_hours', rate: '12.125', activity: 'run', budgets: ['ELEC', 'SETUP_CREW'] },
      { pool_code: 'MACHINE_OH', name: 'Machine', name_ar: 'آلات', basis: 'machine_hours', rate: '46', activity: 'both', budgets: ['DEPR'] },
    ],
    rules: [],
    budgets: [
      { budget_code: 'ELEC', gl_account_id: 'gl-1', setup_related: false, amount: '9000', planned_hours: '' },
      { budget_code: 'SETUP_CREW', gl_account_id: 'gl-2', setup_related: true, amount: '3600', planned_hours: '60' },
      { budget_code: 'DEPR', gl_account_id: 'gl-3', setup_related: false, amount: '15000', planned_hours: '' },
      { budget_code: 'SUPERVISION', gl_account_id: 'gl-4', setup_related: false, amount: '4800.50', planned_hours: '' },
    ],
    acks: ['LABOR_OH/SETUP_CREW'],
    exception: { reason: ' period cost ', treatment: ' unabsorbed ' },
    ...patch,
  }
}

describe('the version payload (design §7, §11 and §12)', () => {
  it('sends rates and amounts as JSON numbers, codes upper-cased, and no cost center or identity field', () => {
    const payload = buildVersionPayload(form(), 'controlled_exception')
    expect(payload.overhead_pools[0]).toEqual({ pool_code: 'LABOR_OH', name: 'Labor', basis: 'labor_hours', rate: 12.125, activity: 'run', budgets: ['ELEC', 'SETUP_CREW'] })
    expect(payload.overhead_pools[1].name_ar).toBe('آلات')
    expect(payload.default_labor_rate_per_hour).toBe(30)
    expect(payload.budgets[1]).toEqual({ budget_code: 'SETUP_CREW', gl_account_id: 'gl-2', setup_related: true, amount: 3600, planned_hours: 60 })
    expect(JSON.stringify(payload)).not.toMatch(/cost_center|created_by|approved_by|user_id/)
    expect(hasInvalidNumber(payload)).toBe(false)
  })

  it('fills the exception with every unloaded budget, under controlled_exception only', () => {
    expect(buildVersionPayload(form(), 'controlled_exception').unallocated_exception).toEqual({
      budgets: ['SUPERVISION'], reason: 'period cost', treatment: 'unabsorbed',
    })
    expect(buildVersionPayload(form(), 'block').unallocated_exception).toBeUndefined()
    const allLoaded = form({ budgets: form().budgets.slice(0, 3) })
    expect(buildVersionPayload(allLoaded, 'controlled_exception').unallocated_exception).toBeUndefined()
  })

  it('sends an acknowledgement only for a setup budget still loaded on a run pool', () => {
    expect(buildVersionPayload(form(), 'block').setup_acks).toEqual([{ pool_code: 'LABOR_OH', budget_code: 'SETUP_CREW' }])
    const both = form({ pools: form().pools.map(p => ({ ...p, activity: 'both' as const })) })
    expect(buildVersionPayload(both, 'block').setup_acks).toEqual([])
  })

  it('leaves out the labor rates under recorded entry rates, and keeps only rules for pools of this version', () => {
    const payload = buildVersionPayload(form({
      labor_cost_source: 'recorded_entry_rate', note: '  first 205 version ',
      rules: [
        { work_center_id: 'wc-a', labor_rate: '40', pools: { LABOR_OH: { mode: 'exclude', rate: '' }, MACHINE_OH: { mode: 'override', rate: '50' }, GONE: { mode: 'exclude', rate: '' } } },
        { work_center_id: '', labor_rate: '', pools: {} },
        { work_center_id: 'wc-b', labor_rate: '', pools: { LABOR_OH: { mode: 'default', rate: '' } } },
      ],
    }), 'block')
    expect(payload.default_labor_rate_per_hour).toBeUndefined()
    expect(payload.note).toBe('first 205 version')
    expect(payload.work_center_rules).toEqual([
      { work_center_id: 'wc-a', pools: [{ pool_code: 'LABOR_OH', applies: false }, { pool_code: 'MACHINE_OH', applies: true, rate: 50 }] },
      { work_center_id: 'wc-b' },
    ])
  })

  it('marks a number that cannot be read, so nothing is sent with a null in its place', () => {
    expect(hasInvalidNumber(buildVersionPayload(form({ default_labor_rate: '3,5' }), 'block'))).toBe(true)
    expect(hasInvalidNumber(buildVersionPayload(form({ pools: [{ ...form().pools[0], rate: '' }] }), 'block'))).toBe(true)
    expect(hasInvalidNumber(buildVersionPayload(form({ pools: [{ ...form().pools[0], rate: '1.1234567' }] }), 'block'))).toBe(true)
  })
})

describe('forms from the server', () => {
  it('prefills a new draft from the latest live version, with its 205 activities and budgets', () => {
    const f = formFromLatestVersion(state)
    expect(f.effective_from).toBe(state.today)
    expect(f.pools.map(p => [p.pool_code, p.activity, p.budgets])).toEqual([['LABOR_OH', 'both', ['ELECTRICITY']], ['MACHINE_OH', 'run', ['DEPRECIATION']]])
    expect(f.budgets.map(b => [b.budget_code, b.gl_account_id, b.amount])).toEqual([['DEPRECIATION', 'gl-2', '15000'], ['ELECTRICITY', 'gl-1', '9000'], ['SUPERVISION', 'gl-3', '4800.5']])
  })

  it('starts with one empty pool when no version exists', () => {
    const empty = parseCostPolicy205State(cp205Response({ versions: [], current_version_id: null, latest_version_no: 0, drafts: [] }), SESSION_USER)
    const f = formFromLatestVersion(empty)
    expect(f.pools).toHaveLength(1)
    expect(f.pools[0].pool_code).toBe('')
    expect(f.budgets).toEqual([])
  })

  it('reads a saved draft back into the same payload', () => {
    const original = buildVersionPayload(form({ rules: [{ work_center_id: 'wc-a', labor_rate: '40', pools: { MACHINE_OH: { mode: 'exclude', rate: '' } } }] }), 'controlled_exception')
    const again = formFromVersionPayload(original as unknown as Record<string, unknown>, state)
    expect(buildVersionPayload(again, 'controlled_exception')).toEqual(original)
  })

  it('reads a sparse draft without failing', () => {
    const f = formFromVersionPayload({ labor_cost_source: 'recorded_entry_rate', pin_event: 'production_started' }, state)
    expect(f).toMatchObject({ effective_from: state.today, labor_cost_source: 'recorded_entry_rate', pin_event: 'production_started', pools: [], budgets: [] })
  })
})

describe('legacy resolution (design §9)', () => {
  it('covers exactly the pools of the version, with the budgets, acknowledgements and exception', () => {
    const version = state.versions.find(v => v.policy_205 === 'legacy_unresolved')!
    const f = legacyFormFor(version)
    expect(f.pools.map(p => p.pool_code)).toEqual(['LABOR_OH', 'MACHINE_OH'])
    f.pools = [{ pool_code: 'LABOR_OH', activity: 'run', budgets: ['ELEC'] }, { pool_code: 'MACHINE_OH', activity: '', budgets: [] }]
    f.budgets = [{ ...emptyBudget(), budget_code: 'ELEC', amount: '9000' }, { ...emptyBudget(), budget_code: 'AUDIT', amount: '100' }]
    f.exception = { reason: 'r', treatment: 't' }
    expect(buildResolutionPayload(f, 'controlled_exception')).toEqual({
      pools: [{ pool_code: 'LABOR_OH', activity: 'run', budgets: ['ELEC'] }, { pool_code: 'MACHINE_OH', budgets: [] }],
      budgets: [{ budget_code: 'ELEC', setup_related: false, amount: 9000 }, { budget_code: 'AUDIT', setup_related: false, amount: 100 }],
      setup_acks: [],
      unallocated_exception: { budgets: ['AUDIT'], reason: 'r', treatment: 't' },
    })
  })
})

describe('early warnings are named after the server codes', () => {
  it('flags an unset activity, an empty pool, an unknown or doubled budget, a missing account, a bad code, a missing acknowledgement and a blocked unloaded budget', () => {
    const f = form({
      pools: [
        { pool_code: 'A', name: '', name_ar: '', basis: 'labor_hours', rate: '1', activity: '', budgets: ['ELEC', 'NOPE'] },
        { pool_code: 'B', name: '', name_ar: '', basis: 'labor_hours', rate: '1', activity: 'run', budgets: ['ELEC', 'SETUP_CREW'] },
        { pool_code: 'C', name: '', name_ar: '', basis: 'labor_hours', rate: '1', activity: 'run', budgets: [] },
      ],
      budgets: [
        { budget_code: 'ELEC', gl_account_id: '', setup_related: false, amount: '1', planned_hours: '' },
        { budget_code: 'SETUP_CREW', gl_account_id: 'gl', setup_related: true, amount: '1', planned_hours: '' },
        { budget_code: 'x', gl_account_id: 'gl', setup_related: false, amount: '1', planned_hours: '' },
      ],
      acks: [],
    })
    const codes = allocationWarnings(f.pools, f, 'block').map(w => `${w.code} ${w.detail}`)
    expect(codes).toEqual([
      'COST_POLICY_POOL_ACTIVITY_UNSET A',
      'COST_POLICY_BUDGET_UNKNOWN A/NOPE',
      'COST_POLICY_POOL_WITHOUT_BUDGET C',
      'COST_POLICY_BUDGET_DOUBLE_ALLOCATION ELEC',
      'COST_POLICY_BUDGET_ACCOUNT_REQUIRED ELEC',
      'COST_POLICY_INVALID budget_code X',
      'COST_POLICY_SETUP_TREATMENT_UNSET B/SETUP_CREW',
      'COST_POLICY_BUDGET_UNALLOCATED X',
    ])
    expect(allocationWarnings(f.pools, f, 'controlled_exception').some(w => w.code === 'COST_POLICY_BUDGET_UNALLOCATED')).toBe(false)
  })

  it('lists unloaded budgets and acknowledgement candidates', () => {
    expect(unallocatedCodes(form().pools, form().budgets)).toEqual(['SUPERVISION'])
    expect(ackCandidates(form().pools, form().budgets)).toEqual([{ pool: 'LABOR_OH', budget: 'SETUP_CREW' }])
  })
})

describe('one idempotency key per content (design §6)', () => {
  it('keeps the key for the same content and makes a new one when the content changes', () => {
    let n = 0
    const gen = () => `k${++n}`
    const first = keyForContent(null, 'A', gen)
    expect(keyForContent(first, 'A', gen)).toBe(first)
    const second = keyForContent(first, 'B', gen)
    expect(second).toEqual({ key: 'k2', fingerprint: 'B' })
  })
})

describe('preview hours (design §10)', () => {
  it('sends a measured zero, leaves out an empty field, and refuses text that is not a number', () => {
    expect(buildHours(emptyHours())).toEqual({})
    expect(buildHours({ laborRun: '10', laborSetup: '', machineRun: '', machineSetup: '0' })).toEqual({ labor: { run: 10 }, machine: { setup: 0 } })
    expect(buildHours({ laborRun: '', laborSetup: '2.5', machineRun: '3', machineSetup: '' })).toEqual({ labor: { setup: 2.5 }, machine: { run: 3 } })
    expect(buildHours({ ...emptyHours(), laborRun: '-1' })).toBeNull()
  })
})
