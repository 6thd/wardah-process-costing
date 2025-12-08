import type { TrialBalanceRow, TrialBalanceTotals } from '../types';

export function calculateTotals(balances: TrialBalanceRow[]): TrialBalanceTotals {
  return balances.reduce(
    (acc, row) => ({
      opening_debit: acc.opening_debit + row.opening_debit,
      opening_credit: acc.opening_credit + row.opening_credit,
      period_debit: acc.period_debit + row.period_debit,
      period_credit: acc.period_credit + row.period_credit,
      closing_debit: acc.closing_debit + row.closing_debit,
      closing_credit: acc.closing_credit + row.closing_credit
    }),
    {
      opening_debit: 0,
      opening_credit: 0,
      period_debit: 0,
      period_credit: 0,
      closing_debit: 0,
      closing_credit: 0
    }
  );
}

export function filterBalancesByType(
  balances: TrialBalanceRow[],
  accountTypeFilter: string
): TrialBalanceRow[] {
  if (accountTypeFilter === 'all') {
    return balances;
  }
  return balances.filter(b => b.account_type === accountTypeFilter);
}

