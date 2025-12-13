/**
 * @fileoverview Accounting Application Service
 * @description خدمة تطبيق المحاسبة - الطبقة التي تربط الواجهة الأمامية بـ Repository
 * 
 * هذه الخدمة تتبع Clean Architecture:
 * - تستخدم Repository Pattern للوصول للبيانات
 * - تحتوي على Business Logic للعمليات المحاسبية
 * - توفر واجهة موحدة للتقارير المالية
 */

import { getAccountingRepository } from '@/infrastructure/di/container'
import type { 
  IAccountingRepository, 
  GLAccountData, 
  GLEntryData, 
  JournalEntryData,
  TrialBalanceData,
  IncomeStatementData,
  BalanceSheetData 
} from '@/domain/interfaces'

// ===== Types =====

export interface AccountListFilters {
  search?: string
  accountType?: string
  parentId?: string
  isActive?: boolean
  level?: number
}

export interface JournalEntryInput {
  date: Date
  reference?: string
  description: string
  lines: JournalEntryLineInput[]
  attachments?: string[]
}

export interface JournalEntryLineInput {
  accountId: string
  debit?: number
  credit?: number
  description?: string
  costCenter?: string
}

export interface AccountStatementFilters {
  accountId: string
  startDate: Date
  endDate: Date
  includeOpeningBalance?: boolean
}

export interface AccountStatementResult {
  account: GLAccountData
  openingBalance: number
  entries: GLEntryData[]
  totalDebits: number
  totalCredits: number
  closingBalance: number
}

export interface FinancialReportOptions {
  startDate: Date
  endDate: Date
  comparePreviousPeriod?: boolean
  includeZeroBalances?: boolean
}

export interface DashboardMetrics {
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  totalRevenue: number
  totalExpenses: number
  netIncome: number
  currentRatio: number
  debtToEquityRatio: number
}

// ===== Service =====

/**
 * خدمة تطبيق المحاسبة
 * توفر واجهة عالية المستوى للعمليات المحاسبية والتقارير المالية
 */
export class AccountingAppService {
  private repository: IAccountingRepository

  constructor(repository?: IAccountingRepository) {
    this.repository = repository || getAccountingRepository()
  }

  // ===== Chart of Accounts =====

  /**
   * الحصول على دليل الحسابات
   */
  async getChartOfAccounts(filters: AccountListFilters = {}): Promise<GLAccountData[]> {
    const accounts = await this.repository.getAccounts()
    
    let filtered = accounts

    if (filters.search) {
      const searchLower = filters.search.toLowerCase()
      filtered = filtered.filter(a => 
        a.name.toLowerCase().includes(searchLower) ||
        a.code.toLowerCase().includes(searchLower)
      )
    }

    if (filters.accountType) {
      filtered = filtered.filter(a => a.accountType === filters.accountType)
    }

    if (filters.parentId) {
      filtered = filtered.filter(a => a.parentId === filters.parentId)
    }

    if (filters.isActive !== undefined) {
      filtered = filtered.filter(a => a.isActive === filters.isActive)
    }

    if (filters.level !== undefined) {
      filtered = filtered.filter(a => a.level === filters.level)
    }

    return filtered
  }

  /**
   * الحصول على حساب محدد
   */
  async getAccount(accountId: string): Promise<GLAccountData | null> {
    return this.repository.getAccount(accountId)
  }

  /**
   * الحصول على الحسابات الفرعية
   */
  async getChildAccounts(parentId: string): Promise<GLAccountData[]> {
    const accounts = await this.repository.getAccounts()
    return accounts.filter(a => a.parentId === parentId)
  }

  /**
   * إنشاء حساب جديد
   */
  async createAccount(account: Omit<GLAccountData, 'id'>): Promise<GLAccountData> {
    // التحقق من عدم تكرار الكود
    const existing = await this.repository.getAccounts()
    if (existing.some(a => a.code === account.code)) {
      throw new Error(`كود الحساب مستخدم بالفعل: ${account.code}`)
    }

    return this.repository.createAccount(account)
  }

  // ===== Journal Entries =====

  /**
   * إنشاء قيد يومية
   */
  async createJournalEntry(input: JournalEntryInput): Promise<JournalEntryData> {
    // التحقق من توازن القيد
    const totalDebits = input.lines.reduce((sum, l) => sum + (l.debit || 0), 0)
    const totalCredits = input.lines.reduce((sum, l) => sum + (l.credit || 0), 0)

    if (Math.abs(totalDebits - totalCredits) > 0.001) {
      throw new Error(`القيد غير متوازن. المدين: ${totalDebits}, الدائن: ${totalCredits}`)
    }

    // التحقق من وجود الحسابات
    for (const line of input.lines) {
      const account = await this.repository.getAccount(line.accountId)
      if (!account) {
        throw new Error(`الحساب غير موجود: ${line.accountId}`)
      }
      if (!account.isActive) {
        throw new Error(`الحساب غير نشط: ${account.name}`)
      }
    }

    return this.repository.createJournalEntry({
      date: input.date,
      reference: input.reference,
      description: input.description,
      lines: input.lines.map(l => ({
        accountId: l.accountId,
        debit: l.debit || 0,
        credit: l.credit || 0,
        description: l.description,
        costCenter: l.costCenter
      }))
    })
  }

  /**
   * الحصول على قيد يومية
   */
  async getJournalEntry(entryId: string): Promise<JournalEntryData | null> {
    // سنحتاج لإضافة هذه الوظيفة للـ Repository
    const entries = await this.repository.getGeneralJournal(
      new Date(0), 
      new Date()
    )
    return entries.find(e => e.id === entryId) || null
  }

  // ===== Account Statement =====

  /**
   * الحصول على كشف حساب
   */
  async getAccountStatement(filters: AccountStatementFilters): Promise<AccountStatementResult> {
    const account = await this.repository.getAccount(filters.accountId)
    if (!account) {
      throw new Error('الحساب غير موجود')
    }

    const entries = await this.repository.getAccountEntries(
      filters.accountId,
      filters.startDate,
      filters.endDate
    )

    // حساب الرصيد الافتتاحي
    let openingBalance = 0
    if (filters.includeOpeningBalance) {
      openingBalance = await this.repository.calculateAccountBalance(
        filters.accountId,
        new Date(0),
        new Date(filters.startDate.getTime() - 1)
      )
    }

    const totalDebits = entries.reduce((sum, e) => sum + e.debit, 0)
    const totalCredits = entries.reduce((sum, e) => sum + e.credit, 0)
    
    // حساب الرصيد الختامي حسب طبيعة الحساب
    const isDebitNature = ['asset', 'expense'].includes(account.accountType)
    const closingBalance = isDebitNature
      ? openingBalance + totalDebits - totalCredits
      : openingBalance + totalCredits - totalDebits

    return {
      account,
      openingBalance,
      entries,
      totalDebits,
      totalCredits,
      closingBalance
    }
  }

  // ===== Financial Reports =====

  /**
   * الحصول على ميزان المراجعة
   */
  async getTrialBalance(options: FinancialReportOptions): Promise<TrialBalanceData> {
    return this.repository.getTrialBalance(options.startDate, options.endDate)
  }

  /**
   * الحصول على قائمة الدخل
   */
  async getIncomeStatement(options: FinancialReportOptions): Promise<IncomeStatementData> {
    return this.repository.getIncomeStatement(options.startDate, options.endDate)
  }

  /**
   * الحصول على الميزانية العمومية
   */
  async getBalanceSheet(asOfDate: Date): Promise<BalanceSheetData> {
    return this.repository.getBalanceSheet(asOfDate)
  }

  /**
   * الحصول على دفتر اليومية العام
   */
  async getGeneralJournal(startDate: Date, endDate: Date): Promise<JournalEntryData[]> {
    return this.repository.getGeneralJournal(startDate, endDate)
  }

  // ===== Dashboard Metrics =====

  /**
   * الحصول على مؤشرات لوحة التحكم المالية
   */
  async getDashboardMetrics(asOfDate: Date = new Date()): Promise<DashboardMetrics> {
    const balanceSheet = await this.repository.getBalanceSheet(asOfDate)
    
    // حساب قائمة الدخل للسنة الحالية
    const startOfYear = new Date(asOfDate.getFullYear(), 0, 1)
    const incomeStatement = await this.repository.getIncomeStatement(startOfYear, asOfDate)

    // حساب النسب المالية
    const currentAssets = this.calculateCurrentAssets(balanceSheet)
    const currentLiabilities = this.calculateCurrentLiabilities(balanceSheet)
    const currentRatio = currentLiabilities > 0 ? currentAssets / currentLiabilities : 0
    
    const debtToEquityRatio = balanceSheet.totalEquity > 0 
      ? balanceSheet.totalLiabilities / balanceSheet.totalEquity 
      : 0

    return {
      totalAssets: balanceSheet.totalAssets,
      totalLiabilities: balanceSheet.totalLiabilities,
      totalEquity: balanceSheet.totalEquity,
      totalRevenue: incomeStatement.totalRevenue,
      totalExpenses: incomeStatement.totalExpenses,
      netIncome: incomeStatement.netIncome,
      currentRatio,
      debtToEquityRatio
    }
  }

  // ===== Private Helpers =====

  private calculateCurrentAssets(balanceSheet: BalanceSheetData): number {
    // تقدير الأصول المتداولة (يمكن تحسينها لاحقاً)
    return balanceSheet.totalAssets * 0.4 // تقدير مبدئي
  }

  private calculateCurrentLiabilities(balanceSheet: BalanceSheetData): number {
    // تقدير الخصوم المتداولة (يمكن تحسينها لاحقاً)
    return balanceSheet.totalLiabilities * 0.5 // تقدير مبدئي
  }
}

// ===== Singleton Instance =====

let accountingAppServiceInstance: AccountingAppService | null = null

/**
 * الحصول على instance من خدمة المحاسبة
 */
export function getAccountingAppService(): AccountingAppService {
  if (!accountingAppServiceInstance) {
    accountingAppServiceInstance = new AccountingAppService()
  }
  return accountingAppServiceInstance
}

/**
 * إعادة تعيين الـ instance (للاختبارات)
 */
export function resetAccountingAppService(): void {
  accountingAppServiceInstance = null
}
