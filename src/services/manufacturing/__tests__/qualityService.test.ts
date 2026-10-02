import { beforeEach, describe, expect, it, vi } from 'vitest'

const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }))

import {
  QualityRpcError,
  buildInspectionPayload,
  extractQualityErrorCode,
  recordQualityInspection,
  setMoQualityHold,
  setQualityPolicy,
} from '../qualityService'

beforeEach(() => {
  rpc.mockReset()
})

describe('extractQualityErrorCode', () => {
  it('reads a code that carries server detail after a colon', () => {
    expect(extractQualityErrorCode('QUALITY_POLICY_VERSION_CONFLICT: current=4'))
      .toBe('QUALITY_POLICY_VERSION_CONFLICT')
  })

  it('prefers the longest matching code', () => {
    expect(extractQualityErrorCode('QUALITY_CONDITIONAL_RELEASE_DISABLED'))
      .toBe('QUALITY_CONDITIONAL_RELEASE_DISABLED')
  })

  it('returns null for unknown or empty messages', () => {
    expect(extractQualityErrorCode('permission denied for table quality_inspections')).toBeNull()
    expect(extractQualityErrorCode(undefined)).toBeNull()
  })
})

describe('buildInspectionPayload', () => {
  it('sends only contract fields: no stage on FINAL, no disposition without rejects, trimmed text', () => {
    expect(buildInspectionPayload({
      inspection_type: 'FINAL',
      result: 'PASS',
      passed_quantity: 10,
      failed_quantity: 0,
      stage_id: 'stage-1',
      disposition: 'scrap',
      findings: '  ok  ',
      corrective_action: '   ',
    })).toEqual({
      inspection_type: 'FINAL',
      result: 'PASS',
      passed_quantity: 10,
      failed_quantity: 0,
      findings: 'ok',
    })
  })

  it('keeps stage, sample and disposition for an in-process rejection', () => {
    expect(buildInspectionPayload({
      inspection_type: 'IN_PROCESS',
      result: 'FAIL',
      passed_quantity: 2,
      failed_quantity: 3,
      sample_size: 5,
      stage_id: 'stage-1',
      disposition: 'rework',
      corrective_action: 'retune',
    })).toEqual({
      inspection_type: 'IN_PROCESS',
      result: 'FAIL',
      passed_quantity: 2,
      failed_quantity: 3,
      sample_size: 5,
      stage_id: 'stage-1',
      disposition: 'rework',
      corrective_action: 'retune',
    })
  })
})

describe('RPC calls', () => {
  it('records an inspection through rpc_record_quality_inspection with the caller-owned request id', async () => {
    rpc.mockResolvedValue({ data: { inspection_number: 'QI-000001', replayed: false }, error: null })
    await recordQualityInspection('mo-1', 'req-1', {
      inspection_type: 'FINAL', result: 'PASS', passed_quantity: 10, failed_quantity: 0,
    })
    expect(rpc).toHaveBeenCalledWith('rpc_record_quality_inspection', {
      p_mo_id: 'mo-1',
      p_request_id: 'req-1',
      p_payload: { inspection_type: 'FINAL', result: 'PASS', passed_quantity: 10, failed_quantity: 0 },
    })
  })

  it('saves the policy with the expected version', async () => {
    rpc.mockResolvedValue({ data: { version: 3 }, error: null })
    await setQualityPolicy('org-1', {
      release_gate_mode: 'all_orders',
      inspection_scope: 'final_only',
      allow_conditional_release: false,
      segregation_of_duties: true,
      admins_subject_to_quality_controls: true,
    }, 2)
    expect(rpc).toHaveBeenCalledWith('rpc_set_quality_policy', expect.objectContaining({
      p_org_id: 'org-1',
      p_expected_version: 2,
    }))
  })

  it('omits a blank hold reason', async () => {
    rpc.mockResolvedValue({ data: {}, error: null })
    await setMoQualityHold('mo-1', 'hold', 7, '   ')
    expect(rpc).toHaveBeenCalledWith('rpc_set_mo_quality_hold', {
      p_mo_id: 'mo-1', p_action: 'hold', p_expected_version: 7, p_reason: undefined,
    })
  })

  it('turns a server error into a QualityRpcError carrying its code', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'QUALITY_SEGREGATION_OF_DUTIES' } })
    const call = setMoQualityHold('mo-1', 'hold', 1)
    await expect(call).rejects.toBeInstanceOf(QualityRpcError)
    await expect(call).rejects.toMatchObject({ code: 'QUALITY_SEGREGATION_OF_DUTIES' })
  })
})
