/**
 * سياسات تكلفة التصنيع (Migration 204) — عقد القراءة والكتابة فقط.
 * العقد: docs/db/MANUFACTURING_COST_POLICIES_204_RUNBOOK.md (PR قاعدة البيانات).
 *
 * لا يُدمج هذا الملف قبل تطبيق 204 على Production والتحقق منها (DB-first). وحتى
 * ذلك الحين تعيد الشاشة «غير متاح» بدل نموذج لا يحفظ: غياب الدالة يُكتشف من
 * رسالة PostgREST ويُرفع `COST_POLICY_NOT_DEPLOYED`.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase'

export type LaborCostSource = 'work_center_rate' | 'recorded_entry_rate'
export type OverheadBasis = 'labor_hours' | 'machine_hours'
export type CostPolicyStatus = 'scheduled' | 'current' | 'superseded' | 'withdrawn'

export interface OverheadPool {
  pool_code: string
  name: string
  name_ar: string | null
  basis: OverheadBasis
  rate: number
}

export interface WorkCenterPoolRule {
  pool_code: string
  applies: boolean
  rate: number | null
}

export interface WorkCenterRule {
  work_center_id: string
  work_center_code?: string
  work_center_name?: string
  work_center_name_ar?: string | null
  labor_rate_per_hour: number | null
  pools: WorkCenterPoolRule[]
}

export interface CostPolicyVersion {
  id: string
  version_no: number
  effective_from: string
  status: CostPolicyStatus
  labor_cost_source: LaborCostSource
  default_labor_rate_per_hour: number | null
  stage_costing_method: 'weighted_average'
  note: string | null
  pinned_order_count: number
  withdraw_reason: string | null
  overhead_pools: OverheadPool[]
  work_center_rules: WorkCenterRule[]
}

export interface CostPolicyState {
  today: string
  currentVersionId: string | null
  latestVersionNo: number
  versions: CostPolicyVersion[]
  supported: {
    labor_cost_sources: LaborCostSource[]
    overhead_bases: OverheadBasis[]
    stage_costing_methods: string[]
  }
  canManage: boolean
}

/** ما يرسله النموذج؛ يطابق مفاتيح `p_policy` المقبولة في 204 حرفيًا. */
export interface CostPolicyDraft {
  effective_from: string
  labor_cost_source: LaborCostSource
  default_labor_rate_per_hour?: number
  note?: string
  overhead_pools: Array<{ pool_code: string; name: string; name_ar?: string; basis: OverheadBasis; rate: number }>
  work_center_rules: Array<{
    work_center_id: string
    labor_rate_per_hour?: number
    pools?: Array<{ pool_code: string; applies: boolean; rate?: number }>
  }>
}

export interface AbsorptionPreview {
  labor: { source: LaborCostSource; hours: number | null; rate_per_hour: number | null; rate_source: string; amount: number }
  overhead: Array<{ pool_code: string; basis: OverheadBasis; driver_hours: number; rate_per_hour: number; rate_source: string; amount: number }>
  excluded_pools: string[]
  overhead_total: number
  total: number
}

type RpcResult = { data: unknown; error: { message: string; code?: string } | null }
// 204's functions are not in database.generated.ts until 204 is applied and the
// types are regenerated from Production. Each call below stays a literal
// `.rpc('<name>', …)` so the RBAC mutation inventory still sees it.
const db204 = supabase as unknown as { rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult> }

async function requireOrgId(): Promise<string> {
  const orgId = await getEffectiveTenantId()
  if (!orgId) throw new Error('ORG_UNRESOLVED')
  return orgId
}

function throwRpcError(error: { message: string; code?: string }): never {
  // PostgREST: function absent from the schema cache -> 204 not applied here.
  if (error.code === 'PGRST202' || /Could not find the function/i.test(error.message)) {
    throw new Error('COST_POLICY_NOT_DEPLOYED')
  }
  throw new Error(error.message)
}

function toState(data: unknown): CostPolicyState {
  if (data === null || typeof data !== 'object') throw new Error('COST_POLICY_RESPONSE_INVALID')
  const row = data as Record<string, unknown>
  const capabilities = (row.capabilities ?? {}) as Record<string, unknown>
  return {
    today: String(row.today),
    currentVersionId: (row.current_version_id as string | null) ?? null,
    latestVersionNo: Number(row.latest_version_no ?? 0),
    versions: (row.versions ?? []) as CostPolicyVersion[],
    supported: row.supported as CostPolicyState['supported'],
    canManage: capabilities.can_manage === true,
  }
}

export async function getCostPolicy(): Promise<CostPolicyState> {
  const orgId = await requireOrgId()
  const { data, error } = await db204.rpc('rpc_get_mfg_cost_policy', { p_org_id: orgId })
  if (error) throwRpcError(error)
  return toState(data)
}

/**
 * ينشئ إصدارًا. `idempotencyKey` يبقى نفسه لكل محاولات الإرسال الواحد، فإعادة
 * الإرسال بعد انقطاع تعيد الإصدار نفسه (`replayed`) ولا تنشئ ثانيًا.
 */
export async function createCostPolicyVersion(
  draft: CostPolicyDraft, expectedLatestVersionNo: number, idempotencyKey: string,
): Promise<{ state: CostPolicyState; versionId: string; replayed: boolean }> {
  const orgId = await requireOrgId()
  const { data, error } = await db204.rpc('rpc_create_mfg_cost_policy_version', {
    p_org_id: orgId,
    p_policy: draft,
    p_expected_latest_version_no: expectedLatestVersionNo,
    p_idempotency_key: idempotencyKey,
  })
  if (error) throwRpcError(error)
  const row = data as Record<string, unknown>
  return { state: toState(data), versionId: String(row.policy_version_id), replayed: row.replayed === true }
}

export async function withdrawCostPolicyVersion(versionId: string, reason: string): Promise<CostPolicyState> {
  const orgId = await requireOrgId()
  const { data, error } = await db204.rpc('rpc_withdraw_mfg_cost_policy_version', {
    p_org_id: orgId,
    p_policy_version_id: versionId,
    p_reason: reason,
  })
  if (error) throwRpcError(error)
  return toState(data)
}

export async function previewAbsorption(input: {
  versionId: string
  workCenterId: string
  laborHours: number | null
  machineHours: number | null
  recordedLaborCost: number | null
}): Promise<AbsorptionPreview> {
  const orgId = await requireOrgId()
  const { data, error } = await db204.rpc('rpc_preview_mfg_cost_absorption', {
    p_org_id: orgId,
    p_policy_version_id: input.versionId,
    p_work_center_id: input.workCenterId,
    p_labor_hours: input.laborHours,
    p_machine_hours: input.machineHours,
    p_recorded_labor_cost: input.recordedLaborCost,
  })
  if (error) throwRpcError(error)
  return data as AbsorptionPreview
}

export interface CostPolicyWorkCenter {
  id: string
  code: string
  name: string
  nameAr: string | null
}

/** مراكز العمل النشطة (204 ترفض قاعدة لمركز غير نشط أو من مؤسسة أخرى). */
export async function listCostPolicyWorkCenters(): Promise<CostPolicyWorkCenter[]> {
  const orgId = await requireOrgId()
  const { data, error } = await supabase
    .from('work_centers')
    .select('id, code, name, name_ar')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => ({ id: row.id, code: row.code, name: row.name, nameAr: row.name_ar }))
}

/** رموز 204 → مفاتيح ترجمة (البادئة قبل «:» إن وُجدت). */
const COST_POLICY_ERRORS = [
  'COST_POLICY_NOT_DEPLOYED',
  'MANUFACTURING_SETTINGS_READ_DENIED',
  'MANUFACTURING_SETTINGS_UPDATE_DENIED',
  'COST_POLICY_VERSION_CONFLICT',
  'COST_POLICY_IDEMPOTENCY_CONFLICT',
  'COST_POLICY_EFFECTIVE_DATE_IN_PAST',
  'COST_POLICY_EFFECTIVE_DATE_NOT_AFTER_LATEST',
  'COST_POLICY_LABOR_RATE_MISSING',
  'COST_POLICY_LABOR_RATE_NOT_APPLICABLE',
  'COST_POLICY_RATE_INVALID',
  'COST_POLICY_WC_POOL_RATE_INVALID',
  'COST_POLICY_POOLS_REQUIRED',
  'COST_POLICY_POOL_DUPLICATE',
  'COST_POLICY_POOL_BASIS_UNSUPPORTED',
  'COST_POLICY_WORK_CENTER_UNKNOWN',
  'COST_POLICY_WORK_CENTER_DUPLICATE',
  'COST_POLICY_WC_POOL_UNKNOWN',
  'COST_POLICY_WC_POOL_DUPLICATE',
  'COST_POLICY_WC_RULE_EMPTY',
  'COST_POLICY_VERSION_PINNED',
  'COST_POLICY_VERSION_ALREADY_IN_FORCE',
  'COST_POLICY_VERSION_ALREADY_WITHDRAWN',
  'COST_POLICY_WITHDRAW_REASON_REQUIRED',
  'COST_POLICY_DRIVER_MISSING',
  'COST_POLICY_DRIVER_INVALID',
  'COST_POLICY_INPUT_NOT_APPLICABLE',
  'COST_POLICY_ORG_TIMEZONE_INVALID',
  'COST_POLICY_INVALID',
] as const

export function costPolicyErrorKey(message: string): string | null {
  const code = COST_POLICY_ERRORS.find(c => message === c || message.startsWith(`${c}:`))
  return code ? `manufacturingSettings.costPolicy.errors.${code}` : null
}

/** التفصيل بعد «:» (المسار أو الحد) يُعرض مع الرسالة المترجمة. */
export function costPolicyErrorDetail(message: string): string | null {
  const at = message.indexOf(':')
  return at > 0 ? message.slice(at + 1).trim() || null : null
}
