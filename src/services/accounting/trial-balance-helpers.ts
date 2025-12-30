/**
 * Helper functions for Trial Balance Service
 * Extracted to reduce cognitive complexity
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface TrialBalanceRow {
  account_code: string;
  account_name: string;
  account_name_ar?: string;
  debit: number;
  credit: number;
}

/**
 * Try to fetch trial balance from view
 */
export async function fetchTrialBalanceFromView(
  supabase: SupabaseClient,
  orgId: string | null
): Promise<TrialBalanceRow[] | null> {
  try {
    let viewQuery = supabase
      .from('v_trial_balance')
      .select('*');

    if (orgId) {
      viewQuery = viewQuery.eq('org_id', orgId);
    }

    const { data: viewData, error: viewError } = await viewQuery;

    if (viewError || !viewData || viewData.length === 0) {
      return null;
    }

    return viewData.map((row: Record<string, unknown>) => ({
      account_code: row.account_code as string,
      account_name: row.account_name as string,
      account_name_ar: row.account_name_ar as string | undefined,
      debit: (row.total_debit as number) || 0,
      credit: (row.total_credit as number) || 0
    })).sort((a, b) => a.account_code.localeCompare(b.account_code));
  } catch {
    return null;
  }
}

/**
 * Fetch posted entries
 */
export async function fetchPostedEntries(
  supabase: SupabaseClient,
  startDate?: string,
  endDate?: string
): Promise<Array<{ id: string }>> {
  let entriesQuery = supabase
    .from('gl_entries')
    .select('id, entry_date, status')
    .ilike('status', 'posted');

  if (startDate) {
    entriesQuery = entriesQuery.gte('entry_date', startDate);
  }
  if (endDate) {
    entriesQuery = entriesQuery.lte('entry_date', endDate);
  }

  const { data: entries, error: entriesError } = await entriesQuery;

  if (entriesError) {
    throw entriesError;
  }

  return (entries || []) as Array<{ id: string }>;
}

/**
 * Fetch entry lines
 */
export async function fetchEntryLines(
  supabase: SupabaseClient,
  entryIds: string[]
): Promise<Array<{ account_code: string; debit: number; credit: number; account_name?: string }>> {
  const { data: lines, error: linesError } = await supabase
    .from('gl_entry_lines')
    .select('*')
    .in('entry_id', entryIds);

  if (linesError) {
    throw linesError;
  }

  return (lines || []) as Array<{ account_code: string; debit: number; credit: number; account_name?: string }>;
}

/**
 * Fetch account names
 */
export async function fetchAccountNames(
  supabase: SupabaseClient,
  accountCodes: string[]
): Promise<Map<string, { name: string; name_ar?: string }>> {
  const { data: accounts, error: accountsError } = await supabase
    .from('gl_accounts')
    .select('code, name, name_ar')
    .in('code', accountCodes);

  if (accountsError) {
    console.warn('⚠️ Error fetching account names:', accountsError);
    return new Map();
  }

  const accountNamesMap = new Map<string, { name: string; name_ar?: string }>();
  (accounts || []).forEach((acc: Record<string, unknown>) => {
    accountNamesMap.set(acc.code as string, {
      name: acc.name as string,
      name_ar: acc.name_ar as string | undefined
    });
  });

  return accountNamesMap;
}

/**
 * Calculate trial balance totals
 */
export function calculateTrialBalanceTotals(
  lines: Array<{ account_code: string; debit: number; credit: number; account_name?: string }>,
  accountNamesMap: Map<string, { name: string; name_ar?: string }>
): TrialBalanceRow[] {
  const accountTotals = new Map<string, { debit: number; credit: number; name: string; name_ar?: string }>();

  for (const line of lines) {
    if (!accountTotals.has(line.account_code)) {
      const accountInfo = accountNamesMap.get(line.account_code);
      accountTotals.set(line.account_code, {
        debit: 0,
        credit: 0,
        name: accountInfo?.name || line.account_name || line.account_code,
        name_ar: accountInfo?.name_ar
      });
    }

    const account = accountTotals.get(line.account_code);
    if (!account) continue;

    account.debit += Number(line.debit) || 0;
    account.credit += Number(line.credit) || 0;
  }

  return Array.from(accountTotals.entries()).map(([code, totals]) => ({
    account_code: code,
    account_name: totals.name,
    account_name_ar: totals.name_ar,
    debit: totals.debit,
    credit: totals.credit
  })).sort((a, b) => a.account_code.localeCompare(b.account_code));
}

