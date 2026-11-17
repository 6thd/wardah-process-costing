import { describe, expect, it } from 'vitest'
import { parseCostPolicy205State } from '@/services/mfg-cost-policy-205-service'
import pg17 from '@/services/__tests__/fixtures/cost-policy-205-get.pg17.json'
import { cp205Response, ORG, SESSION_USER } from '../../../../../tests/fixtures/cost-policy-205'
import {
  ackCandidates,
  allocationWarnings,
  approvedPlannedHours,
  buildHours,
  buildResolutionPayload,
  buildVersionPayload,
  budgetRemap,
  earliestEffectiveFrom,
  editBudget,
  emptyBudget,
  emptyRuleCenters,
  emptyHours,
  formFromLatestVersion,
  formFromVersionPayload,
  hasInvalidNumber,
  keyForContent,
  legacyFormFor,
  remapAcks,
  remapPools,
  removeBudget,
  renamePool,
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
    plannedHoursUnknown: [],
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
    // wc-b carries nothing the server accepts (COST_POLICY_WC_RULE_EMPTY), so it is not sent (Codex P2 on #334).
    expect(payload.work_center_rules).toEqual([
      { work_center_id: 'wc-a', pools: [{ pool_code: 'LABOR_OH', applies: false }, { pool_code: 'MACHINE_OH', applies: true, rate: 50 }] },
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
    // ver-2 starts on 2026-11-10, after today (2026-11-02): the first date the server accepts is the day after.
    expect(f.effective_from).toBe('2026-11-11')
    expect(f.pools.map(p => [p.pool_code, p.activity, p.budgets])).toEqual([['LABOR_OH', 'both', ['ELECTRICITY']], ['MACHINE_OH', 'run', ['DEPRECIATION']]])
    expect(f.budgets.map(b => [b.budget_code, b.gl_account_id, b.amount])).toEqual([['DEPRECIATION', 'gl-2', '15000'], ['ELECTRICITY', 'gl-1', '9000'], ['SUPERVISION', 'gl-3', '4800.5']])
  })

  it('keeps the planned hours of the approved budgets: read from the approved draft that produced the version (Codex P2 on #334)', () => {
    // The reply of the merged 205 on PostgreSQL 17: data_205 has no planned hours; the approved draft of the latest version has SETUP_CREW = 60.
    const real = parseCostPolicy205State(pg17.reply, pg17.session_user)
    const f = formFromLatestVersion(real)
    expect(f.budgets.map(b => [b.budget_code, b.planned_hours])).toEqual([['DEPRECIATION', ''], ['ELECTRICITY', ''], ['SETUP_CREW', '60'], ['SUPERVISION', '']])
    expect(f.plannedHoursUnknown).toEqual([])
    expect(buildVersionPayload(f, real.settings.unallocatedBudgetPolicy).budgets.find(b => b.budget_code === 'SETUP_CREW')?.planned_hours).toBe(60)
  })

  it('names every budget whose planned hours cannot be read, instead of dropping them silently', () => {
    // The fixture's approved draft of ver-2 holds no budgets, so nothing can be read for them.
    expect(formFromLatestVersion(state).plannedHoursUnknown).toEqual(['DEPRECIATION', 'ELECTRICITY', 'SUPERVISION'])
    expect(approvedPlannedHours(state, 'ver-1')).toBeNull()
    const noDraft = parseCostPolicy205State(cp205Response({ drafts: [] }), SESSION_USER)
    expect(formFromLatestVersion(noDraft).plannedHoursUnknown).toEqual(['DEPRECIATION', 'ELECTRICITY', 'SUPERVISION'])
    expect(ORG).toBe(state.orgId)
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

describe('a budget code removed or renamed leaves no stale reference (Codex P2 on #334)', () => {
  const b = (budget_code: string) => ({ ...emptyBudget(), budget_code })
  const pools = [
    { pool_code: 'LABOR_OH', name: 'L', name_ar: '', basis: 'labor_hours' as const, rate: '1', activity: 'run' as const, budgets: ['ELEC', 'SETUP'] },
    { pool_code: 'MACHINE_OH', name: 'M', name_ar: '', basis: 'machine_hours' as const, rate: '2', activity: 'both' as const, budgets: ['DEPR', 'ELEC'] },
  ]
  const alloc = { budgets: [b('ELEC'), b('setup'), b('DEPR')], acks: ['LABOR_OH/SETUP', 'LABOR_OH/ELEC'], exception: { reason: '', treatment: '' } }

  it('removal takes the code out of every pool and acknowledgement, and keeps the other pool fields', () => {
    const { form: next, remap } = removeBudget(alloc, 0)
    expect(remap).toEqual({ from: 'ELEC', to: '' })
    expect(next.budgets.map(x => x.budget_code)).toEqual(['setup', 'DEPR'])
    expect(next.acks).toEqual(['LABOR_OH/SETUP'])
    const moved = remapPools(pools, remap!)
    expect(moved.map(p => p.budgets)).toEqual([['SETUP'], ['DEPR']])
    expect(moved[1]).toMatchObject({ name: 'M', basis: 'machine_hours', rate: '2', activity: 'both' })
    expect(allocationWarnings(moved, next, 'controlled_exception').filter(w => w.code === 'COST_POLICY_BUDGET_UNKNOWN')).toEqual([])
  })

  it('a rename moves the references to the new code, without duplicates', () => {
    const { form: next, remap } = editBudget(alloc, 1, { budget_code: 'crew' })
    expect(remap).toEqual({ from: 'SETUP', to: 'CREW' })
    expect(next.acks).toEqual(['LABOR_OH/CREW', 'LABOR_OH/ELEC'])
    expect(remapPools(pools, remap!)[0].budgets).toEqual(['ELEC', 'CREW'])
    expect(remapPools(pools, { from: 'ELEC', to: 'DEPR' })[1].budgets).toEqual(['DEPR'])
    expect(remapAcks(['A/X', 'B/Y'], { from: 'X', to: 'Y' })).toEqual(['A/Y', 'B/Y'])
  })

  it('leaves the references when the code stays, the row had none, or another row still has the old code', () => {
    expect(budgetRemap(alloc.budgets, 0, ' elec ')).toBeNull()
    expect(budgetRemap([b(''), b('ELEC')], 0, 'NEW')).toBeNull()
    expect(budgetRemap([b('ELEC'), b('elec')], 0, 'POWER')).toBeNull()
    expect(removeBudget({ ...alloc, budgets: [b('ELEC'), b('ELEC')] }, 0).remap).toBeNull()
    expect(editBudget(alloc, 0, { amount: '5' }).remap).toBeNull()
  })
})

describe('drafts the server would refuse as typed (Codex P2 on #334)', () => {
  type V = { id: string; effective_from: string; status: string }
  const withVersions = (list: V[]) => {
    const [template] = cp205Response().versions as Array<Record<string, unknown>>
    return parseCostPolicy205State(cp205Response({ versions: list.map(x => ({ ...template, ...x })), drafts: [] }), SESSION_USER)
  }

  it('the earliest effective date is after the latest version not withdrawn, when that version starts today or later', () => {
    expect(earliestEffectiveFrom(state)).toBe('2026-11-11')
    expect(earliestEffectiveFrom(withVersions([{ id: 'a', effective_from: '2026-11-02', status: 'current' }]))).toBe('2026-11-03')
    expect(earliestEffectiveFrom(withVersions([{ id: 'a', effective_from: '2026-11-30', status: 'scheduled' }]))).toBe('2026-12-01')
    expect(earliestEffectiveFrom(withVersions([{ id: 'a', effective_from: '2026-10-01', status: 'current' }]))).toBe('2026-11-02')
    expect(earliestEffectiveFrom(withVersions([
      { id: 'a', effective_from: '2026-10-01', status: 'current' }, { id: 'b', effective_from: '2026-12-31', status: 'withdrawn' },
    ]))).toBe('2026-11-02')
    expect(earliestEffectiveFrom(withVersions([]))).toBe('2026-11-02')
  })

  it('a pool code change moves the rule keys and acknowledgements, and an empty field on the way keeps them', () => {
    const f = form({ rules: [{ work_center_id: 'wc-a', labor_rate: '', pools: { LABOR_OH: { mode: 'override', rate: '20' }, MACHINE_OH: { mode: 'exclude', rate: '' } } }] })
    const cleared = { ...f, ...renamePool(f, 0, '') }
    expect(cleared.acks).toEqual(['/SETUP_CREW'])
    const next = { ...cleared, ...renamePool(cleared, 0, 'crew_oh') }
    expect(next.pools[0].pool_code).toBe('crew_oh')
    expect(next.rules[0].pools).toEqual({ MACHINE_OH: { mode: 'exclude', rate: '' }, CREW_OH: { mode: 'override', rate: '20' } })
    expect(next.acks).toEqual(['CREW_OH/SETUP_CREW'])
    expect(buildVersionPayload(next, 'block').work_center_rules[0].pools).toEqual([
      { pool_code: 'MACHINE_OH', applies: false }, { pool_code: 'CREW_OH', applies: true, rate: 20 },
    ])
    expect(buildVersionPayload(next, 'block').setup_acks).toEqual([{ pool_code: 'CREW_OH', budget_code: 'SETUP_CREW' }])
  })

  it('a pool code change leaves the references when the code stays, or another pool has the old or the new code', () => {
    const f = form({ rules: [{ work_center_id: 'wc-a', labor_rate: '', pools: { LABOR_OH: { mode: 'exclude', rate: '' } } }] })
    expect(renamePool(f, 0, ' labor_oh ').rules).toBe(f.rules)
    const onto = renamePool(f, 0, 'machine_oh')
    expect([onto.rules, onto.acks]).toEqual([f.rules, f.acks])
    const twins = form({ ...f, pools: [f.pools[0], { ...f.pools[0], name: 'twin' }] })
    expect(renamePool(twins, 0, 'NEW').rules).toBe(twins.rules)
  })

  it('names the work centers whose rule carries nothing, and leaves them out of the payload', () => {
    const f = form({
      rules: [
        { work_center_id: 'wc-a', labor_rate: '40', pools: {} },
        { work_center_id: 'wc-b', labor_rate: '', pools: { GONE: { mode: 'exclude', rate: '' } } },
        { work_center_id: '', labor_rate: '', pools: {} },
      ],
    })
    expect(emptyRuleCenters(f)).toEqual(['wc-b'])
    const recorded = { ...f, labor_cost_source: 'recorded_entry_rate' as const }
    expect(emptyRuleCenters(recorded)).toEqual(['wc-a', 'wc-b'])
    expect(buildVersionPayload(recorded, 'block').work_center_rules).toEqual([])
  })
})
