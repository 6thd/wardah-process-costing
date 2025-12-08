import { supabase } from '@/lib/supabase';
import type { TrialBalanceRow } from '../types';

export async function fetchTrialBalanceManual(
  fromDate: string,
  asOfDate: string,
  isRTL: boolean
): Promise<TrialBalanceRow[]> {
  try {
    console.log('📊 Fetching manual trial balance...');

    const { data: accounts, error: accountsError } = await supabase
      .from('gl_accounts')
      .select('*')
      .eq('allow_posting', true)
      .eq('is_active', true)
      .order('code');

    if (accountsError) throw accountsError;
    console.log('✅ Accounts fetched:', accounts?.length);

    let lines: any[] = [];

    try {
      const { data: newLines, error: newError } = await supabase
        .from('gl_entry_lines')
        .select(`
          *,
          entry:gl_entries!inner (
            status,
            entry_date
          )
        `)
        .eq('entry.status', 'POSTED');

      if (!newError && newLines) {
        console.log('✅ Posted lines from gl_entry_lines:', newLines?.length);
        lines = newLines;
      } else {
        throw newError;
      }
    } catch (newError) {
      console.warn('Trying old journal_lines table:', newError);
      const { data: oldLines, error: linesError } = await supabase
        .from('journal_lines')
        .select(`
          *,
          journal_entries!inner (
            status,
            entry_date,
            posting_date
          )
        `)
        .eq('journal_entries.status', 'posted');

      if (linesError) throw linesError;
      console.log('✅ Posted lines fetched from journal_lines:', oldLines?.length);
      lines = oldLines || [];
    }

    const balanceMap = new Map<string, TrialBalanceRow>();

    accounts?.forEach(account => {
      balanceMap.set(account.id, {
        account_code: account.code,
        account_name: account.name,
        account_name_ar: account.name_ar,
        account_type: account.account_type,
        opening_debit: 0,
        opening_credit: 0,
        period_debit: 0,
        period_credit: 0,
        closing_debit: 0,
        closing_credit: 0
      });
    });

    lines.forEach((line: any) => {
      const balance = balanceMap.get(line.account_id);
      if (!balance) return;

      const entryDate = line.journal_entries?.posting_date || 
                       line.journal_entries?.entry_date || 
                       line.entry?.entry_date;

      if (entryDate && entryDate <= asOfDate) {
        if (entryDate >= fromDate) {
          balance.period_debit += Number(line.debit) || 0;
          balance.period_credit += Number(line.credit) || 0;
        } else {
          balance.opening_debit += Number(line.debit) || 0;
          balance.opening_credit += Number(line.credit) || 0;
        }
      }
    });

    balanceMap.forEach(balance => {
      const totalDebit = balance.opening_debit + balance.period_debit;
      const totalCredit = balance.opening_credit + balance.period_credit;

      if (totalDebit > totalCredit) {
        balance.closing_debit = totalDebit - totalCredit;
        balance.closing_credit = 0;
      } else if (totalCredit > totalDebit) {
        balance.closing_debit = 0;
        balance.closing_credit = totalCredit - totalDebit;
      } else {
        balance.closing_debit = 0;
        balance.closing_credit = 0;
      }
    });

    const balanceArray = Array.from(balanceMap.values())
      .filter(b =>
        b.opening_debit !== 0 ||
        b.opening_credit !== 0 ||
        b.period_debit !== 0 ||
        b.period_credit !== 0
      );

    console.log('✅ Balance array generated:', balanceArray.length, 'accounts with movement');
    return balanceArray;
  } catch (error) {
    console.error('❌ Error fetching manual trial balance:', error);
    if (isRTL) {
      alert('حدث خطأ في جلب البيانات');
    } else {
      alert('Error fetching data');
    }
    return [];
  }
}

