import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * Guards the tenant identity of the trial-balance RPC fallback.
 *
 * The hook used to pass a hardcoded organization id
 * ('00000000-0000-0000-0000-000000000001') to rpc_get_trial_balance. That is
 * the only organization on the production project today, so the bug was
 * invisible: the call resolved to the right org by coincidence. The moment a
 * second organization exists, a member of both would see the default org's
 * numbers inside their own trial-balance screen.
 *
 * CI going green does not prove a future edit keeps the caller's real identity
 * on that call — these tests do. They assert the argument value itself, not
 * that a result is defined.
 */

const h = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  tenantId: null as string | null,
  serviceRows: [] as unknown[],
  serviceThrows: false,
  manualCalls: 0,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      h.rpcCalls.push({ fn, args })
      return Promise.resolve({ data: [], error: null })
    },
  },
  getTenantId: () => Promise.resolve(h.tenantId),
}))

vi.mock('@/services/supabase-service', () => ({
  trialBalanceService: {
    get: () => {
      if (h.serviceThrows) return Promise.reject(new Error('view unavailable'))
      return Promise.resolve(h.serviceRows)
    },
  },
}))

vi.mock('../../services/trialBalanceService', () => ({
  fetchTrialBalanceManual: () => {
    h.manualCalls += 1
    return Promise.resolve([])
  },
}))

vi.mock('@/lib/performance-monitor', () => ({
  PerformanceMonitor: { measure: (_label: string, fn: () => unknown) => fn() },
}))

import { useTrialBalance } from '../useTrialBalance'

const CALLER_ORG = '11111111-2222-3333-4444-555555555555'
const RETIRED_HARDCODED_ORG = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  h.rpcCalls = []
  h.tenantId = null
  h.serviceRows = []
  h.serviceThrows = false
  h.manualCalls = 0
})

describe('useTrialBalance tenant identity', () => {
  it("sends the caller's own organization to rpc_get_trial_balance", async () => {
    h.tenantId = CALLER_ORG
    h.serviceThrows = true // force the RPC fallback path

    renderHook(() => useTrialBalance('2026-01-01', '2026-01-31'))

    await waitFor(() => expect(h.rpcCalls).toHaveLength(1))

    const call = h.rpcCalls[0]
    expect(call.fn).toBe('rpc_get_trial_balance')
    expect(call.args.p_tenant).toBe(CALLER_ORG)
    expect(call.args.p_as_of_date).toBe('2026-01-31')
  })

  it('never sends the retired hardcoded organization id', async () => {
    h.tenantId = CALLER_ORG
    h.serviceThrows = true

    renderHook(() => useTrialBalance('2026-01-01', '2026-01-31'))

    await waitFor(() => expect(h.rpcCalls).toHaveLength(1))

    expect(h.rpcCalls[0].args.p_tenant).not.toBe(RETIRED_HARDCODED_ORG)
  })

  it('fails closed to the manual path when the caller has no organization', async () => {
    h.tenantId = null
    h.serviceThrows = true

    renderHook(() => useTrialBalance('2026-01-01', '2026-01-31'))

    await waitFor(() => expect(h.manualCalls).toBe(1))

    // No identity must mean no RPC call at all — not a call with a default org.
    expect(h.rpcCalls).toHaveLength(0)
  })

  it('does not reach the RPC while the primary ledger path returns rows', async () => {
    h.tenantId = CALLER_ORG
    h.serviceRows = [{ account_code: '1101', account_name: 'Cash', debit: 100, credit: 0 }]

    renderHook(() => useTrialBalance('2026-01-01', '2026-01-31'))

    await waitFor(() => expect(h.rpcCalls).toHaveLength(0))
    expect(h.manualCalls).toBe(0)
  })
})
