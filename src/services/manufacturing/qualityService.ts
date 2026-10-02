/**
 * Manufacturing quality control (Migration 199).
 *
 * Every read and write goes through the reviewed RPCs; the
 * quality_inspections table has no client grants. Inspector identity,
 * inspection number and QC cycle are assigned by the server.
 */
import { supabase } from '@/lib/supabase'
import type { Json } from '@/types/database.generated'

export type ReleaseGateMode = 'off' | 'all_orders' | 'routing_flagged'
export type InspectionScope = 'final_only' | 'stages_and_final'
export type InspectionType = 'IN_PROCESS' | 'FINAL'
export type InspectionResult = 'PASS' | 'FAIL' | 'CONDITIONAL'
export type Disposition = 'scrap' | 'rework' | 'use_as_is'

export interface QualityPolicySettings {
  release_gate_mode: ReleaseGateMode
  inspection_scope: InspectionScope
  allow_conditional_release: boolean
  segregation_of_duties: boolean
  admins_subject_to_quality_controls: boolean
}

export interface QualityCapabilities {
  can_manage_policy: boolean
  can_read: boolean
  can_inspect: boolean
  can_approve_conditional: boolean
}

export interface QualityPolicy extends QualityPolicySettings {
  org_id: string
  version: number
  updated_at: string | null
  updated_by: string | null
  capabilities: QualityCapabilities
}

export interface QualityReleaseStatus {
  gate_mode: ReleaseGateMode
  inspection_scope: InspectionScope
  allow_conditional_release: boolean
  required: boolean
  ready: boolean
  reason: string | null
  blocking_reason_if_required: string | null
  qc_cycle: number | null
  released_quantity: number
  missing_stage_ids: string[]
  final_inspection: {
    id: string
    inspection_number: string
    result: InspectionResult
    passed_quantity: number
    failed_quantity: number
    disposition: Disposition | null
    inspector_id: string | null
    inspection_date: string
  } | null
}

export interface MoQualityStatus {
  mo_id: string
  order_number: string
  status: string
  quantity: number
  maintenance_version: number
  release: QualityReleaseStatus
}

export interface QualityInspectionRow {
  id: string
  inspection_number: string
  inspection_type: InspectionType | string
  result: InspectionResult | null
  mo_id: string | null
  order_number: string | null
  work_order_id: string | null
  stage_id: string | null
  stage_name: string | null
  stage_name_ar: string | null
  qc_cycle: number | null
  sample_size: number | null
  passed_quantity: number | null
  failed_quantity: number | null
  disposition: Disposition | null
  findings: string | null
  corrective_action: string | null
  specifications: string | null
  inspector_id: string | null
  inspector_name: string | null
  inspection_date: string
}

export interface RecordInspectionInput {
  inspection_type: InspectionType
  result: InspectionResult
  passed_quantity: number
  failed_quantity: number
  sample_size?: number | null
  stage_id?: string | null
  disposition?: Disposition | null
  findings?: string
  corrective_action?: string
  specifications?: string
}

export interface RecordInspectionResult {
  replayed: boolean
  inspection_id: string
  inspection_number: string
  result: InspectionResult
  qc_cycle: number | null
  release: QualityReleaseStatus
}

export type QualityHoldAction = 'hold' | 'return'

export interface QualityHoldResult {
  mo_id: string
  previous_status: string
  status: string
  maintenance_version: number
  qc_cycle: number | null
}

/** Server error codes this feature surfaces; anything else stays generic. */
export const QUALITY_ERROR_CODES = [
  'QUALITY_POLICY_VERSION_CONFLICT',
  'QUALITY_POLICY_INVALID',
  'QUALITY_POLICY_UNKNOWN_KEY',
  'NOT_ORG_ADMIN',
  'NOT_ORG_MEMBER',
  'QUALITY_INSPECT_PERMISSION_DENIED',
  'QUALITY_CONDITIONAL_PERMISSION_DENIED',
  'QUALITY_READ_PERMISSION_DENIED',
  'QUALITY_SEGREGATION_OF_DUTIES',
  'QUALITY_MO_VERSION_CONFLICT',
  'QUALITY_HOLD_REQUIRES_IN_PROGRESS',
  'QUALITY_RETURN_REQUIRES_QUALITY_CHECK',
  'QUALITY_RETURN_REASON_REQUIRED',
  'QUALITY_REQUEST_ID_REUSED',
  'QUALITY_INVALID_QUANTITY',
  'QUALITY_DISPOSITION_REQUIRED',
  'QUALITY_DISPOSITION_NOT_ALLOWED',
  'QUALITY_FAIL_REQUIRES_REJECTED_QUANTITY',
  'QUALITY_CONDITIONAL_REQUIRES_USE_AS_IS',
  'QUALITY_USE_AS_IS_REQUIRES_CONDITIONAL',
  'QUALITY_CORRECTIVE_ACTION_REQUIRED',
  'QUALITY_CONDITIONAL_RELEASE_DISABLED',
  'QUALITY_CHECK_STATUS_REQUIRED',
  'QUALITY_MO_STATUS_INVALID',
  'QUALITY_STAGE_REQUIRED',
  'QUALITY_STAGE_NOT_FOUND',
  'QUALITY_STAGE_NOT_ALLOWED',
  'QUALITY_RELEASE_REQUIRED',
  'QUALITY_RELEASE_REJECTED',
  'QUALITY_STAGE_INSPECTION_REQUIRED',
  'QUALITY_RELEASE_QUANTITY_EXCEEDED',
] as const

export type QualityErrorCode = (typeof QUALITY_ERROR_CODES)[number]

export class QualityRpcError extends Error {
  readonly code: QualityErrorCode | null

  constructor(message: string, code: QualityErrorCode | null) {
    super(message)
    this.name = 'QualityRpcError'
    this.code = code
  }
}

/** Longest known code that prefixes the server message (codes may carry `: detail`). */
export function extractQualityErrorCode(message: string | null | undefined): QualityErrorCode | null {
  if (!message) return null
  let match: QualityErrorCode | null = null
  for (const code of QUALITY_ERROR_CODES) {
    if (message.startsWith(code) && (match === null || code.length > match.length)) {
      match = code
    }
  }
  return match
}

/** Unwraps a quality RPC response; errors carry the server's code. */
function unwrap<T>({ data, error }: { data: unknown; error: { message: string } | null }): T {
  if (error) {
    throw new QualityRpcError(error.message, extractQualityErrorCode(error.message))
  }
  return data as T
}

export async function getQualityPolicy(orgId: string): Promise<QualityPolicy> {
  return unwrap<QualityPolicy>(await supabase.rpc('rpc_get_quality_policy', { p_org_id: orgId }))
}

export async function setQualityPolicy(
  orgId: string,
  settings: QualityPolicySettings,
  expectedVersion: number
): Promise<QualityPolicy> {
  return unwrap<QualityPolicy>(await supabase.rpc('rpc_set_quality_policy', {
    p_org_id: orgId,
    p_policy: {
      release_gate_mode: settings.release_gate_mode,
      inspection_scope: settings.inspection_scope,
      allow_conditional_release: settings.allow_conditional_release,
      segregation_of_duties: settings.segregation_of_duties,
      admins_subject_to_quality_controls: settings.admins_subject_to_quality_controls,
    },
    p_expected_version: expectedVersion,
  }))
}

export async function listQualityInspections(
  orgId: string,
  moId?: string | null,
  limit = 100
): Promise<QualityInspectionRow[]> {
  const rows = unwrap<QualityInspectionRow[] | null>(await supabase.rpc('rpc_list_quality_inspections', {
    p_org_id: orgId,
    p_mo_id: moId ?? undefined,
    p_limit: limit,
  }))
  return rows ?? []
}

export async function getMoQualityStatus(moId: string): Promise<MoQualityStatus> {
  return unwrap<MoQualityStatus>(await supabase.rpc('rpc_get_mo_quality_status', { p_mo_id: moId }))
}

/** Only the fields the server contract accepts; blanks are omitted. */
export function buildInspectionPayload(input: RecordInspectionInput): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    inspection_type: input.inspection_type,
    result: input.result,
    passed_quantity: input.passed_quantity,
    failed_quantity: input.failed_quantity,
  }
  if (input.sample_size !== undefined && input.sample_size !== null) payload.sample_size = input.sample_size
  if (input.inspection_type === 'IN_PROCESS' && input.stage_id) payload.stage_id = input.stage_id
  if (input.failed_quantity > 0 && input.disposition) payload.disposition = input.disposition
  for (const key of ['findings', 'corrective_action', 'specifications'] as const) {
    const value = input[key]?.trim()
    if (value) payload[key] = value
  }
  return payload
}

/**
 * The caller owns requestId: generate it once per submitted form and reuse it
 * on retry, so a timed-out submit that actually landed replays instead of
 * writing a second inspection.
 */
export async function recordQualityInspection(
  moId: string,
  requestId: string,
  input: RecordInspectionInput
): Promise<RecordInspectionResult> {
  return unwrap<RecordInspectionResult>(await supabase.rpc('rpc_record_quality_inspection', {
    p_mo_id: moId,
    p_request_id: requestId,
    p_payload: buildInspectionPayload(input) as Json,
  }))
}

export async function setMoQualityHold(
  moId: string,
  action: QualityHoldAction,
  expectedVersion: number,
  reason?: string
): Promise<QualityHoldResult> {
  return unwrap<QualityHoldResult>(await supabase.rpc('rpc_set_mo_quality_hold', {
    p_mo_id: moId,
    p_action: action,
    p_expected_version: expectedVersion,
    p_reason: reason?.trim() || undefined,
  }))
}

export const qualityService = {
  getQualityPolicy,
  setQualityPolicy,
  listQualityInspections,
  getMoQualityStatus,
  recordQualityInspection,
  setMoQualityHold,
}
