/**
 * @fileoverview Accounting Application Service
 * @description خدمة تطبيق المحاسبة - الطبقة التي تربط الواجهة الأمامية بـ Repository
 * 
 * هذه الخدمة تتبع Clean Architecture:
 * - تستخدم Repository Pattern للوصول للبيانات
 * - تحتوي على Business Logic للعمليات المعقدة
 * - توفر واجهة موحدة للواجهة الأمامية
 */

import { getAccountingRepository } from '@/infrastructure/di/container'
import type { 
  IAccountingRepository, 
  GLAccountData, 
  GLEntryData,
  JournalEntryData,
  AccountBalanceData,
  TrialBalanceData,
  IncomeStatementData,
  BalanceSheetData,
  AccountStatementData
} from '@/domain/interfaces'

// ===== Types =====

export interface AccountListFilters {
  search?: string
  type?: string
  parentCode?: string
  level?: number
  active?: boolean
  page?: number
  pageSize?: number
}

export interface AccountListResult {
  accounts: GLAccountData[]
  total: number
  page: number
  pageSize: number
  hasMore: boolean
}

export interface JournalEntryFilters {
  accountCode?: string
  fromDate?: string
  toDate?: string
  referenceType?: string
  page?: number
  pageSize?: number
}

export interface CreateJournalEntryInput {
  entryDate: string
  referenceType: string
  referenceId: string
  description: string
  lines: Array<{
    accountCode: string
    accountName: string
    debit: number
    credit: number
    description?: string
  }>
}

// ===== Service =====

/**
 * خدمة تطبيق المحاسبة
 * توفر واجهة عالية المستوى لعمليات المحاسبة
 */
export class AccountingAppService {
  private repository: IAccountingRepository

  constructor(repository?: IAccountingRepository) {
    this.repository = repository || getAccountingRepository()
  }

  // ===== Chart of Accounts =====

  /**
   * الحصول على قائمة الحسابات مع الفلترة والترقيم
   */
  async getAccounts(filters: AccountListFilters = {}): Promise<AccountListResult> {
    const { page = 1, pageSize = 20, search, type, parentCode, level, active } = filters
    
    const allAccounts = await this.repository.getAccounts({ type, parentCode, active })
    
    // تطبيق الفلاتر
    let filtered = allAccounts
    
    if (search) {
      const searchLower = search.toLowerCase()
      filtered = filtered.filter(a => 
        a.accountName.toLowerCase().includes(searchLower) ||
        a.accountCode.toLowerCase().includes(searchLower) ||
        (a.accountNameAr && a.accountNameAr.includes(search))
      )
    }

    if (level !== undefined) {
      filtered = filtered.filter(a => a.level === level)
    }
    
    // ترقيم الصفحات
    const total = filtered.length
    const start = (page - 1) * pageSize
    const accounts = filtered.slice(start, start + pageSize)
    
    return {
      accounts,
      total,
      page,
      pageSize,
      hasMore: start + pageSize < total
    }
  }

  /**
   * الحصول على حساب واحد
   */
  async getAccount(accountCode: string): Promise<GLAccountData | null> {
    return this.repository.getAccount(accountCode)
  }

  /**
   * الحصول على الحسابات حسب النوع
   */
  async getAccountsByType(accountType: string): Promise<GLAccountData[]> {
    return this.repository.getAccounts({ type: accountType })
  }

  /**
   * البحث في الحسابات
   */
  async searchAccounts(query: string): Promise<GLAccountData[]> {
    const allAccounts = await this.repository.getAccounts()
    const queryLower = query.toLowerCase()
    
    return allAccounts.filter(a =>
      a.accountName.toLowerCase().includes(queryLower) ||
      a.accountCode.toLowerCase().includes(queryLower) ||
      (a.accountNameAr && a.accountNameAr.includes(query))
    )
  }

  /**
   * إنشاء حساب جديد
   */
  async createAccount(account: Omit<GLAccountData, 'id'>): Promise<GLAccountData> {
    // التحقق من عدم وجود حساب بنفس الكود
    const existing = await this.repository.getAccount(account.accountCode)
    if (existing) {
      throw new Error(`الحساب موجود مسبقاً: ${account.accountCode}`)
    }

    // التحقق من وجود الحساب الأب إذا تم تحديده
    if (account.parentCode) {
      const parent = await this.repository.getAccount(account.parentCode)
      if (!parent) {
        throw new Error(`الحساب الأب غير موجود: ${account.parentCode}`)
      }
    }

    return this.repository.createAccount(account)
  }

  /**
   * تحديث حساب
   */
  async updateAccount(accountCode: string, data: Partial<GLAccountData>): Promise<void> {
    const account = await this.repository.getAccount(accountCode)
    if (!account) {
      throw new Error(`الحساب غير موجود: ${accountCode}`)
    }

    return this.repository.updateAccount(accountCode, data)
  }

  // ===== Journal Entries =====

  /**
   * إنشاء قيد محاسبي
   */
  async createJournalEntry(input: CreateJournalEntryInput): Promise<{ success: boolean; data?: GLEntryData[]; error?: string }> {
    // التحقق من توازن القيد
    const totalDebit = input.lines.reduce((sum, l) => sum + l.debit, 0)
    const totalCredit = input.lines.reduce((sum, l) => sum + l.credit, 0)
    
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      return { 
        success: false, 
        error: `القيد غير متوازن. مدين: ${totalDebit}, دائن: ${totalCredit}` 
      }
    }

    // التحقق من وجود الحسابات
    for (const line of input.lines) {
      const account = await this.repository.getAccount(line.accountCode)
      if (!account) {
        return { success: false, error: `الحساب غير موجود: ${line.accountCode}` }
      }
    }

    // تحويل الإدخال إلى صيغة JournalEntryData
    const journalEntry: JournalEntryData = {
      entryDate: input.entryDate,
      description: input.description,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      entries: input.lines.map(line => ({
        accountCode: line.accountCode,
        accountName: line.accountName,
        debit: line.debit,
        credit: line.credit,
        description: line.description || input.description,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        transactionDate: input.entryDate
      }))
    }

    return this.repository.createJournalEntry(journalEntry)
  }

  /**
   * الحصول على قيود حساب
   */
  async getAccountEntries(
    accountCode: string,
    options?: { fromDate?: string; toDate?: string }
  ): Promise<GLEntryData[]> {
    return this.repository.getAccountEntries(accountCode, options)
  }

  /**
   * الحصول على دفتر اليومية العام
   */
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
    return this.repository.getGeneralJournal(options)
  }

  // ===== Account Balances =====

  /**
   * الحصول على رصيد حساب
   */
  async getAccountBalance(accountCode: string, asOfDate?: string): Promise<AccountBalanceData> {
    return this.repository.calculateAccountBalance(accountCode, asOfDate)
  }

  /**
   * الحصول على كشف حساب
   */
  async getAccountStatement(
    accountCode: string,
    options?: { fromDate?: string; toDate?: string }
  ): Promise<AccountStatementData> {
    return this.repository.getAccountStatement(accountCode, options)
  }

  // ===== Financial Reports =====

  /**
   * الحصول على ميزان المراجعة
   */
  async getTrialBalance(fromDate?: string, toDate?: string): Promise<TrialBalanceData> {
    return this.repository.getTrialBalance(fromDate, toDate)
  }

  /**
   * الحصول على قائمة الدخل
   */
  async getIncomeStatement(fromDate: string, toDate: string): Promise<IncomeStatementData> {
    return this.repository.getIncomeStatement(fromDate, toDate)
  }

  /**
   * الحصول على الميزانية العمومية
   */
  async getBalanceSheet(asOfDate: string): Promise<BalanceSheetData> {
    return this.repository.getBalanceSheet(asOfDate)
  }

  // ===== Fiscal Period =====

  /**
   * الحصول على الفترة المالية الحالية
   */
  async getCurrentFiscalPeriod(): Promise<{ year: number; period: number }> {
    return this.repository.getCurrentFiscalPeriod()
  }

  /**
   * إقفال الفترة المالية
   */
  async closeFiscalPeriod(year: number, period: number): Promise<void> {
    return this.repository.closeFiscalPeriod(year, period)
  }

  // ===== Dashboard Metrics =====

  /**
   * الحصول على إحصائيات المحاسبة للوحة التحكم
   */
  async getDashboardMetrics(): Promise<{
    totalAccounts: number
    activeAccounts: number
    totalAssets: number
    totalLiabilities: number
    totalRevenue: number
    totalExpenses: number
  }> {
    const accounts = await this.repository.getAccounts()
    const today = new Date().toISOString().split('T')[0]
    const balanceSheet = await this.repository.getBalanceSheet(today)
    
    // الحصول على قائمة الدخل للسنة الحالية
    const startOfYear = `${new Date().getFullYear()}-01-01`
    const incomeStatement = await this.repository.getIncomeStatement(startOfYear, today)
    
    return {
      totalAccounts: accounts.length,
      activeAccounts: accounts.filter(a => a.isActive).length,
      totalAssets: balanceSheet.totalAssets,
      totalLiabilities: balanceSheet.totalLiabilities,
      totalRevenue: incomeStatement.totalRevenue,
      totalExpenses: incomeStatement.totalExpense
    }
  }

  /**
   * الحصول على ملخص الأرباح والخسائر
   */
  async getProfitAndLoss(fromDate: string, toDate: string): Promise<{
    revenue: number
    expenses: number
    netProfit: number
  }> {
    const incomeStatement = await this.repository.getIncomeStatement(fromDate, toDate)

    return {
      revenue: incomeStatement.totalRevenue,
      expenses: incomeStatement.totalExpense,
      netProfit: incomeStatement.netIncome
    }
  }
}

// ===== Singleton Management =====

let accountingAppServiceInstance: AccountingAppService | null = null

/**
 * الحصول على instance من AccountingAppService (Singleton)
 */
export function getAccountingAppService(): AccountingAppService {
  if (!accountingAppServiceInstance) {
    accountingAppServiceInstance = new AccountingAppService(getAccountingRepository())
  }
  return accountingAppServiceInstance
}

/**
 * إعادة تعيين الـ singleton (للاختبارات)
 */
export function resetAccountingAppService(): void {
  accountingAppServiceInstance = null
}