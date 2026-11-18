/**
 * كتابة Migration 205 ومعايناتها (UI-2). العقود: دوال `rpc_*_205` في
 * sql/migrations/205_manufacturing_cost_policy_approval_and_overhead.sql، والتصميم في
 * docs/features/manufacturing/COST_POLICY_205_UI_DESIGN.md §4 إلى §17.
 *
 * - المؤسسة تُمرر صراحة من الاختيار الحالي في كل استدعاء، ولا تُستنتج من الجلسة.
 * - لا هوية في أي حمولة: الخادم يأخذها من الجلسة (`COST_POLICY_DRAFT_IDENTITY_FIELD`).
 * - كل استدعاء `.rpc('<الاسم>', …)` حرفي ليراه جرد RBAC.
 * - الخادم هو الحكم: لا فحص صلاحية هنا، وكل رفض يُرفع برسالته كما هي.
 * - الوحدات: رد الاعتماد بالهللات، وكل ما عداه بالريال. التحويل في `centsToRiyal` وحدها (§11).
 */
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database.generated'
import type { UnallocatedBudgetPolicy } from '@/services/mfg-cost-policy-205-service'
import type { LaborCostSource, OverheadBasis } from '@/services/mfg-cost-policy-service'

type RpcError = { message: string; code?: string }

/** رموز ترفعها 205 (أو سحب 204 الذي تستخدمه لوحة 205)، وحارس العضوية (120)، ورموز يضيفها العميل. */
const SERVER_CODE = /^((COST_POLICY|MANUFACTURING_SETTINGS)_[A-Z0-9_]+|NOT_AUTHENTICATED|NOT_ORG_MEMBER|ORG_UNRESOLVED)(?=:|$)/

/**
 * يحول خطأ PostgREST إلى رسالة واحدة:
 * - `PGRST202` من دالة 205 بعد أن ظهرت 205 خطأ عقد، لا غياب (§2): النسخة المطبقة والعميل لا يتفقان.
 * - `42501` على مستوى الدالة (سُحب `EXECUTE`) لا يكتب شيئًا.
 * - غير ذلك الرسالة كما هي.
 */
function rpcFail(error: RpcError): never {
  if (error.code === 'PGRST202') throw new Error('COST_POLICY_205_CONTRACT_MISMATCH')
  if (error.code === '42501' && /permission denied for function/i.test(error.message)) {
    throw new Error('COST_POLICY_FUNCTION_NOT_PERMITTED')
  }
  throw new Error(error.message || error.code || 'RPC_ERROR')
}

function requireOrg(orgId: string): void {
  if (!orgId) throw new Error('ORG_UNRESOLVED')
}

type Obj = Record<string, unknown>

function reply(data: unknown, fields: readonly string[]): Obj {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('COST_POLICY_205_RESPONSE_INVALID: reply')
  const row = data as Obj
  const missing = fields.find(f => !(f in row))
  if (missing) throw new Error(`COST_POLICY_205_RESPONSE_INVALID: ${missing}`)
  return row
}

/** رمز الرفض: البادئة قبل «:»، أو `null` إن لم تكن رسالة من الخادم (انقطاع أو خطأ آخر). */
export function serverRefusalCode(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  return SERVER_CODE.exec(message)?.[0] ?? null
}

/**
 * هللات صحيحة إلى ريال بخانتين، بحساب نصي لا عشري، فلا خطأ تقريب ولا ضرب في مكان آخر.
 * قيمة ليست عددًا صحيحًا من الهللات ترفع خطأ عقد، فلا يُعرض مبلغ مئة ضعف.
 */
export function centsToRiyal(cents: unknown): string {
  const text = typeof cents === 'number' && Number.isSafeInteger(cents) ? String(cents)
    : typeof cents === 'string' && /^-?\d+$/.test(cents) ? cents : null
  if (text === null) throw new Error('COST_POLICY_205_RESPONSE_INVALID: cents')
  const negative = text.startsWith('-')
  const digits = (negative ? text.slice(1) : text).padStart(3, '0')
  const whole = digits.slice(0, -2).replace(/^0+(?=\d)/, '')
  return `${negative ? '-' : ''}${whole}.${digits.slice(-2)}`
}

// ---------------------------------------------------------------------------
// الحمولات (مفاتيحها حرفية من فحص الخادم، التصميم §7)
// ---------------------------------------------------------------------------

export interface DraftPool205 {
  pool_code: string
  name: string
  name_ar?: string
  basis: OverheadBasis
  rate: number
  activity?: 'run' | 'setup' | 'both'
  budgets?: string[]
}

export interface DraftBudget205 {
  budget_code: string
  gl_account_id?: string
  setup_related: boolean
  amount?: number
  planned_hours?: number
}

export interface DraftSetupAck205 { pool_code: string; budget_code: string }

export interface DraftException205 { budgets: string[]; reason: string; treatment: string }

/** مسودة إصدار: حقول 204 ثم حقول 205. لا حقل `cost_center_id` ولا حقل هوية. */
export interface VersionDraftPayload205 {
  effective_from: string
  labor_cost_source: LaborCostSource
  default_labor_rate_per_hour?: number
  pin_event: 'mo_created' | 'production_started'
  note?: string
  overhead_pools: DraftPool205[]
  work_center_rules: Array<{
    work_center_id: string
    labor_rate_per_hour?: number
    pools?: Array<{ pool_code: string; applies: boolean; rate?: number }>
  }>
  budgets: DraftBudget205[]
  setup_acks: DraftSetupAck205[]
  unallocated_exception?: DraftException205
}

/** معالجة إصدار قديم: لكل مجمع نشاطه وموازناته، والموازنات والإقرارات والاستثناء. */
export interface LegacyResolutionPayload205 {
  pools: Array<{ pool_code: string; activity?: 'run' | 'setup' | 'both'; budgets?: string[] }>
  budgets: DraftBudget205[]
  setup_acks: DraftSetupAck205[]
  unallocated_exception?: DraftException205
}

/** ساعات المعاينة: الفارغ لا يُرسل (غير مقاس)، والصفر مقاس (§10). */
export interface Hours205 {
  labor?: { run?: number; setup?: number }
  machine?: { run?: number; setup?: number }
}

// ---------------------------------------------------------------------------
// المسودات
// ---------------------------------------------------------------------------

export interface DraftWriteResult { draftId: string; revision: number; replayed: boolean }

function draftResult(data: unknown): DraftWriteResult {
  const row = reply(data, ['draft_id', 'revision', 'replayed'])
  return { draftId: String(row.draft_id), revision: Number(row.revision), replayed: row.replayed === true }
}

/** ينشئ مسودة إصدار. المفتاح واحد لكل محتوى يُرسل؛ إعادة الإرسال بالمحتوى نفسه تعيد المسودة نفسها. */
export async function createVersionDraft205(
  orgId: string, draft: VersionDraftPayload205, expectedLatestVersionNo: number, idempotencyKey: string,
): Promise<DraftWriteResult> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_create_mfg_cost_policy_draft_205', {
    p_org_id: orgId,
    p_draft: draft as unknown as Json,
    p_expected_latest_version_no: expectedLatestVersionNo,
    p_idempotency_key: idempotencyKey,
  })
  if (error) rpcFail(error)
  return draftResult(data)
}

/** يعدّل مسودة إصدار للمنشئ. حفظ المحتوى نفسه يرد `unchanged` ولا يرفع المراجعة. */
export async function updateVersionDraft205(
  orgId: string, draftId: string, draft: VersionDraftPayload205, expectedLatestVersionNo: number,
): Promise<{ revision: number; unchanged: boolean }> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_update_mfg_cost_policy_draft_205', {
    p_org_id: orgId,
    p_draft_id: draftId,
    p_draft: draft as unknown as Json,
    p_expected_latest_version_no: expectedLatestVersionNo,
  })
  if (error) rpcFail(error)
  const row = reply(data, ['revision', 'unchanged'])
  return { revision: Number(row.revision), unchanged: row.unchanged === true }
}

/** ينشئ مسودة معالجة لإصدار قديم. السبب إلزامي (1 إلى 500). */
export async function createLegacyResolutionDraft205(
  orgId: string, policyVersionId: string, resolution: LegacyResolutionPayload205, reason: string, idempotencyKey: string,
): Promise<DraftWriteResult> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_create_legacy_resolution_draft_205', {
    p_org_id: orgId,
    p_policy_version_id: policyVersionId,
    p_resolution: resolution as unknown as Json,
    p_reason: reason,
    p_idempotency_key: idempotencyKey,
  })
  if (error) rpcFail(error)
  return draftResult(data)
}

/** سحب المسودة للمنشئ وحده. */
export async function withdrawDraft205(orgId: string, draftId: string, reason: string): Promise<void> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_withdraw_mfg_cost_policy_draft_205', {
    p_org_id: orgId, p_draft_id: draftId, p_reason: reason,
  })
  if (error) rpcFail(error)
  reply(data, ['status'])
}

/** رفض المسودة لحامل `approve`. لا يأخذ رقم المراجعة (F-UI-7). */
export async function rejectDraft205(orgId: string, draftId: string, reason: string): Promise<void> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_reject_mfg_cost_policy_draft_205', {
    p_org_id: orgId, p_draft_id: draftId, p_reason: reason,
  })
  if (error) rpcFail(error)
  reply(data, ['status'])
}

export interface ApprovalResult205 {
  policyVersionId: string
  selfApproved: boolean
  /** الموازنات غير المحمّلة بالريال، محوّلة من هللات الرد. */
  unallocated: Array<{ budgetCode: string; amount: string }>
  exception: boolean
}

/**
 * يعتمد المراجعة المعروضة بالضبط (`expectedRevision` من اللقطة على الشاشة، §6). الاعتماد بلا مفتاح
 * تكرار: بعد رد مفقود تُقرأ الحالة قبل أي إعادة إرسال، وهذا في الواجهة.
 */
export async function approveDraft205(orgId: string, draftId: string, expectedRevision: number): Promise<ApprovalResult205> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_approve_mfg_cost_policy_draft_205', {
    p_org_id: orgId, p_draft_id: draftId, p_expected_revision: expectedRevision,
  })
  if (error) rpcFail(error)
  const row = reply(data, ['policy_version_id', 'self_approved', 'unallocated', 'exception'])
  const cents = row.unallocated
  if (cents === null || typeof cents !== 'object' || Array.isArray(cents)) throw new Error('COST_POLICY_205_RESPONSE_INVALID: unallocated')
  return {
    policyVersionId: String(row.policy_version_id),
    selfApproved: row.self_approved === true,
    unallocated: Object.entries(cents as Obj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([budgetCode, value]) => ({ budgetCode, amount: centsToRiyal(value) })),
    exception: row.exception === true,
  }
}

// ---------------------------------------------------------------------------
// إعدادات الاعتماد (§8)
// ---------------------------------------------------------------------------

export interface ApprovalSettings205 { selfApprovalEnabled: boolean; unallocatedBudgetPolicy: UnallocatedBudgetPolicy }

function settingsResult(data: unknown): ApprovalSettings205 {
  const row = reply(data, ['self_approval_enabled', 'unallocated_budget_policy'])
  const policy = row.unallocated_budget_policy
  if (typeof row.self_approval_enabled !== 'boolean' || (policy !== 'block' && policy !== 'controlled_exception')) {
    throw new Error('COST_POLICY_205_RESPONSE_INVALID: settings')
  }
  return { selfApprovalEnabled: row.self_approval_enabled, unallocatedBudgetPolicy: policy }
}

export async function setSelfApproval205(orgId: string, enabled: boolean, reason: string): Promise<ApprovalSettings205> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_set_cost_policy_self_approval_205', {
    p_org_id: orgId, p_enabled: enabled, p_reason: reason,
  })
  if (error) rpcFail(error)
  return settingsResult(data)
}

export async function setUnallocatedPolicy205(
  orgId: string, policy: UnallocatedBudgetPolicy, reason: string,
): Promise<ApprovalSettings205> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_set_cost_policy_unallocated_policy_205', {
    p_org_id: orgId, p_policy: policy, p_reason: reason,
  })
  if (error) rpcFail(error)
  return settingsResult(data)
}

// ---------------------------------------------------------------------------
// المعاينة وفحص المسودة (§10 و§17)، بالريال
// ---------------------------------------------------------------------------

export interface Preview205 {
  labor: { source: LaborCostSource; amount: number | string }
  overhead: Array<{ pool_code: string; basis: OverheadBasis; activity: string | null; amount: number | string }>
  excluded_pools: string[]
  overhead_total: number | string
  total: number | string
}

/** معاينة إصدار مخزن، ومعها الموازنات غير المحمّلة بالريال خارج الإجمالي. الهللات في الرد لا تُعرض. */
export interface StoredPreview205 extends Preview205 {
  unallocated_budgets: Array<{ budget_code: string; amount: number | string }>
}

function previewShape(value: unknown, path: string): Preview205 {
  const row = reply(value, ['labor', 'overhead', 'excluded_pools', 'overhead_total', 'total'])
  if (!Array.isArray(row.overhead) || !Array.isArray(row.excluded_pools)) {
    throw new Error(`COST_POLICY_205_RESPONSE_INVALID: ${path}`)
  }
  return row as unknown as Preview205
}

export interface PreviewInput205 {
  versionId: string
  workCenterId: string
  hours: Hours205
  recordedLaborCost: number | null
}

export async function previewAbsorption205(orgId: string, input: PreviewInput205): Promise<StoredPreview205> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_preview_mfg_cost_absorption_205', {
    p_org_id: orgId,
    p_policy_version_id: input.versionId,
    p_work_center_id: input.workCenterId,
    p_hours: input.hours as unknown as Json,
    ...(input.recordedLaborCost === null ? {} : { p_recorded_labor_cost: input.recordedLaborCost }),
  })
  if (error) rpcFail(error)
  const preview = previewShape(data, 'preview')
  const budgets = (data as Obj).unallocated_budgets
  if (!Array.isArray(budgets)) throw new Error('COST_POLICY_205_RESPONSE_INVALID: unallocated_budgets')
  return { ...preview, unallocated_budgets: budgets as StoredPreview205['unallocated_budgets'] }
}

export interface Refusal205 { code: string; detail: string | null }

export interface DraftCheck205 {
  draftId: string
  revision: number
  latestVersionNo: number
  policyAtCheck: ApprovalSettings205
  valid: boolean
  refusal: Refusal205 | null
  unallocated: Array<{ budget_code: string; amount: number | string }>
  preview: Preview205 | null
  previewRefusal: Refusal205 | null
  checkedAt: string
}

export interface CheckInput205 {
  draftId: string
  revision: number
  workCenterId: string | null
  hours: Hours205 | null
  recordedLaborCost: number | null
}

function refusal(value: unknown, path: string): Refusal205 | null {
  if (value === null || value === undefined) return null
  const row = reply(value, ['code'])
  if (typeof row.code !== 'string') throw new Error(`COST_POLICY_205_RESPONSE_INVALID: ${path}`)
  return { code: row.code, detail: typeof row.detail === 'string' ? row.detail : null }
}

/**
 * يفحص المسودة بالمراجعة المعروضة، ويعاين إن أُرسل مركز العمل. قراءة خالصة لا تحجز الاعتماد
 * (§17.1). النتيجة مربوطة بالمراجعة: رد لمراجعة أخرى خطأ عقد ولا يُعرض.
 */
export async function checkDraft205(orgId: string, input: CheckInput205): Promise<DraftCheck205> {
  requireOrg(orgId)
  const { data, error } = await supabase.rpc('rpc_check_mfg_cost_policy_draft_205', {
    p_org_id: orgId,
    p_draft_id: input.draftId,
    p_expected_revision: input.revision,
    ...(input.workCenterId === null ? {} : { p_work_center_id: input.workCenterId }),
    ...(input.hours === null ? {} : { p_hours: input.hours as unknown as Json }),
    ...(input.recordedLaborCost === null ? {} : { p_recorded_labor_cost: input.recordedLaborCost }),
  })
  if (error) rpcFail(error)
  const row = reply(data, ['draft_id', 'revision', 'latest_version_no', 'policy_at_check', 'valid', 'unallocated', 'checked_at'])
  if (row.draft_id !== input.draftId || row.revision !== input.revision) throw new Error('COST_POLICY_205_RESPONSE_INVALID: revision')
  if (!Array.isArray(row.unallocated)) throw new Error('COST_POLICY_205_RESPONSE_INVALID: unallocated')
  return {
    draftId: input.draftId,
    revision: input.revision,
    latestVersionNo: Number(row.latest_version_no),
    policyAtCheck: settingsResult(row.policy_at_check),
    valid: row.valid === true,
    refusal: refusal(row.refusal, 'refusal'),
    unallocated: row.unallocated as DraftCheck205['unallocated'],
    preview: row.preview === null || row.preview === undefined ? null : previewShape(row.preview, 'preview'),
    previewRefusal: refusal(row.preview_refusal, 'preview_refusal'),
    checkedAt: String(row.checked_at),
  }
}

// ---------------------------------------------------------------------------
// الحسابات للموازنات
// ---------------------------------------------------------------------------

export interface GlAccountOption205 { id: string; code: string; name: string; nameAr: string | null }

/** الحسابات النشطة للمؤسسة المختارة؛ الخادم يرفض حسابًا من مؤسسة أخرى (`COST_POLICY_GL_ACCOUNT_FOREIGN`). */
export async function listBudgetGlAccounts205(orgId: string): Promise<GlAccountOption205[]> {
  requireOrg(orgId)
  const { data, error } = await supabase
    .from('gl_accounts')
    .select('id, code, name, name_ar')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => ({ id: row.id, code: row.code, name: row.name, nameAr: row.name_ar }))
}

// ---------------------------------------------------------------------------
// خريطة الأخطاء (§14 و§16)
// ---------------------------------------------------------------------------

export type ErrorGroup205 = 'permission' | 'concurrency' | 'settings' | 'contract' | 'input'

const PERMISSION = new Set([
  'MANUFACTURING_SETTINGS_READ_DENIED', 'MANUFACTURING_SETTINGS_UPDATE_DENIED', 'COST_POLICY_APPROVE_DENIED',
  'COST_POLICY_APPROVAL_SETTINGS_DENIED', 'COST_POLICY_UNALLOCATED_POLICY_DENIED', 'COST_POLICY_DRAFT_EDIT_DENIED',
  'COST_POLICY_SELF_APPROVAL_NOT_ALLOWED', 'COST_POLICY_FUNCTION_NOT_PERMITTED', 'NOT_AUTHENTICATED', 'NOT_ORG_MEMBER', 'ORG_UNRESOLVED',
])
const CONCURRENCY = new Set([
  'COST_POLICY_DRAFT_REVISION_CONFLICT', 'COST_POLICY_DRAFT_NOT_PENDING', 'COST_POLICY_VERSION_CONFLICT',
  'COST_POLICY_DRAFT_UNKNOWN', 'COST_POLICY_VERSION_UNKNOWN', 'COST_POLICY_IDEMPOTENCY_CONFLICT',
  'COST_POLICY_IDEMPOTENCY_KEY_REQUIRED', 'COST_POLICY_VERSION_ALREADY_WITHDRAWN', 'COST_POLICY_LEGACY_NOT_APPLICABLE',
])
const SETTINGS = new Set(['COST_POLICY_SETTING_UNCHANGED', 'COST_POLICY_UNALLOCATED_POLICY_INVALID'])
const CONTRACT = new Set([
  'COST_POLICY_DRAFT_IMMUTABLE', 'COST_POLICY_DRAFT_REVISION_INVALID', 'COST_POLICY_IMMUTABLE',
  'COST_POLICY_DRAFT_IDENTITY_FIELD', 'COST_POLICY_UNKNOWN_KEY', 'COST_POLICY_COST_CENTER_FOREIGN',
  'COST_POLICY_205_CONTRACT_MISMATCH', 'COST_POLICY_205_RESPONSE_INVALID', 'COST_POLICY_NOT_DEPLOYED',
])

/**
 * ما يفعله الشاشة بعد الرفض: `permission` و`concurrency` و`settings` تعيد قراءة الحالة والقدرات،
 * و`contract` خطأ عقد لا يفترض وصوله من النموذج، و`input` إبراز الحقل. رسالة ليست من الخادم
 * (انقطاع) تعامل `concurrency`: لا يُعرف ما كُتب، فتُقرأ الحالة.
 */
export function errorGroup205(error: unknown): ErrorGroup205 {
  const code = serverRefusalCode(error)
  if (code === null) return 'concurrency'
  if (PERMISSION.has(code)) return 'permission'
  if (CONCURRENCY.has(code)) return 'concurrency'
  if (SETTINGS.has(code)) return 'settings'
  if (CONTRACT.has(code)) return 'contract'
  return 'input'
}

/** مفتاح الترجمة لرمز الرفض، أو `null` لرسالة ليست من الخادم. */
export function errorKey205(error: unknown): string | null {
  const code = serverRefusalCode(error)
  return code ? `manufacturingSettings.costPolicy205.errors.${code}` : null
}

/** التفصيل بعد «:» (المسار أو السطر أو الرقم الحالي). */
export function errorDetail205(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error)
  const at = message.indexOf(':')
  return at > 0 ? message.slice(at + 1).trim() || null : null
}
