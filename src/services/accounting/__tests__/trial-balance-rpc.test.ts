import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchTrialBalanceRpc, toTrialBalanceData } from '../trial-balance-rpc'

const ORG_ID = '11111111-2222-3333-4444-555555555555'

function clientWith(result: { data: unknown[] | null; error: { message: string } | null }) {
  return {
    rpc: vi.fn().mockResolvedValue(result),
    from: vi.fn(() => {
      throw new Error('direct table/view reads are forbidden for trial balance')
    }),
  } as unknown as SupabaseClient
}

describe('trial-balance RPC client contract', () => {
  it('calls only rpc_get_trial_balance with caller org and as-of date', async () => {
    const client = clientWith({ data: [], error: null })

    await fetchTrialBalanceRpc(client, ORG_ID, '2026-08-31')

    expect(client.rpc).toHaveBeenCalledTimes(1)
    expect(client.rpc).toHaveBeenCalledWith('rpc_get_trial_balance', {
      p_tenant: ORG_ID,
      p_as_of_date: '2026-08-31',
    })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('fails before any database call when the organization is unresolved', async () => {
    const client = clientWith({ data: [], error: null })

    await expect(fetchTrialBalanceRpc(client, null, '2026-08-31'))
      .rejects.toThrow('TRIAL_BALANCE_ORG_NOT_RESOLVED')
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalled()
  })

  it('propagates the server authorization/data error without fallback', async () => {
    const client = clientWith({
      data: null,
      error: { message: 'PERMISSION_DENIED: reports.financial.read' },
    })

    await expect(fetchTrialBalanceRpc(client, ORG_ID, '2026-08-31'))
      .rejects.toThrow('PERMISSION_DENIED: reports.financial.read')
    expect(client.from).not.toHaveBeenCalled()
  })

  it('maps the RPC closing balances into the repository summary contract', () => {
    const result = toTrialBalanceData([
      {
        account_code: '110100',
        account_name: 'Cash',
        account_name_ar: 'النقدية',
        account_type: 'ASSET',
        opening_debit: 20,
        opening_credit: 0,
        period_debit: 80,
        period_credit: 0,
        closing_debit: 100,
        closing_credit: 0,
      },
      {
        account_code: '210100',
        account_name: 'Payables',
        account_name_ar: 'الدائنون',
        account_type: 'LIABILITY',
        opening_debit: 0,
        opening_credit: 40,
        period_debit: 0,
        period_credit: 60,
        closing_debit: 0,
        closing_credit: 100,
      },
    ])

    expect(result.totals).toEqual({ totalDebit: 100, totalCredit: 100 })
    expect(result.isBalanced).toBe(true)
    expect(result.balances[0]).toMatchObject({
      accountCode: '110100',
      debit: 100,
      credit: 0,
      balance: 100,
    })
  })
})
