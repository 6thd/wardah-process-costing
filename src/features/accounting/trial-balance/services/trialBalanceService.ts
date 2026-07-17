import i18next from 'i18next';
import { supabase } from '@/lib/supabase';
import { toast } from 'sonner';
import type { TrialBalanceRow } from '../types';

const t = (key: string) => i18next.t(key);

export async function fetchTrialBalanceManual(
  fromDate: string,
  asOfDate: string
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

    const { data: lines, error: linesError } = await supabase
      .from('gl_entry_lines')
      .select(`
        *,
        entry:gl_entries!inner (
          status,
          entry_date
        )
      `)
      .eq('entry.status', 'posted');

    if (linesError) throw linesError;

    const balanceMap = new Map<string, TrialBalanceRow>();

    accounts?.forEach(account => {
      balanceMap.set(account.id, {
        account_code: account.code,
        account_name: account.name,
        account_name_ar: account.name_ar,
        account_type: account.category,
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

      const entryDate = line.entry?.entry_date;

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
    // توست غير حاجب بدل alert() المتصفح (لا حوارات نظام في طبقة الخدمات)
    toast.error(t('accounting.trialBalance.fetchError'));
    return [];
  }
}

