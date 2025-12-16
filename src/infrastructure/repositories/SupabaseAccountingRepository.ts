/**
 * SupabaseAccountingRepository - Infrastructure Implementation (Adapter)
 * 
 * تنفيذ Repository Pattern للمحاسبة باستخدام Supabase
 */

import { supabase } from '@/lib/supabase'
import type {
  IAccountingRepository,
  GLAccountData,
  GLEntryData,
  JournalEntryData,
  AccountBalanceData,
  TrialBalanceData,
  IncomeStatementData,
  BalanceSheetData,
  AccountStatementData,
} from '@/domain/interfaces/IAccountingRepository'

export class SupabaseAccountingRepository implements IAccountingRepository {
  
  // ===== Chart of Accounts =====

  async getAccount(accountCode: string): Promise<GLAccountData | null> {
    const { data, error } = await supabase
      .from('gl_accounts')
      .select('*')
      .eq('account_code', accountCode)
      .single()

    if (error) {
      if (error.code === 'PGRST116') return null
      throw new Error(`فشل في جلب الحساب: ${error.message}`)
    }

    return this.mapAccount(data)
  }

  async getAccounts(filters?: { type?: string; parentCode?: string; active?: boolean }): Promise<GLAccountData[]> {
    let query = supabase.from('gl_accounts').select('*').order('account_code')

    if (filters?.type) {
      query = query.eq('account_type', filters.type)
    }
    if (filters?.parentCode) {
      query = query.eq('parent_code', filters.parentCode)
    }
    if (filters?.active !== undefined) {
      query = query.eq('is_active', filters.active)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`فشل في جلب الحسابات: ${error.message}`)
    }

    return (data || []).map(this.mapAccount)
  }

  async createAccount(account: Omit<GLAccountData, 'id'>): Promise<GLAccountData> {
    const insertData = {
      account_code: account.accountCode,
      account_name: account.accountName,
      account_name_ar: account.accountNameAr,
      account_type: account.accountType,
      parent_code: account.parentCode,
      level: account.level,
      is_active: account.isActive,
      normal_balance: account.normalBalance,
      currency: account.currency,
    }

    const { data, error } = await supabase
      .from('gl_accounts')
      .insert(insertData)
      .select()
      .single()

    if (error) {
      throw new Error(`فشل في إنشاء الحساب: ${error.message}`)
    }

    return this.mapAccount(data)
  }

  async updateAccount(accountCode: string, data: Partial<GLAccountData>): Promise<void> {
    const updateData: any = {}
    
    if (data.accountName !== undefined) updateData.account_name = data.accountName
    if (data.accountNameAr !== undefined) updateData.account_name_ar = data.accountNameAr
    if (data.isActive !== undefined) updateData.is_active = data.isActive
    updateData.updated_at = new Date().toISOString()

    const { error } = await supabase
      .from('gl_accounts')
      .update(updateData)
      .eq('account_code', accountCode)

    if (error) {
      throw new Error(`فشل في تحديث الحساب: ${error.message}`)
    }
  }

  // ===== Journal Entries =====

  async createJournalEntry(entry: JournalEntryData): Promise<{ success: boolean; data?: GLEntryData[]; error?: any }> {
    try {
      // 1. Validate balance
      let totalDebit = 0
      let totalCredit = 0

      entry.entries.forEach(e => {
        totalDebit += e.debit
        totalCredit += e.credit
      })

      if (Math.abs(totalDebit - totalCredit) > 0.01) {
        throw new Error(`القيد غير متوازن. المدين: ${totalDebit}، الدائن: ${totalCredit}`)
      }

      // 2. Validate accounts exist
      for (const e of entry.entries) {
        const account = await this.getAccount(e.accountCode)
        if (!account) {
          throw new Error(`الحساب ${e.accountCode} غير موجود`)
        }
      }

      // 3. Insert entries
      const entriesData = entry.entries.map(e => ({
        account_code: e.accountCode,
        account_name: e.accountName,
        debit: e.debit,
        credit: e.credit,
        description: e.description,
        reference_type: entry.referenceType,
        reference_id: entry.referenceId,
        transaction_date: entry.entryDate,
      }))

      const { data, error } = await supabase
        .from('gl_entries')
        .insert(entriesData)
        .select()

      if (error) throw error

      return {
        success: true,
        data: (data || []).map(this.mapEntry),
      }
    } catch (error: any) {
      return { success: false, error }
    }
  }

  async getAccountEntries(
    accountCode: string,
    options?: { fromDate?: string; toDate?: string }
  ): Promise<GLEntryData[]> {
    let query = supabase
      .from('gl_entries')
      .select('*')
      .eq('account_code', accountCode)
      .order('transaction_date', { ascending: true })

    if (options?.fromDate) {
      query = query.gte('transaction_date', options.fromDate)
    }
    if (options?.toDate) {
      query = query.lte('transaction_date', options.toDate)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`فشل في جلب قيود الحساب: ${error.message}`)
    }

    return (data || []).map(this.mapEntry)
  }

  // ===== Account Balances =====

  async calculateAccountBalance(accountCode: string, upToDate?: string): Promise<AccountBalanceData> {
    let query = supabase
      .from('gl_entries')
      .select('debit, credit')
      .eq('account_code', accountCode)

    if (upToDate) {
      query = query.lte('transaction_date', upToDate)
    }

    const { data, error } = await query

    if (error) {
      throw new Error(`فشل في حساب رصيد الحساب: ${error.message}`)
    }

    const account = await this.getAccount(accountCode)
    let totalDebit = 0
    let totalCredit = 0

    data?.forEach(entry => {
      totalDebit += entry.debit || 0
      totalCredit += entry.credit || 0
    })

    return {
      accountCode,
      accountName: account?.accountName || '',
      totalDebit,
      totalCredit,
      balance: totalDebit - totalCredit,
    }
  }

  // ===== Financial Reports =====

  async getTrialBalance(fromDate?: string, toDate?: string): Promise<TrialBalanceData> {
    const accounts = await this.getAccounts({ active: true })
    const balances: TrialBalanceData['balances'] = []

    for (const account of accounts) {
      let query = supabase
        .from('gl_entries')
        .select('debit, credit')
        .eq('account_code', account.accountCode)

      if (fromDate) query = query.gte('transaction_date', fromDate)
      if (toDate) query = query.lte('transaction_date', toDate)

      const { data } = await query

      let debit = 0
      let credit = 0

      data?.forEach(entry => {
        debit += entry.debit || 0
        credit += entry.credit || 0
      })

      if (debit !== 0 || credit !== 0) {
        balances.push({
          accountCode: account.accountCode,
          accountName: account.accountName,
          accountType: account.accountType,
          debit,
          credit,
          balance: debit - credit,
        })
      }
    }

    const totals = balances.reduce(
      (acc, curr) => ({
        totalDebit: acc.totalDebit + curr.debit,
        totalCredit: acc.totalCredit + curr.credit,
      }),
      { totalDebit: 0, totalCredit: 0 }
    )

    return {
      balances,
      totals,
      isBalanced: Math.abs(totals.totalDebit - totals.totalCredit) < 0.01,
    }
  }

  async getIncomeStatement(fromDate: string, toDate: string): Promise<IncomeStatementData> {
    const { data, error } = await supabase
      .from('gl_entries')
      .select('account_code, account_name, debit, credit')
      .gte('transaction_date', fromDate)
      .lte('transaction_date', toDate)
      .or('account_code.like.4%,account_code.like.5%')

    if (error) {
      throw new Error(`فشل في إنشاء قائمة الدخل: ${error.message}`)
    }

    const accountTotals: { [key: string]: { code: string; name: string; debit: number; credit: number } } = {}

    data?.forEach(entry => {
      if (!accountTotals[entry.account_code]) {
        accountTotals[entry.account_code] = {
          code: entry.account_code,
          name: entry.account_name,
          debit: 0,
          credit: 0,
        }
      }
      accountTotals[entry.account_code].debit += entry.debit || 0
      accountTotals[entry.account_code].credit += entry.credit || 0
    })

    const revenues: IncomeStatementData['revenues'] = []
    const expenses: IncomeStatementData['expenses'] = []
    let totalRevenue = 0
    let totalExpense = 0

    Object.values(accountTotals).forEach(account => {
      if (account.code.startsWith('4')) {
        const amount = account.credit - account.debit
        revenues.push({ accountCode: account.code, accountName: account.name, amount })
        totalRevenue += amount
      } else if (account.code.startsWith('5')) {
        const amount = account.debit - account.credit
        expenses.push({ accountCode: account.code, accountName: account.name, amount })
        totalExpense += amount
      }
    })

    const netIncome = totalRevenue - totalExpense

    return {
      period: { from: fromDate, to: toDate },
      revenues,
      expenses,
      totalRevenue,
      totalExpense,
      netIncome,
      profitMargin: totalRevenue > 0 ? (netIncome / totalRevenue) * 100 : 0,
    }
  }

  async getBalanceSheet(asOfDate: string): Promise<BalanceSheetData> {
    const { data, error } = await supabase
      .from('gl_entries')
      .select('account_code, account_name, debit, credit')
      .lte('transaction_date', asOfDate)
      .or('account_code.like.1%,account_code.like.2%,account_code.like.3%')

    if (error) {
      throw new Error(`فشل في إنشاء الميزانية العمومية: ${error.message}`)
    }

    const accountTotals: { [key: string]: { code: string; name: string; debit: number; credit: number } } = {}

    data?.forEach(entry => {
      if (!accountTotals[entry.account_code]) {
        accountTotals[entry.account_code] = {
          code: entry.account_code,
          name: entry.account_name,
          debit: 0,
          credit: 0,
        }
      }
      accountTotals[entry.account_code].debit += entry.debit || 0
      accountTotals[entry.account_code].credit += entry.credit || 0
    })

    const assets: BalanceSheetData['assets'] = []
    const liabilities: BalanceSheetData['liabilities'] = []
    const equity: BalanceSheetData['equity'] = []
    let totalAssets = 0
    let totalLiabilities = 0
    let totalEquity = 0

    Object.values(accountTotals).forEach(account => {
      const balance = account.debit - account.credit

      if (account.code.startsWith('1')) {
        assets.push({ accountCode: account.code, accountName: account.name, balance })
        totalAssets += balance
      } else if (account.code.startsWith('2')) {
        liabilities.push({ accountCode: account.code, accountName: account.name, balance: -balance })
        totalLiabilities += -balance
      } else if (account.code.startsWith('3')) {
        equity.push({ accountCode: account.code, accountName: account.name, balance: -balance })
        totalEquity += -balance
      }
    })

    return {
      asOfDate,
      assets,
      liabilities,
      equity,
      totalAssets,
      totalLiabilities,
      totalEquity,
      isBalanced: Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01,
    }
  }

  async getAccountStatement(
    accountCode: string,
    options?: { fromDate?: string; toDate?: string }
  ): Promise<AccountStatementData> {
    const account = await this.getAccount(accountCode)
    if (!account) {
      throw new Error(`الحساب ${accountCode} غير موجود`)
    }

    // Opening balance
    let openingBalance = 0
    if (options?.fromDate) {
      const { data: openingEntries } = await supabase
        .from('gl_entries')
        .select('debit, credit')
        .eq('account_code', accountCode)
        .lt('transaction_date', options.fromDate)

      openingEntries?.forEach(entry => {
        openingBalance += (entry.debit || 0) - (entry.credit || 0)
      })
    }

    // Period movements
    const entries = await this.getAccountEntries(accountCode, options)

    let runningBalance = openingBalance
    const movements = entries.map(entry => {
      runningBalance += entry.debit - entry.credit
      return { ...entry, balance: runningBalance }
    })

    const totals = entries.reduce(
      (acc, entry) => ({
        debit: acc.debit + entry.debit,
        credit: acc.credit + entry.credit,
      }),
      { debit: 0, credit: 0 }
    )

    return {
      account,
      openingBalance,
      movements,
      closingBalance: runningBalance,
      totals,
    }
  }

  async getGeneralJournal(options?: {
    fromDate?: string
    toDate?: string
    referenceType?: string
  }): Promise<Array<{
    transactionDate: string
    referenceType: string
    referenceId: string
    description: string
    entries: GLEntryData[]
    totalDebit: number
    totalCredit: number
  }>> {
    let query = supabase
      .from('gl_entries')
      .select('*')
      .order('transaction_date', { ascending: true })
      .order('created_at', { ascending: true })

    if (options?.fromDate) query = query.gte('transaction_date', options.fromDate)
    if (options?.toDate) query = query.lte('transaction_date', options.toDate)
    if (options?.referenceType) query = query.eq('reference_type', options.referenceType)

    const { data, error } = await query

    if (error) {
      throw new Error(`فشل في جلب دفتر اليومية: ${error.message}`)
    }

    // Group by reference
    const grouped: { [key: string]: any } = {}

    data?.forEach(entry => {
      const key = `${entry.reference_type}_${entry.reference_id}_${entry.transaction_date}`

      if (!grouped[key]) {
        grouped[key] = {
          transactionDate: entry.transaction_date,
          referenceType: entry.reference_type,
          referenceId: entry.reference_id,
          description: entry.description,
          entries: [],
          totalDebit: 0,
          totalCredit: 0,
        }
      }

      grouped[key].entries.push(this.mapEntry(entry))
      grouped[key].totalDebit += entry.debit || 0
      grouped[key].totalCredit += entry.credit || 0
    })

    return Object.values(grouped)
  }

  // ===== Fiscal Period =====

  async getCurrentFiscalPeriod(): Promise<{ year: number; period: number }> {
    const now = new Date()
    return {
      year: now.getFullYear(),
      period: now.getMonth() + 1,
    }
  }

  async closeFiscalPeriod(year: number, period: number): Promise<void> {
    // Fiscal period closing would typically involve:
    // 1. Creating closing entries for revenue/expense accounts
    // 2. Transferring net income to retained earnings
    // 3. Marking the period as closed in the database
    // 
    // For now, this is a placeholder as the full implementation
    // requires additional database schema (fiscal_periods table)
    // and business logic specific to each organization's needs.
    console.log(`Closing fiscal period: ${year}-${period}`)
  }

  // ===== Private Mappers =====

  private mapAccount(data: any): GLAccountData {
    return {
      id: data.id,
      accountCode: data.account_code,
      accountName: data.account_name,
      accountNameAr: data.account_name_ar,
      accountType: data.account_type,
      parentCode: data.parent_code,
      level: data.level || 1,
      isActive: data.is_active ?? true,
      normalBalance: data.normal_balance || 'Debit',
      currency: data.currency,
    }
  }

  private mapEntry(data: any): GLEntryData {
    return {
      id: data.id,
      accountCode: data.account_code,
      accountName: data.account_name,
      debit: data.debit || 0,
      credit: data.credit || 0,
      description: data.description,
      referenceType: data.reference_type,
      referenceId: data.reference_id,
      transactionDate: data.transaction_date,
      fiscalYear: data.fiscal_year,
      fiscalPeriod: data.fiscal_period,
      createdAt: data.created_at,
      createdBy: data.created_by,
    }
  }
}

/**
 * Singleton instance
 */
export const accountingRepository = new SupabaseAccountingRepository()
