/**
 * إعدادات التصنيع (/settings/manufacturing) — تعيد استخدام العقود القائمة فقط:
 *  - صرف المواد: rpc_get/set_material_issue_wo_statuses (M192، حارس M201)
 *  - الجودة: rpc_get/set_quality_policy (M199، حارس M201)
 *  - ربط القيود: قراءة gl_event_mappings (SELECT للأعضاء بعد M200) والكتابة
 *    عبر rpc_set_gl_event_mapping (M200، حارس M201)
 *
 * قاعدة البيانات هي صاحبة القرار في الحفظ. `capabilities.can_manage_policy` من
 * rpc_get_quality_policy يُحسب بالمحدِّد نفسه الذي يحرس الكتّاب الثلاثة
 * (wardah_internal.manufacturing_settings_can_update_201)، فهو مصدر زر الحفظ
 * لكل التبويبات بدل تخمين الواجهة.
 */
import { supabase, getEffectiveTenantId } from '@/lib/supabase'

export const MATERIAL_ISSUE_REQUIRED_STATUS = 'IN_PROGRESS' as const
export const MATERIAL_ISSUE_OPTIONAL_STATUSES = ['READY', 'IN_SETUP'] as const
export type MaterialIssueOptionalStatus = (typeof MATERIAL_ISSUE_OPTIONAL_STATUSES)[number]

export interface MaterialIssueStatusesPolicy {
  allowedStatuses: string[]
  version: number
}

export const RELEASE_GATE_MODES = ['off', 'all_orders', 'routing_flagged'] as const
export const INSPECTION_SCOPES = ['final_only', 'stages_and_final'] as const

export interface QualityPolicyValues {
  release_gate_mode: (typeof RELEASE_GATE_MODES)[number]
  inspection_scope: (typeof INSPECTION_SCOPES)[number]
  allow_conditional_release: boolean
  segregation_of_duties: boolean
  admins_subject_to_quality_controls: boolean
}

export interface QualityPolicy extends QualityPolicyValues {
  version: number
  canManage: boolean
}

/**
 * أحداث التصنيع كما زرعتها Migration 77. `posted_by` يسمّي دالة الترحيل التي
 * تقرأ الحدث اليوم؛ الحدث بلا قارئ يُحفظ لكنه لا يغيّر أي قيد بعد.
 */
export const MANUFACTURING_GL_EVENTS = [
  { code: 'MATERIAL_ISSUE', postedBy: 'rpc_post_event_journal' },
  { code: 'FG_RECEIPT', postedBy: 'rpc_post_event_journal' },
  { code: 'OH_APPLIED', postedBy: 'rpc_post_work_center_oh' },
  { code: 'LABOR_APPLIED', postedBy: null },
  { code: 'NORMAL_SCRAP', postedBy: null },
  { code: 'ABNORMAL_SCRAP', postedBy: null },
  { code: 'OH_UNDER_APPLIED', postedBy: null },
  { code: 'OH_OVER_APPLIED', postedBy: null },
  { code: 'PROCESS_COST_VARIANCE', postedBy: null },
] as const
export type ManufacturingGlEventCode = (typeof MANUFACTURING_GL_EVENTS)[number]['code']

/** الحدث الوحيد الذي يقبل تجاوزًا لمركز عمل (M200). */
export const WORK_CENTER_OVERRIDE_EVENT: ManufacturingGlEventCode = 'OH_APPLIED'

export interface GlEventMappingRow {
  id: string
  eventCode: string
  workCenterCode: string | null
  debitAccountCode: string
  creditAccountCode: string
  description: string | null
  isActive: boolean
}

export interface PostingAccountOption {
  code: string
  name: string
  nameAr: string | null
}

export interface WorkCenterOption {
  code: string
  name: string
  nameAr: string | null
}

export interface GlEventMappingInput {
  eventCode: string
  workCenterCode: string | null
  debitAccountCode: string
  creditAccountCode: string
  description: string | null
  isActive: boolean
}

async function requireOrgId(): Promise<string> {
  const orgId = await getEffectiveTenantId()
  if (!orgId) throw new Error('ORG_UNRESOLVED')
  return orgId
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('MANUFACTURING_SETTINGS_RESPONSE_INVALID')
  }
  return value as Record<string, unknown>
}

function toMaterialIssuePolicy(data: unknown): MaterialIssueStatusesPolicy {
  const row = asRecord(data)
  const statuses = row.allowed_statuses
  if (!Array.isArray(statuses) || typeof row.version !== 'number') {
    throw new Error('MANUFACTURING_SETTINGS_RESPONSE_INVALID')
  }
  return { allowedStatuses: statuses.map(String), version: row.version }
}

function toQualityPolicy(data: unknown): QualityPolicy {
  const row = asRecord(data)
  const capabilities = asRecord(row.capabilities)
  if (typeof row.version !== 'number') throw new Error('MANUFACTURING_SETTINGS_RESPONSE_INVALID')
  return {
    release_gate_mode: row.release_gate_mode as QualityPolicyValues['release_gate_mode'],
    inspection_scope: row.inspection_scope as QualityPolicyValues['inspection_scope'],
    allow_conditional_release: row.allow_conditional_release === true,
    segregation_of_duties: row.segregation_of_duties === true,
    admins_subject_to_quality_controls: row.admins_subject_to_quality_controls === true,
    version: row.version,
    canManage: capabilities.can_manage_policy === true,
  }
}

export async function getMaterialIssueStatuses(): Promise<MaterialIssueStatusesPolicy> {
  const orgId = await requireOrgId()
  const { data, error } = await supabase.rpc('rpc_get_material_issue_wo_statuses', { p_org_id: orgId })
  if (error) throw new Error(error.message)
  return toMaterialIssuePolicy(data)
}

export async function setMaterialIssueStatuses(optional: readonly MaterialIssueOptionalStatus[]): Promise<MaterialIssueStatusesPolicy> {
  const orgId = await requireOrgId()
  const statuses = [MATERIAL_ISSUE_REQUIRED_STATUS, ...MATERIAL_ISSUE_OPTIONAL_STATUSES.filter(s => optional.includes(s))]
  const { data, error } = await supabase.rpc('rpc_set_material_issue_wo_statuses', {
    p_org_id: orgId,
    p_allowed_statuses: statuses,
  })
  if (error) throw new Error(error.message)
  return toMaterialIssuePolicy(data)
}

export async function getQualityPolicy(): Promise<QualityPolicy> {
  const orgId = await requireOrgId()
  const { data, error } = await supabase.rpc('rpc_get_quality_policy', { p_org_id: orgId })
  if (error) throw new Error(error.message)
  return toQualityPolicy(data)
}

export async function setQualityPolicy(values: QualityPolicyValues, expectedVersion: number): Promise<QualityPolicy> {
  const orgId = await requireOrgId()
  const { data, error } = await supabase.rpc('rpc_set_quality_policy', {
    p_org_id: orgId,
    p_policy: { ...values },
    p_expected_version: expectedVersion,
  })
  if (error) throw new Error(error.message)
  return toQualityPolicy(data)
}

export async function listGlEventMappings(): Promise<GlEventMappingRow[]> {
  const orgId = await requireOrgId()
  const codes = MANUFACTURING_GL_EVENTS.map(e => e.code)
  const { data, error } = await supabase
    .from('gl_event_mappings')
    .select('id, event_code, work_center_code, debit_account_code, credit_account_code, description, is_active')
    .eq('org_id', orgId)
    .in('event_code', codes)
    .order('event_code')
    .order('work_center_code', { nullsFirst: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => ({
    id: row.id,
    eventCode: row.event_code,
    workCenterCode: row.work_center_code,
    debitAccountCode: row.debit_account_code,
    creditAccountCode: row.credit_account_code,
    description: row.description,
    isActive: row.is_active,
  }))
}

/** الحسابات التي يقبلها الكاتب: نشطة ولا تمنع الترحيل (M200). */
export async function listPostingAccounts(): Promise<PostingAccountOption[]> {
  const orgId = await requireOrgId()
  const { data, error } = await supabase
    .from('gl_accounts')
    .select('code, name, name_ar, allow_posting')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter(row => row.allow_posting !== false)
    .map(row => ({ code: row.code, name: row.name, nameAr: row.name_ar }))
}

export async function listActiveWorkCenters(): Promise<WorkCenterOption[]> {
  const orgId = await requireOrgId()
  const { data, error } = await supabase
    .from('work_centers')
    .select('code, name, name_ar')
    .eq('org_id', orgId)
    .eq('is_active', true)
    .order('code')
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => ({ code: row.code, name: row.name, nameAr: row.name_ar }))
}

export async function setGlEventMapping(input: GlEventMappingInput): Promise<void> {
  const orgId = await requireOrgId()
  const { error } = await supabase.rpc('rpc_set_gl_event_mapping', {
    p_org_id: orgId,
    p_event_code: input.eventCode,
    p_debit_account_code: input.debitAccountCode,
    p_credit_account_code: input.creditAccountCode,
    p_work_center_code: input.workCenterCode ?? undefined,
    p_description: input.description ?? undefined,
    p_is_active: input.isActive,
  })
  if (error) throw new Error(error.message)
}

/**
 * رموز الرفض التي تعيدها قاعدة البيانات لهذه الشاشة → مفاتيح ترجمة. أي رسالة
 * أخرى تُعرض كما هي (لا تُخفى خلف رسالة عامة).
 */
const ERROR_KEYS: ReadonlyArray<readonly [string, string]> = [
  ['MANUFACTURING_SETTINGS_UPDATE_DENIED', 'manufacturingSettings.errors.updateDenied'],
  ['NOT_ORG_MEMBER', 'manufacturingSettings.errors.notMember'],
  ['QUALITY_POLICY_VERSION_CONFLICT', 'manufacturingSettings.errors.versionConflict'],
  ['GL_EVENT_MAPPING_CONCURRENT_CHANGE', 'manufacturingSettings.errors.versionConflict'],
  ['GL_EVENT_MAPPING_SAME_ACCOUNT', 'manufacturingSettings.errors.sameAccount'],
  ['GL_EVENT_MAPPING_DEBIT_ACCOUNT_INVALID', 'manufacturingSettings.errors.debitInvalid'],
  ['GL_EVENT_MAPPING_CREDIT_ACCOUNT_INVALID', 'manufacturingSettings.errors.creditInvalid'],
  ['GL_EVENT_MAPPING_ACCOUNT_REQUIRED', 'manufacturingSettings.errors.accountRequired'],
  ['GL_EVENT_MAPPING_WORK_CENTER_OVERRIDE_NOT_SUPPORTED', 'manufacturingSettings.errors.workCenterOverrideNotSupported'],
  ['GL_EVENT_MAPPING_WORK_CENTER_NOT_FOUND', 'manufacturingSettings.errors.workCenterNotFound'],
  ['INVALID_MATERIAL_ISSUE_WO_STATUSES', 'manufacturingSettings.errors.invalidStatuses'],
]

export function manufacturingSettingsErrorKey(message: string): string | null {
  const hit = ERROR_KEYS.find(([code]) => message.includes(code))
  return hit ? hit[1] : null
}
