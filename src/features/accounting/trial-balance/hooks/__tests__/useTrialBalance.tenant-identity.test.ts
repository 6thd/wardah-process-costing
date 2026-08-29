import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

/**
 * Guards the tenant identity of the sole trial-balance RPC path.
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
  rpcCalls: [] as Array<{ orgId: string | null; asOfDate?: string }>,
  tenantId: null as string | null,
  rpcRows: [] as unknown[],
  rpcThrows: false,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: { marker: 'client' },
  getTenantId: () => Promise.resolve(h.tenantId),
}))

vi.mock('@/services/accounting/trial-balance-rpc', () => ({
  fetchTrialBalanceRpc: (_client: unknown, orgId: string | null, asOfDate?: string) => {
    h.rpcCalls.push({ orgId, asOfDate })
    if (!orgId) return Promise.reject(new Error('TRIAL_BALANCE_ORG_NOT_RESOLVED'))
    if (h.rpcThrows) return Promise.reject(new Error('RPC unavailable'))
    return Promise.resolve(h.rpcRows)
  },
}))

vi.mock('@/lib/performance-monitor', () => ({
  PerformanceMonitor: { measure: (_label: string, fn: () => unknown) => fn() },
}))

vi.mock('i18next', () => ({ default: { t: (key: string) => key } }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

import { useTrialBalance } from '../useTrialBalance'

const CALLER_ORG = '11111111-2222-3333-4444-555555555555'
const RETIRED_HARDCODED_ORG = '00000000-0000-0000-0000-000000000001'

beforeEach(() => {
  h.rpcCalls = []
  h.tenantId = null
  h.rpcRows = []
  h.rpcThrows = false
})

describe('useTrialBalance tenant identity', () => {
  it("sends the caller's own organization to rpc_get_trial_balance", async () => {
    h.tenantId = CALLER_ORG

    renderHook(() => useTrialBalance('2026-01-01', '2026-01-31'))

    await waitFor(() => expect(h.rpcCalls).toHaveLength(1))

    expect(h.rpcCalls[0]).toEqual({ orgId: CALLER_ORG, asOfDate: '2026-01-31' })
  })

  it('never sends the retired hardcoded organization id', async () => {
    h.tenantId = CALLER_ORG

    renderHook(() => useTrialBalance('2026-01-01', '2026-01-31'))

    await waitFor(() => expect(h.rpcCalls).toHaveLength(1))

    expect(h.rpcCalls[0].orgId).not.toBe(RETIRED_HARDCODED_ORG)
  })

  it('fails closed when the caller has no organization', async () => {
    h.tenantId = null

    const { result } = renderHook(() => useTrialBalance('2026-01-01', '2026-01-31'))

    await waitFor(() => expect(h.rpcCalls).toHaveLength(1))

    expect(h.rpcCalls[0].orgId).toBeNull()
    expect(result.current.balances).toEqual([])
  })

  it('uses the RPC result directly without a view or manual fallback', async () => {
    h.tenantId = CALLER_ORG
    h.rpcRows = [{ account_code: '1101', account_name: 'Cash', closing_debit: 100 }]

    const { result } = renderHook(() => useTrialBalance('2026-01-01', '2026-01-31'))

    await waitFor(() => expect(result.current.balances).toEqual(h.rpcRows))
    expect(h.rpcCalls).toHaveLength(1)
  })
})
