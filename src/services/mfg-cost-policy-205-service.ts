/**
 * اكتشاف Migration 205 وقراءتها (UI-1). العقد: `rpc_get_mfg_cost_policy_205` في
 * sql/migrations/205_manufacturing_cost_policy_approval_and_overhead.sql، والتصميم في
 * docs/features/manufacturing/COST_POLICY_205_UI_DESIGN.md §2 و§3 و§11.
 *
 * قراءة فقط: لا يستدعي هذا الملف أي دالة كتابة من 205. الكتابة (المسودات والقرارات
 * والإعدادات) في UI-2.
 *
 * الاكتشاف هو الاستدعاء نفسه، لا حالة ثابتة في البناء، وينتج أربع حالات:
 * - `absent`: الخطأ `code === 'PGRST202'` على هذا الاستدعاء وحده. نص الرسالة لا يكفي.
 * - `present`: نجاح الاستدعاء وتحقق شكل الرد كاملًا.
 * - `denied`: `MANUFACTURING_SETTINGS_READ_DENIED`، وهو رمز لا ترفعه إلا 205 المطبقة.
 * - `unknown`: كل ما عدا ذلك، ومنه رد بشكل غير متوقع، أو رد لمؤسسة غير المطلوبة. لا كتابة ولا لوحة 204 فيه.
 *
 * المؤسسة تُمرر صراحة من الاختيار الحالي، ولا تُستنتج من الجلسة هنا.
 */
import { supabase } from '@/lib/supabase'
import type {
  CostPolicyStatus,
  CostPolicyVersion,
  LaborCostSource,
  OverheadBasis,
  PinEvent,
} from '@/services/mfg-cost-policy-service'

export type PoolActivity = 'run' | 'setup' | 'both'
export type Policy205Status = 'approved_205' | 'legacy_resolved' | 'legacy_unresolved'
export type UnallocatedBudgetPolicy = 'block' | 'controlled_exception'
export type DraftKind = 'version' | 'legacy_resolution'
export type DraftStatus = 'draft' | 'approved' | 'rejected' | 'withdrawn'

/** بيانات 205 لإصدار، كما تبنيها `mfg_cost_policy_version_v_205`. المبالغ بالريال. */
export interface Version205Data {
  pools: Array<{ code: string; basis: OverheadBasis; rate: number; activity?: PoolActivity; budgets?: string[] }>
  budgets?: Array<{ code: string; gl_account: string | null; cost_center: string | null; setup: boolean; amount: number | string | null }>
  setup_acks?: Array<{ pool: string; budgets: string[] }>
}

export interface Version205Approval {
  approved_by: string
  approved_at: string
  created_by: string
  draft_revision: number
  self_approved: boolean
  kind: DraftKind
}

export interface Version205LegacyResolution {
  reason: string
  created_by: string
  approved_by: string
  resolved_at: string
}

/** الاستثناء المعتمد: `budgets` خريطة {رمز: ريال} كما خُزنت عند الاعتماد. */
export interface Version205Exception {
  budgets: Record<string, number | string>
  reason: string
  treatment: string
  approved_by: string
  approved_at: string
}

export interface CostPolicyVersion205 extends CostPolicyVersion {
  policy_205: Policy205Status
  data_205: Version205Data | null
  approval: Version205Approval | null
  legacy_resolution: Version205LegacyResolution | null
  unallocated_exception: Version205Exception | null
}

/** الموازنة غير المحمّلة في مسودة: المبلغ **كما أُدخل**، وقد يكون فارغًا أو نصًا. */
export interface DraftUnallocatedBudget {
  budget_code: string
  amount: unknown
}

export interface CostPolicyDraft205 {
  id: string
  kind: DraftKind
  status: DraftStatus
  revision: number
  legacy_version_id: string | null
  payload: Record<string, unknown>
  expected_latest_version_no: number | null
  reason: string | null
  created_by: string
  created_at: string
  decided_by: string | null
  decided_at: string | null
  decision_reason: string | null
  result_version_id: string | null
  unallocated_budgets: DraftUnallocatedBudget[]
}

export interface ApprovalSettingsAuditRow {
  id: number
  setting: 'self_approval_enabled' | 'unallocated_budget_policy'
  old_value: string
  new_value: string
  changed_by: string
  changed_at: string
  reason: string
}

/** للعرض فقط؛ الخادم هو الحكم في كل كتابة (التصميم §1). */
export interface CostPolicy205Capabilities {
  can_create: boolean
  can_approve: boolean
  can_self_approve: boolean
  can_manage_approval_settings: boolean
  can_manage_unallocated_policy: boolean
}

export interface CostPolicy205State {
  orgId: string
  today: string
  currentVersionId: string | null
  latestVersionNo: number
  versions: CostPolicyVersion205[]
  drafts: CostPolicyDraft205[]
  settings: { selfApprovalEnabled: boolean; unallocatedBudgetPolicy: UnallocatedBudgetPolicy }
  settingsAudit: ApprovalSettingsAuditRow[]
  costCentersAccepted: false
  capabilities: CostPolicy205Capabilities
  /** معرف جلسة Supabase، للمقارنة بالمنشئ عند العرض فقط؛ لا يُرسل إلى الخادم. */
  sessionUserId: string | null
}

export type CostPolicy205Discovery =
  | { status: 'absent' }
  | { status: 'present'; state: CostPolicy205State }
  | { status: 'denied' }
  | { status: 'unknown'; reason: string }

const VERSION_STATUSES: readonly CostPolicyStatus[] = ['scheduled', 'current', 'superseded', 'withdrawn']
const LABOR_SOURCES: readonly LaborCostSource[] = ['work_center_rate', 'recorded_entry_rate']
const PIN_EVENTS: readonly PinEvent[] = ['mo_created', 'production_started']
const OVERHEAD_BASES: readonly OverheadBasis[] = ['labor_hours', 'machine_hours']
const POOL_ACTIVITIES: readonly PoolActivity[] = ['run', 'setup', 'both']
const POLICY_205: readonly Policy205Status[] = ['approved_205', 'legacy_resolved', 'legacy_unresolved']
const UNALLOCATED_POLICIES: readonly UnallocatedBudgetPolicy[] = ['block', 'controlled_exception']
const DRAFT_KINDS: readonly DraftKind[] = ['version', 'legacy_resolution']
const DRAFT_STATUSES: readonly DraftStatus[] = ['draft', 'approved', 'rejected', 'withdrawn']
const AUDIT_SETTINGS = ['self_approval_enabled', 'unallocated_budget_policy'] as const
const CAPABILITIES: ReadonlyArray<keyof CostPolicy205Capabilities> = [
  'can_create', 'can_approve', 'can_self_approve', 'can_manage_approval_settings', 'can_manage_unallocated_policy',
]

/** رد بشكل لا يطابق العقد: يعامل `unknown`، فلا تُبنى عليه لوحة ولا كتابة. */
export class CostPolicy205ResponseError extends Error {
  constructor(path: string) {
    super(`COST_POLICY_205_RESPONSE_INVALID: ${path}`)
    this.name = 'CostPolicy205ResponseError'
  }
}

type Json = Record<string, unknown>

function fail(path: string): never {
  throw new CostPolicy205ResponseError(path)
}

function obj(value: unknown, path: string): Json {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(path)
  return value as Json
}

function arr(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path)
  return value
}

function str(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path)
  return value
}

function strOrNull(value: unknown, path: string): string | null {
  return value === null || value === undefined ? null : str(value, path)
}

function num(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path)
  return value
}

function numOrNull(value: unknown, path: string): number | null {
  return value === null || value === undefined ? null : num(value, path)
}

function int(value: unknown, path: string, min = 0): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) fail(path)
  return value
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path)
  return value
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) fail(path)
  return value as T
}

function objOrNull(value: unknown, path: string): Json | null {
  return value === null || value === undefined ? null : obj(value, path)
}

/** حقول `data_205` التي تقرؤها اللوحة: أنشطة المجمعات، ورموز الموازنات. */
function checkData205(data: Json, p: string): void {
  arr(data.pools, `${p}.pools`).forEach((raw, j) => {
    const pool = obj(raw, `${p}.pools[${j}]`)
    str(pool.code, `${p}.pools[${j}].code`)
    if (pool.activity !== undefined && pool.activity !== null) oneOf(pool.activity, POOL_ACTIVITIES, `${p}.pools[${j}].activity`)
  })
  if (data.budgets === undefined || data.budgets === null) return
  arr(data.budgets, `${p}.budgets`).forEach((raw, j) => {
    str(obj(raw, `${p}.budgets[${j}]`).code, `${p}.budgets[${j}].code`)
  })
}

/**
 * يتحقق من كل حقل متداخل تعرضه اللوحة، لا من الحقول العليا وحدها، فرد يمر من هنا لا يُسقط
 * العرض. ما لا تعرضه UI-1 (عناصر `work_center_rules`، ونوع الاعتماد) لا يُفحص.
 */
function parseVersion(raw: unknown, i: number): CostPolicyVersion205 {
  const p = `versions[${i}]`
  const v = obj(raw, p)
  str(v.id, `${p}.id`)
  int(v.version_no, `${p}.version_no`, 1)
  str(v.effective_from, `${p}.effective_from`)
  oneOf(v.status, VERSION_STATUSES, `${p}.status`)
  oneOf(v.labor_cost_source, LABOR_SOURCES, `${p}.labor_cost_source`)
  numOrNull(v.default_labor_rate_per_hour, `${p}.default_labor_rate_per_hour`)
  oneOf(v.pin_event, PIN_EVENTS, `${p}.pin_event`)
  int(v.pinned_order_count, `${p}.pinned_order_count`)
  int(v.awaiting_start_order_count, `${p}.awaiting_start_order_count`)
  strOrNull(v.withdraw_reason, `${p}.withdraw_reason`)
  arr(v.overhead_pools, `${p}.overhead_pools`).forEach((rawPool, j) => {
    const q = `${p}.overhead_pools[${j}]`
    const pool = obj(rawPool, q)
    str(pool.pool_code, `${q}.pool_code`)
    oneOf(pool.basis, OVERHEAD_BASES, `${q}.basis`)
    num(pool.rate, `${q}.rate`)
  })
  arr(v.work_center_rules, `${p}.work_center_rules`)
  oneOf(v.policy_205, POLICY_205, `${p}.policy_205`)
  const data = objOrNull(v.data_205, `${p}.data_205`)
  if (data) checkData205(data, `${p}.data_205`)
  const approval = objOrNull(v.approval, `${p}.approval`)
  if (approval) {
    str(approval.approved_by, `${p}.approval.approved_by`)
    str(approval.approved_at, `${p}.approval.approved_at`)
    int(approval.draft_revision, `${p}.approval.draft_revision`, 1)
    bool(approval.self_approved, `${p}.approval.self_approved`)
  }
  const legacy = objOrNull(v.legacy_resolution, `${p}.legacy_resolution`)
  if (legacy) {
    str(legacy.approved_by, `${p}.legacy_resolution.approved_by`)
    str(legacy.resolved_at, `${p}.legacy_resolution.resolved_at`)
  }
  const exc = objOrNull(v.unallocated_exception, `${p}.unallocated_exception`)
  if (exc) {
    obj(exc.budgets, `${p}.unallocated_exception.budgets`)
    str(exc.reason, `${p}.unallocated_exception.reason`)
    str(exc.treatment, `${p}.unallocated_exception.treatment`)
  }
  return v as unknown as CostPolicyVersion205
}

function parseDraft(raw: unknown, i: number): CostPolicyDraft205 {
  const p = `drafts[${i}]`
  const d = obj(raw, p)
  return {
    id: str(d.id, `${p}.id`),
    kind: oneOf(d.kind, DRAFT_KINDS, `${p}.kind`),
    status: oneOf(d.status, DRAFT_STATUSES, `${p}.status`),
    revision: int(d.revision, `${p}.revision`, 1),
    legacy_version_id: strOrNull(d.legacy_version_id, `${p}.legacy_version_id`),
    payload: obj(d.payload, `${p}.payload`),
    expected_latest_version_no: d.expected_latest_version_no === null ? null : int(d.expected_latest_version_no, `${p}.expected_latest_version_no`),
    reason: strOrNull(d.reason, `${p}.reason`),
    created_by: str(d.created_by, `${p}.created_by`),
    created_at: str(d.created_at, `${p}.created_at`),
    decided_by: strOrNull(d.decided_by, `${p}.decided_by`),
    decided_at: strOrNull(d.decided_at, `${p}.decided_at`),
    decision_reason: strOrNull(d.decision_reason, `${p}.decision_reason`),
    result_version_id: strOrNull(d.result_version_id, `${p}.result_version_id`),
    unallocated_budgets: arr(d.unallocated_budgets, `${p}.unallocated_budgets`).map((b, j) => {
      const row = obj(b, `${p}.unallocated_budgets[${j}]`)
      return { budget_code: str(row.budget_code, `${p}.unallocated_budgets[${j}].budget_code`), amount: row.amount ?? null }
    }),
  }
}

function parseAudit(raw: unknown, i: number): ApprovalSettingsAuditRow {
  const p = `settings_audit[${i}]`
  const a = obj(raw, p)
  return {
    id: int(a.id, `${p}.id`, 1),
    setting: oneOf(a.setting, AUDIT_SETTINGS, `${p}.setting`),
    old_value: str(a.old_value, `${p}.old_value`),
    new_value: str(a.new_value, `${p}.new_value`),
    changed_by: str(a.changed_by, `${p}.changed_by`),
    changed_at: str(a.changed_at, `${p}.changed_at`),
    reason: str(a.reason, `${p}.reason`),
  }
}

/** يتحقق من شكل رد `rpc_get_mfg_cost_policy_205` كاملًا، ويرفع `CostPolicy205ResponseError` عند أول انحراف. */
export function parseCostPolicy205State(data: unknown, sessionUserId: string | null): CostPolicy205State {
  const row = obj(data, 'response')
  const settings = obj(row.settings, 'settings')
  const supported = obj(row.supported, 'supported')
  if (supported.cost_centers_accepted !== false) fail('supported.cost_centers_accepted')
  const capabilities = obj(row.capabilities, 'capabilities')
  const caps = Object.fromEntries(CAPABILITIES.map(k => [k, bool(capabilities[k], `capabilities.${k}`)])) as unknown as CostPolicy205Capabilities
  return {
    orgId: str(row.org_id, 'org_id'),
    today: str(row.today, 'today'),
    currentVersionId: strOrNull(row.current_version_id, 'current_version_id'),
    latestVersionNo: int(row.latest_version_no, 'latest_version_no'),
    versions: arr(row.versions, 'versions').map(parseVersion),
    drafts: arr(row.drafts, 'drafts').map(parseDraft),
    settings: {
      selfApprovalEnabled: bool(settings.self_approval_enabled, 'settings.self_approval_enabled'),
      unallocatedBudgetPolicy: oneOf(settings.unallocated_budget_policy, UNALLOCATED_POLICIES, 'settings.unallocated_budget_policy'),
    },
    settingsAudit: arr(row.settings_audit, 'settings_audit').map(parseAudit),
    costCentersAccepted: false,
    capabilities: caps,
    sessionUserId,
  }
}

async function sessionUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

/**
 * يكتشف حالة 205 لمؤسسة `orgId` بقراءة واحدة. لا يرفع أبدًا: كل فشل يصبح حالة. ورد يحمل
 * `org_id` غير المطلوب لا يُعرض، أيًا كان سبب وصوله.
 */
export async function discoverCostPolicy205(orgId: string | null): Promise<CostPolicy205Discovery> {
  try {
    if (!orgId) return { status: 'unknown', reason: 'ORG_UNRESOLVED' }
    const { data, error } = await supabase.rpc('rpc_get_mfg_cost_policy_205', { p_org_id: orgId })
    if (error) {
      // Only the PostgREST code says the function is not in the schema cache; the text alone
      // ("Could not find the function") also covers other faults and is not enough.
      if (error.code === 'PGRST202') return { status: 'absent' }
      if (error.message === 'MANUFACTURING_SETTINGS_READ_DENIED') return { status: 'denied' }
      return { status: 'unknown', reason: error.message || error.code || 'RPC_ERROR' }
    }
    const state = parseCostPolicy205State(data, await sessionUserId())
    if (state.orgId !== orgId) return { status: 'unknown', reason: 'COST_POLICY_205_ORG_MISMATCH' }
    return { status: 'present', state }
  } catch (error) {
    return { status: 'unknown', reason: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * مبلغ من رد الخادم كما هو، بخانتين على الأقل. لا ضرب ولا قسمة ولا تقريب: الوحدة
 * يحددها الحقل (التصميم §11)، وكل الحقول المعروضة في UI-1 بالريال. قيمة لا تُقرأ
 * رقمًا (مبلغ مسودة «كما أُدخل») تُعرض نصها.
 */
export function formatServerAmount(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : JSON.stringify(value)
  const match = /^(-?\d+)(?:\.(\d+))?$/.exec(text)
  if (!match) return text
  const fraction = match[2] ?? ''
  return fraction.length >= 2 ? text : `${match[1]}.${fraction.padEnd(2, '0')}`
}

/** إصدار قديم غير معالج وغير مسحوب، أيًا كانت حالته (التصميم §9). المرتبط بأوامر أولًا، ثم الساري. */
export function unresolvedLegacyVersions(state: CostPolicy205State): CostPolicyVersion205[] {
  const linked = (v: CostPolicyVersion205) => v.pinned_order_count > 0 || v.awaiting_start_order_count > 0
  return state.versions
    .filter(v => v.policy_205 === 'legacy_unresolved' && v.status !== 'withdrawn')
    .sort((a, b) => Number(linked(b)) - Number(linked(a))
      || Number(b.id === state.currentVersionId) - Number(a.id === state.currentVersionId)
      || b.version_no - a.version_no)
}

/** مسودة إصدار صارت قديمة: صدر إصدار بعد حفظها، فالاعتماد سيرفضها (التصميم §6). */
export function isStaleDraft(draft: CostPolicyDraft205, latestVersionNo: number): boolean {
  return draft.kind === 'version' && draft.status === 'draft' && draft.expected_latest_version_no !== latestVersionNo
}
