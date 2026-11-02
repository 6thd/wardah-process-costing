import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockRpc = vi.fn()
const mockGetSession = vi.fn()
const mockTenant = vi.fn()
vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getSession: () => mockGetSession() },
  },
  getEffectiveTenantId: () => mockTenant(),
}))

import {
  discoverCostPolicy205,
  formatServerAmount,
  isStaleDraft,
  parseCostPolicy205State,
  unresolvedLegacyVersions,
} from '../mfg-cost-policy-205-service'
import { cp205Response, ORG, SESSION_USER } from './fixtures/cost-policy-205'
import pg17 from './fixtures/cost-policy-205-get.pg17.json'

beforeEach(() => {
  mockRpc.mockReset()
  mockGetSession.mockReset()
  mockTenant.mockReset()
  mockTenant.mockResolvedValue(ORG)
  mockGetSession.mockResolvedValue({ data: { session: { user: { id: SESSION_USER } } } })
})

describe('discoverCostPolicy205: the four states (design §2)', () => {
  it('is absent only on PGRST202 from rpc_get_mfg_cost_policy_205', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.rpc_get_mfg_cost_policy_205(p_org_id) in the schema cache' } })
    await expect(discoverCostPolicy205()).resolves.toEqual({ status: 'absent' })
    expect(mockRpc).toHaveBeenCalledTimes(1)
    expect(mockRpc).toHaveBeenCalledWith('rpc_get_mfg_cost_policy_205', { p_org_id: ORG })
  })

  it('does not take the "Could not find the function" text without the code as absence', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '', message: 'Could not find the function public.rpc_get_mfg_cost_policy_205' } })
    const result = await discoverCostPolicy205()
    expect(result.status).toBe('unknown')
  })

  it('is denied on MANUFACTURING_SETTINGS_READ_DENIED', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'MANUFACTURING_SETTINGS_READ_DENIED' } })
    await expect(discoverCostPolicy205()).resolves.toEqual({ status: 'denied' })
  })

  it.each([
    ['a 5xx', { code: '', message: 'Internal Server Error' }],
    ['another PostgREST error', { code: 'PGRST301', message: 'JWT expired' }],
    ['another database error', { code: 'P0001', message: 'NOT_ORG_MEMBER' }],
  ])('is unknown on %s', async (_label, error) => {
    mockRpc.mockResolvedValue({ data: null, error })
    await expect(discoverCostPolicy205()).resolves.toEqual({ status: 'unknown', reason: error.message })
  })

  it('is unknown when the call throws (network)', async () => {
    mockRpc.mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(discoverCostPolicy205()).resolves.toEqual({ status: 'unknown', reason: 'Failed to fetch' })
  })

  it('is unknown without an organization, and calls nothing', async () => {
    mockTenant.mockResolvedValue(null)
    await expect(discoverCostPolicy205()).resolves.toEqual({ status: 'unknown', reason: 'ORG_UNRESOLVED' })
    expect(mockRpc).not.toHaveBeenCalled()
  })

  it.each([
    ['no capabilities', { capabilities: undefined }],
    ['a capability that is not a boolean', { capabilities: { can_create: 'yes', can_approve: true, can_self_approve: true, can_manage_approval_settings: true, can_manage_unallocated_policy: true } }],
    ['a missing capability', { capabilities: { can_create: true, can_approve: true, can_self_approve: true, can_manage_approval_settings: true } }],
    ['cost centers said to be accepted', { supported: { cost_centers_accepted: true } }],
    ['an unknown approval path', { versions: [{ ...(cp205Response().versions as Record<string, unknown>[])[0], policy_205: 'other' }] }],
    ['an unknown company policy', { settings: { self_approval_enabled: false, unallocated_budget_policy: 'allow' } }],
    ['drafts that are not a list', { drafts: {} }],
    ['a null response', null],
  ])('is unknown on a malformed reply: %s', async (_label, overrides) => {
    mockRpc.mockResolvedValue({ data: overrides === null ? null : cp205Response(overrides as Record<string, unknown>), error: null })
    const result = await discoverCostPolicy205()
    expect(result.status).toBe('unknown')
    expect(result.status === 'unknown' && result.reason).toMatch(/^COST_POLICY_205_RESPONSE_INVALID: /)
  })

  it('is present on a reply of the contract shape, with the session user for display only', async () => {
    mockRpc.mockResolvedValue({ data: cp205Response(), error: null })
    const result = await discoverCostPolicy205()
    expect(result.status).toBe('present')
    if (result.status !== 'present') return
    expect(result.state.sessionUserId).toBe(SESSION_USER)
    expect(result.state.latestVersionNo).toBe(2)
    expect(result.state.versions.map(v => [v.version_no, v.policy_205])).toEqual([[2, 'approved_205'], [1, 'legacy_unresolved']])
    expect(result.state.settings).toEqual({ selfApprovalEnabled: false, unallocatedBudgetPolicy: 'controlled_exception' })
    expect(result.state.capabilities.can_approve).toBe(true)
    // The only call is the read: no write function of 205 or 204 is reached by discovery.
    expect(mockRpc.mock.calls.map(c => c[0])).toEqual(['rpc_get_mfg_cost_policy_205'])
  })
})

describe('the reply of the merged 205 on PostgreSQL 17 (generated, not hand-written)', () => {
  it('parses as present with every version, draft and audit row, and keeps the stored riyal amounts', () => {
    const state = parseCostPolicy205State(pg17.reply, pg17.session_user)
    expect(state.versions).toHaveLength(pg17.reply.versions.length)
    expect(state.drafts).toHaveLength(pg17.reply.drafts.length)
    expect(state.settingsAudit).toHaveLength(pg17.reply.settings_audit.length)
    expect(new Set(state.versions.map(v => v.policy_205))).toEqual(new Set(['approved_205', 'legacy_resolved', 'legacy_unresolved']))
    expect(new Set(state.drafts.map(d => d.status))).toEqual(new Set(['draft', 'approved', 'rejected', 'withdrawn']))
    const withException = state.versions.filter(v => v.unallocated_exception)
    expect(withException.length).toBeGreaterThan(0)
    for (const v of withException) {
      for (const value of Object.values(v.unallocated_exception?.budgets ?? {})) {
        // Stored as numeric(18,2) riyal: formatting changes nothing but the trailing zeros.
        expect(Number(formatServerAmount(value))).toBe(Number(value))
      }
    }
  })
})

describe('amounts are shown as the server sends them (design §11)', () => {
  it('keeps the value, adds the two decimals, never scales', () => {
    expect(formatServerAmount(4800.5)).toBe('4800.50')
    expect(formatServerAmount(9000)).toBe('9000.00')
    expect(formatServerAmount('15000.25')).toBe('15000.25')
    expect(formatServerAmount(0)).toBe('0.00')
    // A figure in cents would show a hundred times larger; none is passed through a factor here.
    expect(formatServerAmount(480050)).toBe('480050.00')
  })

  it('shows an amount as entered that is not a number as its text, and nothing for null', () => {
    expect(formatServerAmount('abc')).toBe('abc')
    expect(formatServerAmount('10.005')).toBe('10.005')
    expect(formatServerAmount(null)).toBeNull()
    expect(formatServerAmount(undefined)).toBeNull()
  })
})

describe('read helpers', () => {
  it('lists unresolved legacy versions linked to orders first, then the current one, and never a withdrawn one', () => {
    const base = cp205Response()
    const v1 = (base.versions as Record<string, unknown>[])[1]
    const versions = [
      { ...v1, id: 'a', version_no: 5, status: 'scheduled', pinned_order_count: 0 },
      { ...v1, id: 'b', version_no: 4, status: 'superseded', pinned_order_count: 0, awaiting_start_order_count: 3 },
      { ...v1, id: 'cur', version_no: 3, status: 'current', pinned_order_count: 0 },
      { ...v1, id: 'w', version_no: 2, status: 'withdrawn', pinned_order_count: 0 },
      (base.versions as Record<string, unknown>[])[0],
    ]
    const state = parseCostPolicy205State(cp205Response({ versions, current_version_id: 'cur' }), null)
    expect(unresolvedLegacyVersions(state).map(v => v.id)).toEqual(['b', 'cur', 'a'])
  })

  it('marks a version draft saved against an older latest version as stale', () => {
    const state = parseCostPolicy205State(cp205Response(), null)
    const [stale, legacy, approved] = state.drafts
    expect(isStaleDraft(stale, state.latestVersionNo)).toBe(true)
    expect(isStaleDraft(legacy, state.latestVersionNo)).toBe(false)
    expect(isStaleDraft(approved, state.latestVersionNo)).toBe(false)
  })
})
