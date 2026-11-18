/**
 * نموذج مسودات 205 في الواجهة، بلا React: حالة النموذج كما تُكتب، وتحويلها إلى الحمولة
 * التي يقبلها الخادم حرفيًا، وتنبيهات الإدخال المبكرة (التصميم §7 و§9 و§11 و§12).
 *
 * التنبيهات للإدخال فقط ولا تضمن الاعتماد: قواعد `validate_205` تعمل عند الاعتماد وفي الفحص (§17).
 * لا حقل مركز تكلفة في أي مكان هنا، ولا حقل هوية.
 */
import type {
  CostPolicy205State,
  CostPolicyVersion205,
  PoolActivity,
  UnallocatedBudgetPolicy,
} from '@/services/mfg-cost-policy-205-service'
import type {
  DraftBudget205,
  DraftException205,
  DraftSetupAck205,
  Hours205,
  LegacyResolutionPayload205,
  VersionDraftPayload205,
} from '@/services/mfg-cost-policy-205-write-service'
import type { LaborCostSource, OverheadBasis, PinEvent } from '@/services/mfg-cost-policy-service'

export type PoolMode = 'default' | 'override' | 'exclude'

/** نشاط المجمع وموازناته: مشترك بين مسودة الإصدار ومعالجة القديم. */
export interface AllocationPool { pool_code: string; activity: PoolActivity | ''; budgets: string[] }

export interface VersionPoolForm extends AllocationPool { name: string; name_ar: string; basis: OverheadBasis; rate: string }

export interface BudgetForm { budget_code: string; gl_account_id: string; setup_related: boolean; amount: string; planned_hours: string }

export interface RuleForm { work_center_id: string; labor_rate: string; pools: Record<string, { mode: PoolMode; rate: string }> }

export interface ExceptionForm { reason: string; treatment: string }

/** الموازنات والإقرارات والاستثناء. الإقرار مفتاحه `POOL/BUDGET`. */
export interface AllocationForm { budgets: BudgetForm[]; acks: string[]; exception: ExceptionForm }

export interface VersionDraftForm extends AllocationForm {
  effective_from: string
  labor_cost_source: LaborCostSource
  default_labor_rate: string
  pin_event: PinEvent
  note: string
  pools: VersionPoolForm[]
  rules: RuleForm[]
  /** موازنات لم تُقرأ ساعاتها المخططة من الإصدار المنسوخ عنه (لا تُرسل؛ تنبيه في النموذج فقط). */
  plannedHoursUnknown: string[]
}

export interface LegacyResolutionForm extends AllocationForm { pools: AllocationPool[]; reason: string }

export const BUDGET_CODE_PATTERN = /^[A-Z][A-Z0-9_]{1,29}$/
export const MAX_BUDGETS = 100
export const MAX_POOLS = 20
/** رقم موجب أو صفر بست خانات على الأكثر، كما يكتبه المستخدم. */
const DECIMAL = /^\d+(\.\d{1,6})?$/

export const code = (value: string): string => value.trim().toUpperCase()
export const ackKey = (pool: string, budget: string): string => `${pool}/${budget}`

/** نص رقمي إلى رقم JSON، والفارغ إلى `undefined`. لا يقبل نصًا لا يطابق النمط. */
export function decimalOrUndefined(text: string): number | undefined {
  const t = text.trim()
  if (t === '') return undefined
  return DECIMAL.test(t) ? Number(t) : Number.NaN
}

export const emptyBudget = (): BudgetForm => ({ budget_code: '', gl_account_id: '', setup_related: false, amount: '', planned_hours: '' })
export const emptyException = (): ExceptionForm => ({ reason: '', treatment: '' })

const text = (value: unknown): string => (value === null || value === undefined ? '' : String(value))
const obj = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])
const strings = (value: unknown): string[] => list(value).filter((v): v is string => typeof v === 'string')
const activityOf = (value: unknown): PoolActivity | '' => (value === 'run' || value === 'setup' || value === 'both' ? value : '')

// ---------------------------------------------------------------------------
// من الخادم إلى النموذج
// ---------------------------------------------------------------------------

function budgetsFromPayload(value: unknown): BudgetForm[] {
  return list(value).map(raw => {
    const b = obj(raw)
    return {
      budget_code: text(b.budget_code), gl_account_id: text(b.gl_account_id), setup_related: b.setup_related === true,
      amount: text(b.amount), planned_hours: text(b.planned_hours),
    }
  })
}

function acksFromPayload(value: unknown): string[] {
  return list(value).map(raw => obj(raw)).map(a => ackKey(text(a.pool_code), text(a.budget_code)))
}

function exceptionFromPayload(value: unknown): ExceptionForm {
  const e = obj(value)
  return { reason: text(e.reason), treatment: text(e.treatment) }
}

function rulesFromPayload(value: unknown): RuleForm[] {
  return list(value).map(raw => {
    const r = obj(raw)
    return {
      work_center_id: text(r.work_center_id),
      labor_rate: text(r.labor_rate_per_hour),
      pools: Object.fromEntries(list(r.pools).map(p => obj(p)).map(p => [text(p.pool_code), {
        mode: (p.applies === false ? 'exclude' : 'override') as PoolMode, rate: text(p.rate),
      }])),
    }
  })
}

/** مسودة محفوظة (للتعديل أو النسخ إلى مسودة جديدة). تاريخ فات يُستبدل باليوم عند النسخ فقط. */
export function formFromVersionPayload(payload: Record<string, unknown>, state: CostPolicy205State): VersionDraftForm {
  const source = payload.labor_cost_source === 'recorded_entry_rate' ? 'recorded_entry_rate' : 'work_center_rate'
  return {
    effective_from: text(payload.effective_from) || state.today,
    labor_cost_source: source,
    default_labor_rate: text(payload.default_labor_rate_per_hour),
    pin_event: payload.pin_event === 'production_started' ? 'production_started' : 'mo_created',
    note: text(payload.note),
    pools: list(payload.overhead_pools).map(raw => {
      const p = obj(raw)
      return {
        pool_code: text(p.pool_code), name: text(p.name), name_ar: text(p.name_ar),
        basis: p.basis === 'machine_hours' ? 'machine_hours' : 'labor_hours', rate: text(p.rate),
        activity: activityOf(p.activity), budgets: strings(p.budgets),
      }
    }),
    rules: rulesFromPayload(payload.work_center_rules),
    budgets: budgetsFromPayload(payload.budgets),
    acks: acksFromPayload(payload.setup_acks),
    exception: exceptionFromPayload(payload.unallocated_exception),
    plannedHoursUnknown: [],
  }
}

/**
 * الساعات المخططة لموازنات إصدار معتمد. `data_205` لا يحملها، والخادم أدخلها عند الاعتماد من حمولة المسودة
 * المعتمدة نفسها (205: `mfg_cost_policy_budgets_205.planned_hours`)، فتُقرأ من تلك الحمولة: المسودة التي
 * `result_version_id` لها هو الإصدار، إصدارًا كانت أو معالجة قديم. `null` إن لم توجد تلك المسودة.
 */
export function approvedPlannedHours(state: CostPolicy205State, versionId: string): Map<string, string> | null {
  const source = state.drafts.find(d => d.status === 'approved' && d.result_version_id === versionId)
  if (!source) return null
  return new Map(budgetsFromPayload(source.payload.budgets).map(b => [code(b.budget_code), b.planned_hours]))
}

const nextDay = (iso: string): string => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/**
 * أقرب تاريخ سريان يقبله الخادم لمسودة جديدة: اليوم، أو اليوم التالي لآخر بدء بين الإصدارات غير المسحوبة
 * إن كان ذلك البدء اليوم أو بعده (205: COST_POLICY_EFFECTIVE_DATE_IN_PAST و_NOT_AFTER_LATEST؛ Codex P2 على #334).
 */
export function earliestEffectiveFrom(state: CostPolicy205State): string {
  const latest = state.versions
    .filter(v => v.status !== 'withdrawn')
    .reduce<string | null>((max, v) => (max === null || v.effective_from > max ? v.effective_from : max), null)
  return latest !== null && latest >= state.today ? nextDay(latest) : state.today
}

/** مسودة جديدة مملوءة من آخر إصدار حي (حقول 204، ونشاط المجمعات وموازناتها إن وُجدت). */
export function formFromLatestVersion(state: CostPolicy205State): VersionDraftForm {
  const base = state.versions.find(v => v.status !== 'withdrawn')
  const data = base?.data_205
  const pool205 = new Map((data?.pools ?? []).map(p => [p.code, p]))
  const planned = base ? approvedPlannedHours(state, base.id) : null
  const budgets = data?.budgets ?? []
  return {
    effective_from: earliestEffectiveFrom(state),
    labor_cost_source: base?.labor_cost_source ?? state.supported.laborCostSources[0] ?? 'work_center_rate',
    default_labor_rate: text(base?.default_labor_rate_per_hour),
    pin_event: base?.pin_event ?? state.supported.pinEvents[0] ?? 'mo_created',
    note: '',
    pools: base
      ? base.overhead_pools.map(p => ({
        pool_code: p.pool_code, name: p.name, name_ar: p.name_ar ?? '', basis: p.basis, rate: String(p.rate),
        activity: activityOf(pool205.get(p.pool_code)?.activity), budgets: [...(pool205.get(p.pool_code)?.budgets ?? [])],
      }))
      : [{ pool_code: '', name: '', name_ar: '', basis: state.supported.overheadBases[0] ?? 'labor_hours', rate: '', activity: '', budgets: [] }],
    rules: (base?.work_center_rules ?? []).map(r => ({
      work_center_id: r.work_center_id,
      labor_rate: text(r.labor_rate_per_hour),
      pools: Object.fromEntries(r.pools.map(p => [p.pool_code, { mode: (p.applies ? 'override' : 'exclude') as PoolMode, rate: text(p.rate) }])),
    })),
    budgets: budgets.map(b => ({
      budget_code: b.code, gl_account_id: b.gl_account ?? '', setup_related: b.setup, amount: text(b.amount),
      planned_hours: planned?.get(b.code) ?? '',
    })),
    acks: (data?.setup_acks ?? []).flatMap(a => a.budgets.map(b => ackKey(a.pool, b))),
    exception: emptyException(),
    plannedHoursUnknown: planned ? budgets.filter(b => !planned.has(b.code)).map(b => b.code) : budgets.map(b => b.code),
  }
}

/** معالجة إصدار قديم: مجمعاته بالضبط، بلا نشاط ولا موازنات بعد (§9). */
export function legacyFormFor(version: CostPolicyVersion205): LegacyResolutionForm {
  return {
    pools: version.overhead_pools.map(p => ({ pool_code: p.pool_code, activity: '', budgets: [] })),
    budgets: [], acks: [], exception: emptyException(), reason: '',
  }
}

// ---------------------------------------------------------------------------
// الحسابات المساعدة
// ---------------------------------------------------------------------------

/** موازنات لا يحمّلها أي مجمع، بترتيب إدخالها. */
export function unallocatedCodes(pools: readonly AllocationPool[], budgets: readonly BudgetForm[]): string[] {
  const owned = new Set(pools.flatMap(p => p.budgets))
  return budgets.map(b => code(b.budget_code)).filter(c => c !== '' && !owned.has(c))
}

/** أزواج تحتاج إقرارًا: موازنة إعداد في مجمع نشاطه `run` (§7). */
export function ackCandidates(pools: readonly AllocationPool[], budgets: readonly BudgetForm[]): Array<{ pool: string; budget: string }> {
  const setup = new Set(budgets.filter(b => b.setup_related).map(b => code(b.budget_code)))
  return pools
    .filter(p => p.activity === 'run')
    .flatMap(p => p.budgets.filter(b => setup.has(b)).map(b => ({ pool: code(p.pool_code), budget: b })))
}

// ---------------------------------------------------------------------------
// تعديل رمز موازنة أو حذفها: مراجعها في المجمعات والإقرارات تتبعها
// ---------------------------------------------------------------------------

/** رمز موازنة تغيّر: `to` فارغ يعني أن المراجع تُحذف. */
export interface BudgetRemap { from: string; to: string }

/**
 * ما يلزم مراجع صف موازنة حين يصير رمزه `to` (أو يُحذف الصف بـ`to` فارغ). `null` إن بقيت المراجع كما هي:
 * الصف بلا رمز، أو الرمز لم يتغير، أو صف آخر ما زال يحمل الرمز القديم فالمراجع له.
 */
export function budgetRemap(budgets: readonly BudgetForm[], index: number, to: string): BudgetRemap | null {
  const from = code(budgets[index]?.budget_code ?? '')
  const next = code(to)
  if (from === '' || from === next) return null
  if (budgets.some((b, i) => i !== index && code(b.budget_code) === from)) return null
  return { from, to: next }
}

const remapCodes = (codes: readonly string[], r: BudgetRemap): string[] =>
  [...new Set(codes.flatMap(c => (c === r.from ? (r.to === '' ? [] : [r.to]) : [c])))]

/** موازنات كل مجمع بعد تغيير رمز: يُنقل المرجع إلى الرمز الجديد أو يُحذف، بلا تكرار. بقية حقول المجمع كما هي. */
export function remapPools<T extends AllocationPool>(pools: readonly T[], r: BudgetRemap): T[] {
  return pools.map(p => (p.budgets.includes(r.from) ? { ...p, budgets: remapCodes(p.budgets, r) } : p))
}

/** الإقرارات `POOL/BUDGET` بعد تغيير رمز الموازنة. */
export function remapAcks(acks: readonly string[], r: BudgetRemap): string[] {
  const moved = acks.flatMap(key => {
    const cut = key.lastIndexOf('/')
    const [pool, budget] = [key.slice(0, cut), key.slice(cut + 1)]
    if (budget !== r.from) return [key]
    return r.to === '' ? [] : [ackKey(pool, r.to)]
  })
  return [...new Set(moved)]
}

/** تعديل صف موازنة: النموذج الجديد مع إقراراته، وما يلزم المجمعات (يطبقه صاحب المجمعات). */
export function editBudget(form: AllocationForm, index: number, patch: Partial<BudgetForm>): { form: AllocationForm; remap: BudgetRemap | null } {
  const remap = patch.budget_code === undefined ? null : budgetRemap(form.budgets, index, patch.budget_code)
  const budgets = form.budgets.map((b, i) => (i === index ? { ...b, ...patch } : b))
  return { form: { ...form, budgets, acks: remap ? remapAcks(form.acks, remap) : form.acks }, remap }
}

/** حذف صف موازنة: لا يبقى رمزها في أي مجمع أو إقرار، إلا إن حمله صف آخر (Codex P2 على #334). */
export function removeBudget(form: AllocationForm, index: number): { form: AllocationForm; remap: BudgetRemap | null } {
  const remap = budgetRemap(form.budgets, index, '')
  const budgets = form.budgets.filter((_, i) => i !== index)
  return { form: { ...form, budgets, acks: remap ? remapAcks(form.acks, remap) : form.acks }, remap }
}

// ---------------------------------------------------------------------------
// تعديل رمز مجمع: قواعد مراكز العمل والإقرارات تتبعه (Codex P2 على #334)
// ---------------------------------------------------------------------------

/** رمز مجمع تغيّر في مسودة الإصدار. */
export interface PoolRemap { from: string; to: string }

/**
 * ما يلزم مراجع المجمع حين يصير رمزه `to`. `null` إن بقيت كما هي: الرمز لم يتغير، أو مجمع آخر يحمل الرمز القديم
 * (فالمراجع له) أو الجديد (فلا تُدمج فيه). الرمز الفارغ طرف مقبول، فمسح الحقل ثم إعادة كتابته لا يُضيع المراجع.
 */
export function poolRemap(pools: readonly AllocationPool[], index: number, to: string): PoolRemap | null {
  const from = code(pools[index]?.pool_code ?? '')
  const next = code(to)
  if (from === next) return null
  if (pools.some((p, i) => i !== index && [from, next].includes(code(p.pool_code)))) return null
  return { from, to: next }
}

function remapRulePools(rule: RuleForm, r: PoolRemap): RuleForm {
  if (!Object.prototype.hasOwnProperty.call(rule.pools, r.from)) return rule
  const { [r.from]: moved, ...rest } = rule.pools
  return { ...rule, pools: { ...rest, [r.to]: moved } }
}

function remapAckPools(acks: readonly string[], r: PoolRemap): string[] {
  return [...new Set(acks.map(key => {
    const cut = key.lastIndexOf('/')
    return key.slice(0, cut) === r.from ? ackKey(r.to, key.slice(cut + 1)) : key
  }))]
}

/** تغيير رمز مجمع: المجمعات بعد التغيير، وقواعد مراكز العمل والإقرارات منقولة إلى الرمز الجديد. */
export function renamePool(form: VersionDraftForm, index: number, poolCode: string): Pick<VersionDraftForm, 'pools' | 'rules' | 'acks'> {
  const r = poolRemap(form.pools, index, poolCode)
  const pools = form.pools.map((p, i) => (i === index ? { ...p, pool_code: poolCode } : p))
  if (!r) return { pools, rules: form.rules, acks: form.acks }
  return { pools, rules: form.rules.map(rule => remapRulePools(rule, r)), acks: remapAckPools(form.acks, r) }
}

export interface InputWarning { code: string; detail: string }

function poolWarnings(pools: readonly AllocationPool[], known: ReadonlySet<string>): InputWarning[] {
  const warnings: InputWarning[] = []
  for (const p of pools) {
    const pc = code(p.pool_code)
    if (p.activity === '') warnings.push({ code: 'COST_POLICY_POOL_ACTIVITY_UNSET', detail: pc })
    if (p.budgets.length === 0) warnings.push({ code: 'COST_POLICY_POOL_WITHOUT_BUDGET', detail: pc })
    for (const b of p.budgets.filter(x => !known.has(x))) warnings.push({ code: 'COST_POLICY_BUDGET_UNKNOWN', detail: `${pc}/${b}` })
  }
  return warnings
}

function doubleAllocationWarnings(pools: readonly AllocationPool[]): InputWarning[] {
  const owners = new Map<string, number>()
  for (const b of pools.flatMap(p => p.budgets)) owners.set(b, (owners.get(b) ?? 0) + 1)
  return [...owners].filter(([, n]) => n > 1).map(([b]) => ({ code: 'COST_POLICY_BUDGET_DOUBLE_ALLOCATION', detail: b }))
}

function budgetWarnings(budgets: readonly BudgetForm[]): InputWarning[] {
  return budgets.flatMap(b => {
    const bc = code(b.budget_code)
    const out: InputWarning[] = []
    if (!BUDGET_CODE_PATTERN.test(bc)) out.push({ code: 'COST_POLICY_INVALID', detail: `budget_code ${bc}` })
    if (b.gl_account_id === '') out.push({ code: 'COST_POLICY_BUDGET_ACCOUNT_REQUIRED', detail: bc })
    return out
  })
}

function ackWarnings(pools: readonly AllocationPool[], form: AllocationForm): InputWarning[] {
  const acked = new Set(form.acks)
  return ackCandidates(pools, form.budgets)
    .map(c => ackKey(c.pool, c.budget))
    .filter(key => !acked.has(key))
    .map(key => ({ code: 'COST_POLICY_SETUP_TREATMENT_UNSET', detail: key }))
}

/** تنبيهات مبكرة بأسماء رموز الخادم؛ لا تمنع الحفظ، والخادم هو الحكم عند الاعتماد. */
export function allocationWarnings(pools: readonly AllocationPool[], form: AllocationForm, policy: UnallocatedBudgetPolicy): InputWarning[] {
  const known = new Set(form.budgets.map(b => code(b.budget_code)))
  const unallocated = unallocatedCodes(pools, form.budgets)
  return [
    ...poolWarnings(pools, known),
    ...doubleAllocationWarnings(pools),
    ...budgetWarnings(form.budgets),
    ...ackWarnings(pools, form),
    ...(unallocated.length > 0 && policy === 'block' ? [{ code: 'COST_POLICY_BUDGET_UNALLOCATED', detail: unallocated.join(', ') }] : []),
  ]
}

// ---------------------------------------------------------------------------
// من النموذج إلى الحمولة
// ---------------------------------------------------------------------------

function budgetsPayload(budgets: readonly BudgetForm[]): DraftBudget205[] {
  return budgets.map(b => {
    const amount = decimalOrUndefined(b.amount)
    const hours = decimalOrUndefined(b.planned_hours)
    return {
      budget_code: code(b.budget_code),
      ...(b.gl_account_id ? { gl_account_id: b.gl_account_id } : {}),
      setup_related: b.setup_related,
      ...(amount === undefined ? {} : { amount }),
      ...(hours === undefined ? {} : { planned_hours: hours }),
    }
  })
}

/** الإقرارات التي ما زالت مرشحة فقط: إقرار لزوج زال لا يُرسل. */
function acksPayload(pools: readonly AllocationPool[], form: AllocationForm): DraftSetupAck205[] {
  const acked = new Set(form.acks)
  return ackCandidates(pools, form.budgets)
    .filter(c => acked.has(ackKey(c.pool, c.budget)))
    .map(c => ({ pool_code: c.pool, budget_code: c.budget }))
}

/** الاستثناء تحت `controlled_exception` فقط، وقائمته كل غير المحمّل آليًا (§7 و§11). */
function exceptionPayload(pools: readonly AllocationPool[], form: AllocationForm, policy: UnallocatedBudgetPolicy): DraftException205 | undefined {
  const unallocated = unallocatedCodes(pools, form.budgets)
  if (policy !== 'controlled_exception' || unallocated.length === 0) return undefined
  return { budgets: unallocated, reason: form.exception.reason.trim(), treatment: form.exception.treatment.trim() }
}

function poolAllocation(p: AllocationPool): { activity?: PoolActivity; budgets: string[] } {
  return { ...(p.activity === '' ? {} : { activity: p.activity }), budgets: p.budgets }
}

type RulePayload = VersionDraftPayload205['work_center_rules'][number]

/** قاعدة مركز عمل كما تُرسل، أو `null` إن لم تحمل سعر عمالة ولا إعداد مجمع (205: COST_POLICY_WC_RULE_EMPTY). */
function rulePayload(form: VersionDraftForm, r: RuleForm): RulePayload | null {
  const poolCodes = new Set(form.pools.map(p => code(p.pool_code)))
  const poolRules = Object.entries(r.pools)
    .filter(([c, rule]) => rule.mode !== 'default' && poolCodes.has(c))
    .map(([c, rule]) => (rule.mode === 'exclude'
      ? { pool_code: c, applies: false }
      : { pool_code: c, applies: true, rate: decimalOrUndefined(rule.rate) }))
  const laborRate = form.labor_cost_source === 'work_center_rate' ? decimalOrUndefined(r.labor_rate) : undefined
  if (laborRate === undefined && poolRules.length === 0) return null
  return {
    work_center_id: r.work_center_id,
    ...(laborRate === undefined ? {} : { labor_rate_per_hour: laborRate }),
    ...(poolRules.length > 0 ? { pools: poolRules } : {}),
  }
}

/**
 * مراكز عمل اختيرت ولا تحمل قاعدتها شيئًا يُرسل، فلا تُرسل ويعمل المركز بالافتراضي (Codex P2 على #334):
 * مثلًا بعد التحويل إلى `recorded_entry_rate` وقاعدةٌ لم تكن تحمل إلا سعر عمالة.
 */
export function emptyRuleCenters(form: VersionDraftForm): string[] {
  return form.rules.filter(r => r.work_center_id && rulePayload(form, r) === null).map(r => r.work_center_id)
}

export function buildVersionPayload(form: VersionDraftForm, policy: UnallocatedBudgetPolicy): VersionDraftPayload205 {
  const usesRates = form.labor_cost_source === 'work_center_rate'
  const pools = form.pools.map(p => ({ ...p, pool_code: code(p.pool_code) }))
  const exception = exceptionPayload(pools, form, policy)
  const note = form.note.trim()
  return {
    effective_from: form.effective_from,
    labor_cost_source: form.labor_cost_source,
    ...(usesRates ? { default_labor_rate_per_hour: decimalOrUndefined(form.default_labor_rate) } : {}),
    pin_event: form.pin_event,
    ...(note ? { note } : {}),
    overhead_pools: pools.map(p => ({
      pool_code: p.pool_code,
      name: p.name.trim(),
      ...(p.name_ar.trim() ? { name_ar: p.name_ar.trim() } : {}),
      basis: p.basis,
      rate: decimalOrUndefined(p.rate) ?? Number.NaN,
      ...poolAllocation(p),
    })),
    work_center_rules: form.rules
      .filter(r => r.work_center_id)
      .map(r => rulePayload(form, r))
      .filter((r): r is RulePayload => r !== null),
    budgets: budgetsPayload(form.budgets),
    setup_acks: acksPayload(pools, form),
    ...(exception ? { unallocated_exception: exception } : {}),
  }
}

export function buildResolutionPayload(form: LegacyResolutionForm, policy: UnallocatedBudgetPolicy): LegacyResolutionPayload205 {
  const exception = exceptionPayload(form.pools, form, policy)
  return {
    pools: form.pools.map(p => ({ pool_code: p.pool_code, ...poolAllocation(p) })),
    budgets: budgetsPayload(form.budgets),
    setup_acks: acksPayload(form.pools, form),
    ...(exception ? { unallocated_exception: exception } : {}),
  }
}

/** يرفض أي رقم غير منتهٍ قبل الإرسال: الحمولة لا تحمل `NaN` (يصير `null` في JSON). */
export function hasInvalidNumber(payload: unknown): boolean {
  if (typeof payload === 'number') return !Number.isFinite(payload)
  if (Array.isArray(payload)) return payload.some(hasInvalidNumber)
  if (payload !== null && typeof payload === 'object') return Object.values(payload).some(hasInvalidNumber)
  return false
}

// ---------------------------------------------------------------------------
// مفتاح التكرار والمعاينة
// ---------------------------------------------------------------------------

export interface KeyedContent { key: string; fingerprint: string }

/** مفتاح واحد لكل محتوى يُرسل (§6): المحتوى نفسه يعيد المفتاح نفسه، وأي تغيير يولّد مفتاحًا جديدًا. */
export function keyForContent(previous: KeyedContent | null, fingerprint: string, generate: () => string): KeyedContent {
  return previous?.fingerprint === fingerprint ? previous : { key: generate(), fingerprint }
}

export interface HoursText { laborRun: string; laborSetup: string; machineRun: string; machineSetup: string }

export const emptyHours = (): HoursText => ({ laborRun: '', laborSetup: '', machineRun: '', machineSetup: '' })

/** الفارغ لا يُرسل (غير مقاس)، والصفر مقاس. نص لا يُقرأ رقمًا يعيد `null` فلا يُرسل شيء. */
export function buildHours(h: HoursText): Hours205 | null {
  const values = [h.laborRun, h.laborSetup, h.machineRun, h.machineSetup].map(decimalOrUndefined)
  if (values.some(v => v !== undefined && Number.isNaN(v))) return null
  const [laborRun, laborSetup, machineRun, machineSetup] = values
  const part = (run: number | undefined, setup: number | undefined) => {
    const out: { run?: number; setup?: number } = {}
    if (run !== undefined) out.run = run
    if (setup !== undefined) out.setup = setup
    return Object.keys(out).length > 0 ? out : undefined
  }
  const labor = part(laborRun, laborSetup)
  const machine = part(machineRun, machineSetup)
  return { ...(labor ? { labor } : {}), ...(machine ? { machine } : {}) }
}
