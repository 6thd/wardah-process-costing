/**
 * خدمة القيود المحاسبية - Accounting Service
 * إدارة القيود المحاسبية والتكامل مع دليل الحسابات
 */

import { supabase } from '../lib/supabase';
import { PerformanceMonitor } from '../lib/performance-monitor';

// ===== TYPES =====

export interface GLEntry {
  id?: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
  description: string;
  reference_type: string;
  reference_id: string;
  transaction_date: string;
  fiscal_year?: number;
  fiscal_period?: number;
  created_at?: string;
  created_by?: string;
}

export interface JournalEntry {
  entry_date: string;
  description: string;
  reference_type?: string;
  reference_id?: string;
  entries: GLEntry[];
}

// ===== GENERAL LEDGER FUNCTIONS =====

/**
 * إنشاء قيد محاسبي
 * التحقق من توازن المدين والدائن
 */
export async function createJournalEntry(journalEntry: JournalEntry) {
  try {
    // 1. التحقق من توازن القيد
    let totalDebit = 0;
    let totalCredit = 0;

    journalEntry.entries.forEach(entry => {
      totalDebit += entry.debit;
      totalCredit += entry.credit;
    });

    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(`القيد غير متوازن. المدين: ${totalDebit}، الدائن: ${totalCredit}`);
    }

    // 2. التحقق من وجود الحسابات في دليل الحسابات
    for (const entry of journalEntry.entries) {
      const { data: account, error } = await supabase
        .from('gl_accounts')
        .select('account_code, account_name')
        .eq('account_code', entry.account_code)
        .single();

      if (error || !account) {
        throw new Error(`الحساب ${entry.account_code} غير موجود في دليل الحسابات`);
      }
    }

    // 3. إدراج القيود
    const entriesWithDate = journalEntry.entries.map(entry => ({
      ...entry,
      transaction_date: journalEntry.entry_date,
      reference_type: journalEntry.reference_type,
      reference_id: journalEntry.reference_id,
    }));

    const { data, error } = await supabase
      .from('gl_entries')
      .insert(entriesWithDate)
      .select();

    if (error) throw error;

    console.log(`✅ تم إنشاء قيد محاسبي: ${journalEntry.description} (${journalEntry.entries.length} سطور)`);
    return { success: true, data };
  } catch (error) {
    console.error('Error creating journal entry:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على قيود حساب معين
 */
export async function getAccountEntries(
  accountCode: string,
  fromDate?: string,
  toDate?: string
) {
  try {
    let query = supabase
      .from('gl_entries')
      .select('*')
      .eq('account_code', accountCode)
      .order('transaction_date', { ascending: true });

    if (fromDate) {
      query = query.gte('transaction_date', fromDate);
    }
    if (toDate) {
      query = query.lte('transaction_date', toDate);
    }

    const { data, error } = await query;

    if (error) throw error;

    return { success: true, data };
  } catch (error) {
    console.error('Error fetching account entries:', error);
    return { success: false, error };
  }
}

/**
 * حساب رصيد حساب معين
 */
export async function calculateAccountBalance(
  accountCode: string,
  upToDate?: string
) {
  try {
    let query = supabase
      .from('gl_entries')
      .select('debit, credit')
      .eq('account_code', accountCode);

    if (upToDate) {
      query = query.lte('transaction_date', upToDate);
    }

    const { data, error } = await query;

    if (error) throw error;

    let totalDebit = 0;
    let totalCredit = 0;

    data?.forEach(entry => {
      totalDebit += entry.debit;
      totalCredit += entry.credit;
    });

    const balance = totalDebit - totalCredit;

    return {
      success: true,
      accountCode,
      totalDebit,
      totalCredit,
      balance,
    };
  } catch (error) {
    console.error('Error calculating account balance:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على ميزان المراجعة
 */
export async function getTrialBalance(fromDate?: string, toDate?: string) {
  return PerformanceMonitor.measure('Trial Balance', async () => {
    try {
      // 1. الحصول على جميع الحسابات
      const { data: accounts, error: accountsError } = await supabase
        .from('gl_accounts')
        .select('account_code, account_name, account_type')
        .order('account_code');

      if (accountsError) throw accountsError;

      // 2. حساب رصيد كل حساب
      const balances = [];

      for (const account of accounts || []) {
        let query = supabase
          .from('gl_entries')
          .select('debit, credit')
          .eq('account_code', account.account_code);

        if (fromDate) {
          query = query.gte('transaction_date', fromDate);
        }
        if (toDate) {
          query = query.lte('transaction_date', toDate);
        }

        const { data: entries } = await query;

        let totalDebit = 0;
        let totalCredit = 0;

        entries?.forEach(entry => {
          totalDebit += entry.debit;
          totalCredit += entry.credit;
        });

        if (totalDebit !== 0 || totalCredit !== 0) {
          balances.push({
            account_code: account.account_code,
            account_name: account.account_name,
            account_type: account.account_type,
            debit: totalDebit,
            credit: totalCredit,
            balance: totalDebit - totalCredit,
          });
        }
      }

      // 3. حساب الإجماليات
      const totals = balances.reduce(
        (acc, curr) => ({
          totalDebit: acc.totalDebit + curr.debit,
          totalCredit: acc.totalCredit + curr.credit,
        }),
        { totalDebit: 0, totalCredit: 0 }
      );

      return {
        success: true,
        balances,
        totals,
        isBalanced: Math.abs(totals.totalDebit - totals.totalCredit) < 0.01,
      };
    } catch (error) {
      console.error('Error generating trial balance:', error);
      return { success: false, error };
    }
  });
}

/**
 * الحصول على قائمة الدخل
 */
export async function getIncomeStatement(fromDate: string, toDate: string) {
  try {
    // الحصول على حسابات الإيرادات والمصروفات
    const { data: entries, error } = await supabase
      .from('gl_entries')
      .select(`
        account_code,
        account_name,
        debit,
        credit
      `)
      .gte('transaction_date', fromDate)
      .lte('transaction_date', toDate)
      .or('account_code.like.4%,account_code.like.5%'); // الإيرادات تبدأ بـ 4، المصروفات بـ 5

    if (error) throw error;

    // تجميع حسب الحساب
    const accountTotals: { [key: string]: any } = {};

    entries?.forEach(entry => {
      if (!accountTotals[entry.account_code]) {
        accountTotals[entry.account_code] = {
          account_code: entry.account_code,
          account_name: entry.account_name,
          debit: 0,
          credit: 0,
        };
      }
      accountTotals[entry.account_code].debit += entry.debit;
      accountTotals[entry.account_code].credit += entry.credit;
    });

    // فصل الإيرادات والمصروفات
    const revenues: any[] = [];
    const expenses: any[] = [];

    let totalRevenue = 0;
    let totalExpense = 0;

    Object.values(accountTotals).forEach((account: any) => {
      const netAmount = account.credit - account.debit;

      if (account.account_code.startsWith('4')) {
        // إيرادات
        revenues.push({
          ...account,
          amount: netAmount,
        });
        totalRevenue += netAmount;
      } else if (account.account_code.startsWith('5')) {
        // مصروفات
        expenses.push({
          ...account,
          amount: account.debit - account.credit,
        });
        totalExpense += account.debit - account.credit;
      }
    });

    const netIncome = totalRevenue - totalExpense;

    return {
      success: true,
      period: { from: fromDate, to: toDate },
      revenues,
      expenses,
      totalRevenue,
      totalExpense,
      netIncome,
      profitMargin: totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0,
    };
  } catch (error) {
    console.error('Error generating income statement:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على الميزانية العمومية
 */
export async function getBalanceSheet(asOfDate: string) {
  try {
    // الحصول على حسابات الأصول والخصوم وحقوق الملكية
    const { data: entries, error } = await supabase
      .from('gl_entries')
      .select(`
        account_code,
        account_name,
        debit,
        credit
      `)
      .lte('transaction_date', asOfDate)
      .or('account_code.like.1%,account_code.like.2%,account_code.like.3%'); // 1=أصول، 2=خصوم، 3=حقوق ملكية

    if (error) throw error;

    // تجميع حسب الحساب
    const accountTotals: { [key: string]: any } = {};

    entries?.forEach(entry => {
      if (!accountTotals[entry.account_code]) {
        accountTotals[entry.account_code] = {
          account_code: entry.account_code,
          account_name: entry.account_name,
          debit: 0,
          credit: 0,
        };
      }
      accountTotals[entry.account_code].debit += entry.debit;
      accountTotals[entry.account_code].credit += entry.credit;
    });

    // فصل الأصول والخصوم وحقوق الملكية
    const assets: any[] = [];
    const liabilities: any[] = [];
    const equity: any[] = [];

    let totalAssets = 0;
    let totalLiabilities = 0;
    let totalEquity = 0;

    Object.values(accountTotals).forEach((account: any) => {
      const balance = account.debit - account.credit;

      if (account.account_code.startsWith('1')) {
        // أصول
        assets.push({ ...account, balance });
        totalAssets += balance;
      } else if (account.account_code.startsWith('2')) {
        // خصوم
        liabilities.push({ ...account, balance: -balance }); // عكس الإشارة
        totalLiabilities += -balance;
      } else if (account.account_code.startsWith('3')) {
        // حقوق ملكية
        equity.push({ ...account, balance: -balance }); // عكس الإشارة
        totalEquity += -balance;
      }
    });

    return {
      success: true,
      asOfDate,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    };
  } catch (error) {
    console.error('Error generating balance sheet:', error);
    return { success: false, error };
  }
}

/**
 * الحصول على دفتر اليومية
 */
export async function getGeneralJournal(fromDate?: string, toDate?: string, referenceType?: string) {
  return PerformanceMonitor.measure('General Journal', async () => {
    try {
      let query = supabase
        .from('gl_entries')
        .select('*')
        .order('transaction_date', { ascending: true })
        .order('created_at', { ascending: true });

      if (fromDate) {
        query = query.gte('transaction_date', fromDate);
      }
      if (toDate) {
        query = query.lte('transaction_date', toDate);
      }
      if (referenceType) {
        query = query.eq('reference_type', referenceType);
      }

      const { data, error } = await query;

      if (error) throw error;

      // تجميع القيود حسب المرجع
      const journalEntries: { [key: string]: any } = {};

      data?.forEach(entry => {
        const key = `${entry.reference_type}_${entry.reference_id}_${entry.transaction_date}`;

        if (!journalEntries[key]) {
          journalEntries[key] = {
            transaction_date: entry.transaction_date,
            reference_type: entry.reference_type,
            reference_id: entry.reference_id,
            description: entry.description,
            entries: [],
            totalDebit: 0,
            totalCredit: 0,
          };
        }

        journalEntries[key].entries.push(entry);
        journalEntries[key].totalDebit += entry.debit;
        journalEntries[key].totalCredit += entry.credit;
      });

      return {
        success: true,
        journalEntries: Object.values(journalEntries),
      };
    } catch (error) {
      console.error('Error fetching general journal:', error);
      return { success: false, error };
    }
  });
}

/**
 * الحصول على كشف حساب
 */
export async function getAccountStatement(
  accountCode: string,
  fromDate?: string,
  toDate?: string
) {
  try {
    // 1. الحصول على معلومات الحساب
    const { data: account, error: accountError } = await supabase
      .from('gl_accounts')
      .select('*')
      .eq('account_code', accountCode)
      .single();

    if (accountError) throw accountError;

    // 2. حساب الرصيد الافتتاحي
    let openingBalance = 0;
    if (fromDate) {
      const { data: openingEntries } = await supabase
        .from('gl_entries')
        .select('debit, credit')
        .eq('account_code', accountCode)
        .lt('transaction_date', fromDate);

      openingEntries?.forEach(entry => {
        openingBalance += entry.debit - entry.credit;
      });
    }

    // 3. الحصول على الحركات
    let query = supabase
      .from('gl_entries')
      .select('*')
      .eq('account_code', accountCode)
      .order('transaction_date', { ascending: true });

    if (fromDate) {
      query = query.gte('transaction_date', fromDate);
    }
    if (toDate) {
      query = query.lte('transaction_date', toDate);
    }

    const { data: entries, error: entriesError } = await query;

    if (entriesError) throw entriesError;

    // 4. حساب الرصيد الجاري
    let runningBalance = openingBalance;
    const movements = entries?.map(entry => {
      runningBalance += entry.debit - entry.credit;
      return {
        ...entry,
        balance: runningBalance,
      };
    });

    // 5. حساب الإجماليات
    const totals = entries?.reduce(
      (acc, entry) => ({
        debit: acc.debit + entry.debit,
        credit: acc.credit + entry.credit,
      }),
      { debit: 0, credit: 0 }
    );

    return {
      success: true,
      account,
      openingBalance,
      movements,
      closingBalance: runningBalance,
      totals,
    };
  } catch (error) {
    console.error('Error generating account statement:', error);
    return { success: false, error };
  }
}
