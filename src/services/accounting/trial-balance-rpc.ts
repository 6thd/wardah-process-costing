import type { SupabaseClient } from '@supabase/supabase-js'
import type { TrialBalanceData } from '@/domain/interfaces/IAccountingRepository'

export interface TrialBalanceRpcRow {
  account_code: string
  account_name: string
  account_name_ar: string | null
  account_type: string
  opening_debit: number
  opening_credit: number
  period_debit: number
  period_credit: number
  closing_debit: number
  closing_credit: number
}

/**
 * The only browser-side trial-balance data contract.
 *
 * Migration 183 removes authenticated access to v_trial_balance. Callers must
 * resolve their active organization and use the exact-permission RPC instead
 * of falling back to the view or rebuilding balances from ledger tables.
 */
export async function fetchTrialBalanceRpc(
  client: SupabaseClient,
  orgId: string | null,
  asOfDate?: string
): Promise<TrialBalanceRpcRow[]> {
  if (!orgId) {
    throw new Error('TRIAL_BALANCE_ORG_NOT_RESOLVED')
  }

  const { data, error } = await client.rpc('rpc_get_trial_balance', {
    p_tenant: orgId,
    p_as_of_date: asOfDate || null,
  })

  if (error) {
    throw new Error(error.message)
  }

  return (data || []) as TrialBalanceRpcRow[]
}

export function toTrialBalanceData(rows: TrialBalanceRpcRow[]): TrialBalanceData {
  const balances = rows.map(row => ({
    accountCode: row.account_code,
    accountName: row.account_name,
    accountType: row.account_type,
    debit: Number(row.closing_debit) || 0,
    credit: Number(row.closing_credit) || 0,
    balance: (Number(row.closing_debit) || 0) - (Number(row.closing_credit) || 0),
  }))

  const totals = balances.reduce(
    (total, row) => ({
      totalDebit: total.totalDebit + row.debit,
      totalCredit: total.totalCredit + row.credit,
    }),
    { totalDebit: 0, totalCredit: 0 }
  )

  return {
    balances,
    totals,
    isBalanced: Math.abs(totals.totalDebit - totals.totalCredit) < 0.01,
  }
}
